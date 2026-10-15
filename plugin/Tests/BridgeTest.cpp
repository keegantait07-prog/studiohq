// Drives the plugin like a host would: fake tempo, press play, feed a sine wave, press stop, then inspect the file.
#include "../Source/PluginProcessor.h"
#include "../Source/PluginEditor.h"
#include "../Source/LibraryDb.h"
#include "../Source/SavePanel.h"
#include <cmath>
#include <cstdlib>

using namespace juce;

struct FakeHost : AudioPlayHead
{
    double bpm = 128.0;
    bool playing = false;
    double ppq = -1.0;
    Optional<PositionInfo> getPosition() const override
    {
        PositionInfo p;
        p.setBpm (bpm);
        p.setIsPlaying (playing);
        p.setTimeSignature (TimeSignature { 4, 4 });
        if (ppq >= 0.0) p.setPpqPosition (ppq);
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

    const auto tmpSupport = File::getSpecialLocation (File::tempDirectory).getChildFile ("shq-test-support-" + String (Time::currentTimeMillis()));
    tmpSupport.createDirectory();
    setenv ("SHQ_SUPPORT_DIR", tmpSupport.getFullPathName().toRawUTF8(), 1); // recordings must not drop inbox files into the real app folder

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

    const File realDb = File::getSpecialLocation (File::userHomeDirectory).getChildFile ("Library/Application Support/Studio HQ/studio-hq.db"); // read-only
    // 9. the sound browser, against the real Studio HQ library (read-only)
    if (realDb.existsAsFile())
    {
        LibraryDb ldb; String err;
        const bool ok = ldb.load (realDb, err);
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

    // 10. "Save to Studio HQ": finds the open FL project from FL's autosave names and drops a file in the inbox
    {
        const auto sup = File::getSpecialLocation (File::tempDirectory).getChildFile ("shq-support-" + String (Time::currentTimeMillis()));
        const auto projects = sup.getChildFile ("Projects");
        projects.getChildFile ("Moon").createDirectory();
        projects.getChildFile ("Other").createDirectory();
        projects.getChildFile ("Backup").createDirectory();
        projects.getChildFile ("Templates/Tpl").createDirectory();
        auto touch = [] (const File& f, int minutesAgo) { f.replaceWithText ("x"); f.setLastModificationTime (Time::getCurrentTime() - RelativeTime::minutes (minutesAgo)); };
        touch (projects.getChildFile ("Moon/Moon.flp"), 300);
        touch (projects.getChildFile ("Other/Other.flp"), 200);
        touch (projects.getChildFile ("Templates/Tpl/Tpl.flp"), 1);
        touch (projects.getChildFile ("Backup/Moon (autosaved on 15-10-26 at 14h41).flp"), 2);       // FL is working on Moon right now
        touch (projects.getChildFile ("Backup/Other (overwritten on 15-10-26 at 10h00).flp"), 400);
        sup.getChildFile ("bridge.json").replaceWithText ("{ \"projectFolders\": [\"" + projects.getFullPathName() + "\"] }");
        setenv ("SHQ_SUPPORT_DIR", sup.getFullPathName().toRawUTF8(), 1);

        std::cout << "      support dir in use: " << BridgeProcessor::supportDir().getFullPathName() << "  (env=" << SystemStats::getEnvironmentVariable ("SHQ_SUPPORT_DIR", "<unset>") << ")" << std::endl;
        auto g = BridgeProcessor::guessCurrentProject();
        CHECK (g.name == "Moon", "finds the open project from FL's newest autosave (got '" + g.name + "')");
        CHECK (g.flp == projects.getChildFile ("Moon/Moon.flp"), "resolves it to the saved project file");
        CHECK (g.ageSeconds >= 100 && g.ageSeconds < 400, "knows how recently FL touched it");
        CHECK (! g.unsaved, "a saved project isn't reported as unsaved");

        touch (projects.getChildFile ("Backup/untitled (autosaved on 15-10-26 at 14h50).flp"), 1);
        auto u = BridgeProcessor::guessCurrentProject();
        CHECK (u.unsaved && u.name == "untitled", "a brand-new unsaved project is detected and flagged (" + u.note.substring (0, 40) + "...)");
        String m;
        CHECK (! proc.saveToStudioHq ("x", u, m), "saving an unsaved project is refused with an explanation");
        CHECK (! sup.getChildFile ("inbox").findChildFiles (File::findFiles, false, "*.json").size(), "nothing is dropped in the inbox for an unsaved project");

        host.bpm = 133.0;
        proc.setRateAndBufferSizeDetails (sr, block); proc.prepareToPlay (sr, block);
        AudioBuffer<float> sb (2, block); sb.clear(); host.playing = false; proc.processBlock (sb, midi); // lets the plugin read the host tempo
        CHECK (proc.saveToStudioHq ("My Moon Beat", g, m), "saves the project (" + m + ")");
        auto items = sup.getChildFile ("inbox").findChildFiles (File::findFiles, false, "*.json");
        CHECK (items.size() == 1, "one file appears in the inbox");
        if (items.size() == 1)
        {
            auto j = JSON::parse (items[0]);
            CHECK (j.getProperty ("name", {}).toString() == "My Moon Beat", "the inbox file carries the chosen name");
            CHECK (std::abs ((double) j.getProperty ("bpm", 0) - 133.0) < 0.01, "...and FL's tempo (133)");
            CHECK (File (j.getProperty ("flp", {}).toString()) == g.flp, "...and the project file path");
        }
        CHECK (sup.getChildFile ("inbox").findChildFiles (File::findFiles, false, "*.tmp").isEmpty(), "no half-written temp files are left");


        // ---- preview loop: the last bars the host played, kept as the project's preview ----
        {
            touch (projects.getChildFile ("Backup/Moon (autosaved on 15-10-26 at 15h00).flp"), 0); // back to working on Moon
            host.bpm = 120.0; host.playing = true; host.ppq = 0.0;
            proc.setRateAndBufferSizeDetails (sr, block); proc.prepareToPlay (sr, block);
            String lm;
            CHECK (! proc.saveLoopForProject (lm), "no loop is saved before anything has played (" + lm.substring (0, 30) + "...)");
            const int blocks = (int) (sr * 2.0 * 6.3 / block); // 6.3 bars of 120 bpm 4/4
            for (int b = 0; b < blocks; ++b) { feed (1); host.ppq += (double) block / sr * 2.0; }
            host.playing = false;
            CHECK (proc.saveLoopForProject (lm), "saves a loop after playing (" + lm + ")");
            auto loops = sup.getChildFile ("loops").findChildFiles (File::findFiles, false, "*.wav");
            CHECK (loops.size() == 1, "one loop WAV is written");
            if (loops.size() == 1)
            {
                WavAudioFormat wf;
                std::unique_ptr<AudioFormatReader> rd (wf.createReaderFor (loops[0].createInputStream().release(), true));
                const double secs = rd ? (double) rd->lengthInSamples / rd->sampleRate : 0.0;
                CHECK (std::abs (secs - 8.0) < 0.02, "it is exactly 4 bars at 120 bpm (8 s), got " + String (secs, 3));
                AudioBuffer<float> chk (2, (int) rd->lengthInSamples); rd->read (&chk, 0, (int) rd->lengthInSamples, 0, true, true);
                CHECK (chk.getMagnitude (0, chk.getNumSamples()) > 0.1f, "and it contains the audio that played");
            }
            bool found = false;
            for (auto& f : sup.getChildFile ("inbox").findChildFiles (File::findFiles, false, "*.json"))
                if (JSON::parse (f).getProperty ("kind", {}).toString() == "loop") found = true;
            CHECK (found, "the app is told about the loop through the inbox");
        }

        touch (projects.getChildFile ("Backup/untitled (autosaved on 15-10-26 at 14h50).flp"), 0);
        // the panel uses the same logic
        SavePanel sp (proc);
        sp.setBounds (0, 0, 660, 400);
        CHECK (sp.currentGuess().name == "untitled", "the panel shows what FL is working on");

        setenv ("SHQ_SUPPORT_DIR", tmpSupport.getFullPathName().toRawUTF8(), 1);
        sup.deleteRecursively();
    }

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
        shot ("editor-save");
        if (auto* be = dynamic_cast<BridgeEditor*> (ed.get()))
        {
            be->selectTab (1);
            shot ("editor-idle");
            be->selectTab (2);
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
    if (auto* snapPath = std::getenv ("SHQ_SNAPSHOT"))
    {
        for (int t = 0; t < 3; ++t)
        {
            std::unique_ptr<AudioProcessorEditor> ed (proc.createEditor());
            ed->setSize (700, 620);
            if (auto* be = dynamic_cast<BridgeEditor*> (ed.get())) be->selectTab (t);
            auto img = ed->createComponentSnapshot (ed->getLocalBounds(), true, 1.0f);
            PNGImageFormat png;
            File out (String (snapPath) + "/tab" + String (t) + ".png");
            out.deleteFile();
            if (auto os = out.createOutputStream()) png.writeImageToStream (img, *os);
        }
    }
    proc.prepareToPlay (sr, block); // clears the capture, so closing the test plugin doesn't save a loop into the real app folder
    std::cout << (failures == 0 ? "\nALL PASSED" : "\nSOME FAILED") << std::endl;
    return failures == 0 ? 0 : 1;
}
