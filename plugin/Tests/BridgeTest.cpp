// Drives the plugin like a host would: fake tempo, press play, feed a sine wave, press stop, then inspect the file.
#include "../Source/PluginProcessor.h"
#include "../Source/PluginEditor.h"
#include "../Source/LibraryDb.h"
#include <cmath>

using namespace juce;

struct FakeHost : AudioPlayHead
{
    double bpm = 128.0;
    bool playing = false;
    Optional<PositionInfo> getPosition() const override
    {
        PositionInfo p;
        p.setBpm (bpm);
        p.setIsPlaying (playing);
        p.setTimeSignature (TimeSignature { 4, 4 });
        return p;
    }
};

static int failures = 0;
#define CHECK(cond, msg) do { if (! (cond)) { std::cout << "FAIL: " << msg << std::endl; ++failures; } else std::cout << "ok:   " << msg << std::endl; } while (0)

int main()
{
    ScopedJuceInitialiser_GUI init;
    const auto dir = File::getSpecialLocation (File::tempDirectory).getChildFile ("shq-bridge-test-" + String (Time::currentTimeMillis()));
    dir.createDirectory();

    BridgeProcessor proc;
    FakeHost host;
    proc.setPlayHead (&host);
    proc.vaultFolder = dir;
    proc.bounceName = "Test Beat";
    proc.autoMode = true;

    const double sr = 44100.0;
    const int block = 512;
    proc.setRateAndBufferSizeDetails (sr, block);
    proc.prepareToPlay (sr, block);

    MidiBuffer midi;
    AudioBuffer<float> buf (2, block);
    double phase = 0.0;
    const double inc = 2.0 * MathConstants<double>::pi * 440.0 / sr;
    auto feed = [&] (int blocks)
    {
        for (int b = 0; b < blocks; ++b)
        {
            for (int i = 0; i < block; ++i) { const float v = (float) (0.5 * std::sin (phase)); phase += inc; buf.setSample (0, i, v); buf.setSample (1, i, v * 0.5f); }
            proc.processBlock (buf, midi);
        }
    };

    String lastMsg; File saved;
    proc.onMessage = [&] (const String& m) { lastMsg = m; };
    proc.onSaved = [&] (const File& f, double) { saved = f; };

    // 1. arm, and make sure nothing records until the host plays
    proc.startRecording();
    CHECK (proc.state.load() == BridgeProcessor::State::Armed, "armed after startRecording");
    feed (50);
    CHECK (proc.state.load() == BridgeProcessor::State::Armed, "still armed while the host is stopped");

    // 2. host starts: record about 3 seconds
    host.playing = true;
    const int blocks = (int) (3.0 * sr / block);
    feed (blocks);
    CHECK (proc.state.load() == BridgeProcessor::State::Recording, "recording while the host plays");
    CHECK (std::abs (proc.hostBpm.load() - 128.0) < 0.001, "reads the host tempo (128)");

    // audio must pass through untouched
    const float inSample = buf.getSample (0, 10);
    CHECK (std::abs (std::abs (inSample) - std::abs ((float) (0.5 * std::sin (phase - inc * (block - 10))))) < 1e-4f, "audio passes through unchanged");

    // 3. host stops: file is finalized on the message thread
    host.playing = false;
    feed (2);
    MessageManager::getInstance()->runDispatchLoopUntil (500);

    CHECK (saved.existsAsFile(), "a file was saved");
    std::cout << "      saved as: " << saved.getFileName() << "  | status: " << lastMsg << std::endl;
    CHECK (saved.getFileName().contains ("Test Beat (128bpm).wav"), "file name carries the host tempo: 'Test Beat (128bpm).wav'");
    CHECK (saved.getParentDirectory() == dir, "saved into the Vault folder");
    CHECK (dir.findChildFiles (File::findFiles, false, "*.partial").isEmpty(), "no leftover partial files");

    WavAudioFormat wav;
    if (auto reader = std::unique_ptr<AudioFormatReader> (wav.createReaderFor (saved.createInputStream().release(), true)))
    {
        const double secs = (double) reader->lengthInSamples / reader->sampleRate;
        CHECK (reader->numChannels == 2, "stereo file");
        CHECK (reader->bitsPerSample == 24, "24-bit file");
        CHECK (std::abs (reader->sampleRate - sr) < 0.5, "sample rate matches the host");
        CHECK (secs > 2.99 && secs < 3.1, "length is about 3 seconds (got " + String (secs, 3) + ")");
        AudioBuffer<float> rb (2, 1024);
        reader->read (&rb, 0, 1024, 0, true, true);
        CHECK (std::abs (rb.getMagnitude (0, 0, 1024) - 0.5f) < 0.01f, "left channel level is right (0.5)");
        CHECK (std::abs (rb.getMagnitude (1, 0, 1024) - 0.25f) < 0.01f, "right channel level is right (0.25)");
    }
    else CHECK (false, "file opens as a WAV");

    // 4. a second take with the same name gets a unique file name
    proc.startRecording(); host.playing = true; feed (blocks); host.playing = false; feed (2);
    MessageManager::getInstance()->runDispatchLoopUntil (500);
    CHECK (saved.getFileName().contains ("(2)"), "second take with the same name doesn't overwrite (" + saved.getFileName() + ")");

    // 5. a too-short recording is discarded
    proc.bounceName = "Short";
    proc.startRecording(); host.playing = true; feed (3); host.playing = false; feed (2);
    MessageManager::getInstance()->runDispatchLoopUntil (300);
    CHECK (! dir.getChildFile ("Short (128bpm).wav").exists(), "a tiny recording is discarded instead of saved");

    // 6. manual mode records immediately, no host play needed
    proc.bounceName = "Manual";
    proc.autoMode = false;
    host.bpm = 139.5;
    proc.startRecording();
    CHECK (proc.state.load() == BridgeProcessor::State::Recording, "manual mode starts recording at once");
    feed (blocks);
    proc.stopAndSave();
    MessageManager::getInstance()->runDispatchLoopUntil (300);
    CHECK (dir.getChildFile ("Manual (139.5bpm).wav").existsAsFile(), "fractional tempo is kept in the name (139.5bpm)");

    // 7. state round-trips (FL saves it in the project)
    MemoryBlock mb;
    proc.bounceName = "Round trip";
    proc.getStateInformation (mb);
    BridgeProcessor other;
    other.setStateInformation (mb.getData(), (int) mb.getSize());
    CHECK (other.bounceName == "Round trip" && other.vaultFolder == dir, "settings are saved with the project");

    // 9. the sound browser, against the real Studio HQ library (read-only)
    if (LibraryDb::defaultDbFile().existsAsFile())
    {
        LibraryDb ldb; String err;
        const bool ok = ldb.load (LibraryDb::defaultDbFile(), err);
        CHECK (ok, "library database opens read-only (" + err + ")");
        std::cout << "      sounds: " << ldb.sounds.size() << "  projects: " << ldb.projects.size() << "  kinds: " << ldb.kinds.joinIntoString (",") << std::endl;
        CHECK (ldb.sounds.size() > 1000, "reads the sound library");
        CHECK (ldb.projects.size() > 10, "reads FL project sections");
        bool anyMidi = false, projOk = true;
        for (auto& snd : ldb.sounds) if (snd.isMidi() && snd.notes > 0) { anyMidi = true; break; }
        for (auto& pr : ldb.projects) for (int id : pr.soundIds) if (! ldb.indexById.contains (id)) projOk = false;
        CHECK (anyMidi, "MIDI from projects is present, with note counts");
        CHECK (projOk, "every project sound id resolves to a library sound");

        SoundsPanel panel (proc);
        panel.setBounds (0, 0, 660, 480);
        for (int i = 0; i < 100 && ! panel.loaded(); ++i) MessageManager::getInstance()->runDispatchLoopUntil (100);
        CHECK (panel.loaded(), "panel loads the library in the background");
        const int all = panel.numRowsShown();
        CHECK (all == ldb.sounds.size(), "panel lists everything at first (" + String (all) + ")");

        panel.setSearch ("kick");
        CHECK (panel.numRowsShown() > 0 && panel.numRowsShown() < all, "search narrows the list (kick: " + String (panel.numRowsShown()) + ")");
        panel.setSearch ("");
        panel.setKind ("midi");
        bool allMidi = panel.numRowsShown() > 0;
        for (int i = 0; i < panel.numRowsShown(); ++i) if (! panel.itemAtRow (i)->isMidi()) allMidi = false;
        CHECK (allMidi, "type filter shows only MIDI (" + String (panel.numRowsShown()) + ")");
        panel.selectRowForTest (0);
        CHECK (! proc.isPreviewPlaying(), "selecting a MIDI file doesn't try to play audio");

        panel.setKind ("All types");
        panel.setSearch ("");
        panel.setProjectByIndex (0);
        CHECK (panel.numRowsShown() == ldb.projects.getReference (0).soundIds.size(), "choosing an FL project shows exactly its sounds");
        panel.setProjectByIndex (-1);
        panel.setSearch ("");

        // pick a short audio sample and audition it
        int pick = -1;
        for (int i = 0; i < panel.numRowsShown(); ++i) { auto* it = panel.itemAtRow (i); if (it && ! it->isMidi() && it->ext == "wav" && it->duration > 0.3 && it->duration < 3.0 && it->file.existsAsFile()) { pick = i; break; } }
        CHECK (pick >= 0, "found a short sample to audition");
        if (pick >= 0)
        {
            proc.setRateAndBufferSizeDetails (sr, block);
            proc.prepareToPlay (sr, block);
            host.playing = false;
            panel.selectRowForTest (pick);   // auto-play is on by default
            Thread::sleep (400);               // let the read-ahead thread fill its buffer
            CHECK (proc.isPreviewPlaying(), "selecting a sample starts the preview");

            // a recording running at the same time must NOT contain the preview
            proc.bounceName = "NoLeak"; proc.autoMode = false;
            proc.startRecording();
            AudioBuffer<float> silent (2, block); float previewPeak = 0.f;
            for (int b = 0; b < 90; ++b) { silent.clear(); proc.processBlock (silent, midi); previewPeak = jmax (previewPeak, silent.getMagnitude (0, 0, block)); Thread::sleep (3); }
            CHECK (previewPeak > 0.001f, "the preview is audible in the plugin's output (peak " + String (previewPeak, 3) + ")");
            proc.stopAndSave();
            MessageManager::getInstance()->runDispatchLoopUntil (300);
            auto leak = dir.findChildFiles (File::findFiles, false, "NoLeak*.wav");
            if (leak.size() == 1)
            {
                std::unique_ptr<AudioFormatReader> r (wav.createReaderFor (leak[0].createInputStream().release(), true));
                AudioBuffer<float> rb (2, (int) jmin<juce::int64> (r->lengthInSamples, 20000));
                r->read (&rb, 0, rb.getNumSamples(), 0, true, true);
                CHECK (rb.getMagnitude (0, rb.getNumSamples()) < 1e-5f, "the bounce stays silent: preview audio is not recorded");
            }
            else CHECK (false, "the NoLeak recording was saved");
            proc.stopPreview();
        }
    }
    else std::cout << "      (skipping browser tests: no Studio HQ library on this machine)" << std::endl;

    // 8. optional: render the editor in a few states to PNGs (SHQ_SNAPSHOT=/folder)
    if (auto snap = SystemStats::getEnvironmentVariable ("SHQ_SNAPSHOT", {}); snap.isNotEmpty())
    {
        BridgeProcessor sp;
        sp.vaultFolder = File::getSpecialLocation (File::userHomeDirectory).getChildFile ("Desktop/! BEATS");
        sp.bounceName = "Moon";
        std::unique_ptr<AudioProcessorEditor> ed (sp.createEditor());
        auto shot = [&] (const String& name)
        {
            MessageManager::getInstance()->runDispatchLoopUntil (250);
            auto img = ed->createComponentSnapshot (ed->getLocalBounds(), true, 2.0f);
            PNGImageFormat png;
            File (snap).getChildFile (name + ".png").deleteFile();
            FileOutputStream out (File (snap).getChildFile (name + ".png"));
            png.writeImageToStream (img, out);
        };
        sp.hostBpm = 139.0; sp.hostPlaying = false; sp.peakL = 0.f; sp.peakR = 0.f;
        shot ("editor-idle");
        if (auto* be = dynamic_cast<BridgeEditor*> (ed.get()))
        {
            be->selectTab (1);
            for (int i = 0; i < 100 && ! be->soundsPanel().loaded(); ++i) MessageManager::getInstance()->runDispatchLoopUntil (100);
            be->soundsPanel().setSearch ("808");
            be->soundsPanel().selectRowForTest (2);
            shot ("editor-sounds");
            be->soundsPanel().setSearch ("");
            be->soundsPanel().setKind ("midi");
            be->soundsPanel().setProjectByIndex (3);
            be->soundsPanel().selectRowForTest (0);
            shot ("editor-midi");
            be->soundsPanel().setProjectByIndex (-1);
            be->selectTab (0);
        }
        sp.state = BridgeProcessor::State::Armed; sp.onMessage ? void() : void();
        shot ("editor-armed");
        sp.hostPlaying = true; sp.peakL = 0.7f; sp.peakR = 0.55f; sp.samplesWritten = (juce::int64) (42.0 * 44100.0);
        sp.state = BridgeProcessor::State::Recording;
        shot ("editor-recording");
        sp.state = BridgeProcessor::State::Idle;
        sp.lastSaved = dir.getChildFile ("Moon (139bpm).wav");
    }

    dir.deleteRecursively();
    std::cout << (failures == 0 ? "\nALL PASSED" : "\nSOME FAILED") << std::endl;
    return failures == 0 ? 0 : 1;
}
