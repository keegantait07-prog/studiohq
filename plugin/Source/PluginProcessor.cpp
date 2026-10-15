#include "PluginProcessor.h"
#include "PluginEditor.h"

using namespace juce;

BridgeProcessor::BridgeProcessor()
    : AudioProcessor (BusesProperties().withInput ("Input", AudioChannelSet::stereo(), true)
                                       .withOutput ("Output", AudioChannelSet::stereo(), true))
{
    vaultFolder = defaultVaultFolder();
    writerThread.startThread (Thread::Priority::normal);
    formatManager.registerBasicFormats();
    previewThread.startThread (Thread::Priority::normal);
}

BridgeProcessor::~BridgeProcessor()
{
    { String ignored; saveLoopForProject (ignored); } // closing the project / removing the plugin keeps a loop to remember it by
    cancelPendingUpdate();
    closeWriter (true);
    transport.setSource (nullptr);
    readerSource.reset();
    previewThread.stopThread (2000);
    writerThread.stopThread (2000);
}

File BridgeProcessor::supportDir()
{
    if (auto o = SystemStats::getEnvironmentVariable ("SHQ_SUPPORT_DIR", {}); o.isNotEmpty()) return File (o);
    return File::getSpecialLocation (File::userHomeDirectory).getChildFile ("Library/Application Support/Studio HQ");
}

File BridgeProcessor::defaultVaultFolder()
{
    // Studio HQ writes its first watched beat folder here, so a new plugin lands in the right place.
    const auto cfg = supportDir().getChildFile ("bridge.json");
    if (cfg.existsAsFile())
    {
        auto v = JSON::parse (cfg);
        auto f = v.getProperty ("vaultFolder", {}).toString();
        if (f.isNotEmpty()) return File (f);
    }
    return File::getSpecialLocation (File::userDesktopDirectory).getChildFile ("! BEATS");
}

bool BridgeProcessor::isBusesLayoutSupported (const BusesLayout& l) const
{
    const auto o = l.getMainOutputChannelSet();
    return (o == AudioChannelSet::stereo() || o == AudioChannelSet::mono()) && o == l.getMainInputChannelSet();
}

void BridgeProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    if (state.load() == State::Armed && std::abs (sampleRate - rate) > 0.5) { /* writer was made for the old rate */ cancelRecording(); }
    rate = sampleRate;
    blockSize = samplesPerBlock;
    currentRate = sampleRate;
    previewBuffer.setSize (2, samplesPerBlock, false, false, true);
    transport.prepareToPlay (samplesPerBlock, sampleRate);
    {
        const ScopedLock rl (ringLock);
        loopRing.setSize (2, (int) (sampleRate * 40.0)); // 40 s is 16 bars at 96 bpm
        loopRing.clear();
        ringTotal = 0; lastBarMark = -1; lastBarIndex = -1.0;
        ringHasAudio = false;
    }
}

// ---------------------------------------------------------------------------------------------
void BridgeProcessor::processBlock (AudioBuffer<float>& buffer, MidiBuffer&)
{
    ScopedNoDenormals noDenormals;
    const int n = buffer.getNumSamples();
    const int chans = buffer.getNumChannels();

    // what the host tells us
    bool playing = false;
    double bpm = 0.0;
    if (auto* ph = getPlayHead())
        if (auto pos = ph->getPosition())
        {
            playing = pos->getIsPlaying();
            if (auto b = pos->getBpm()) bpm = *b;
            if (auto ts = pos->getTimeSignature()) { timeSigNum = ts->numerator; timeSigDen = ts->denominator; }
        }
    hostBpm = bpm;
    hostPlaying = playing;

    // rolling capture for the preview loop (only while the host plays; never includes the sound preview)
    if (playing && loopRing.getNumSamples() > 0)
    {
        const ScopedTryLock rl (ringLock);
        if (rl.isLocked())
        {
            const int size = loopRing.getNumSamples();
            if (bpm > 20.0) ringBpm = bpm;
            ringBeatsPerBar = jmax (1, (int) std::round (timeSigNum.load() * 4.0 / jmax (1, timeSigDen.load())));
            double barIdx = -1.0;
            if (auto* ph2 = getPlayHead())
                if (auto pos2 = ph2->getPosition())
                    if (auto ppq = pos2->getPpqPosition()) barIdx = std::floor (*ppq / ringBeatsPerBar);
            if (barIdx >= 0.0 && barIdx != lastBarIndex) { if (barIdx < lastBarIndex) lastBarMark = -1; lastBarIndex = barIdx; lastBarMark = ringTotal; }
            for (int c = 0; c < 2; ++c)
            {
                const float* src = buffer.getReadPointer (jmin (c, chans - 1));
                int w = (int) (ringTotal % size);
                const int first = jmin (n, size - w);
                loopRing.copyFrom (c, w, src, first);
                if (first < n) loopRing.copyFrom (c, 0, src + first, n - first);
            }
            ringTotal += n;
            ringHasAudio = true;
        }
    }

    // meters
    // the editor reads these and lets them fall, so keep the highest value since it last looked
    peakL = jmax (peakL.load(), buffer.getMagnitude (0, 0, n));
    peakR = jmax (peakR.load(), chans > 1 ? buffer.getMagnitude (1, 0, n) : buffer.getMagnitude (0, 0, n));

    // auto mode: record from play to stop
    const auto st = state.load();
    if (autoMode && st == State::Armed && playing && ! wasPlaying)
    {
        recordBpm = bpm;
        samplesWritten = 0;
        samplesDropped = 0;
        state = State::Recording;
    }
    else if (autoMode && st == State::Recording && ! playing && wasPlaying)
    {
        state = State::Saving;
        triggerAsyncUpdate();
    }
    wasPlaying = playing;

    if (state.load() == State::Recording)
    {
        if (bpmPending.exchange (false)) recordBpm = bpm; // manual mode: take the tempo from the first block we actually record
        const ScopedTryLock sl (writerLock);
        if (sl.isLocked())
            if (auto* w = activeWriter.load())
            {
                const float* chPtrs[2] = { buffer.getReadPointer (0), buffer.getReadPointer (chans > 1 ? 1 : 0) };
                bool ok = w->write (chPtrs, n);
                // offline renders run faster than the disk: wait for room rather than dropping audio
                for (int tries = 0; ! ok && isNonRealtime() && tries < 2000; ++tries) { Thread::sleep (1); ok = w->write (chPtrs, n); }
                if (ok) samplesWritten += n; else samplesDropped += n;
            }
    }

    // Sound preview is mixed in after the recording above, so it can never end up in a bounce.
    if (transport.isPlaying())
    {
        for (int start = 0; start < n; start += previewBuffer.getNumSamples())
        {
            const int len = jmin (previewBuffer.getNumSamples(), n - start);
            previewBuffer.clear();
            AudioSourceChannelInfo info (&previewBuffer, 0, len);
            transport.getNextAudioBlock (info);
            const float g = previewGain.load();
            for (int ch = 0; ch < jmin (chans, 2); ++ch) buffer.addFrom (ch, start, previewBuffer, ch, 0, len, g);
        }
    }
    // everything else passes through unchanged
}

bool BridgeProcessor::loadPreview (const File& file, String& error)
{
    std::unique_ptr<AudioFormatReader> reader (formatManager.createReaderFor (file));
    if (reader == nullptr) { error = "Can't play this kind of file: " + file.getFileName(); return false; }
    const double fileRate = reader->sampleRate;
    auto src = std::make_unique<AudioFormatReaderSource> (reader.release(), true);
    src->setLooping (looping);
    transport.stop();
    transport.setSource (nullptr);
    readerSource = std::move (src);
    transport.setSource (readerSource.get(), 32768, &previewThread, fileRate, 2);
    transport.setPosition (0.0);
    transport.start();
    return true;
}

void BridgeProcessor::stopPreview()
{
    transport.stop();
    transport.setPosition (0.0);
}

void BridgeProcessor::togglePreview()
{
    if (readerSource == nullptr) return;
    if (transport.isPlaying()) transport.stop();
    else { if (transport.hasStreamFinished()) transport.setPosition (0.0); transport.start(); }
}

// ---------------------------------------------------------------------------------------------
bool BridgeProcessor::openWriter()
{
    const ScopedLock sl (writerLock);
    activeWriter = nullptr;
    threadedWriter.reset();

    if (! vaultFolder.createDirectory().wasOk()) { if (onMessage) onMessage ("Can't use the folder " + vaultFolder.getFullPathName()); return false; }
    partialFile = vaultFolder.getChildFile (".studio-hq-recording-" + String (Time::currentTimeMillis()) + ".partial");
    std::unique_ptr<OutputStream> stream (partialFile.createOutputStream());
    if (stream == nullptr) { if (onMessage) onMessage ("Can't write in " + vaultFolder.getFullPathName()); return false; }

    WavAudioFormat wav;
    auto w = wav.createWriterFor (stream, AudioFormatWriterOptions().withSampleRate (rate).withNumChannels (2).withBitsPerSample (24));
    if (w == nullptr) { partialFile.deleteFile(); return false; }
    threadedWriter.reset (new AudioFormatWriter::ThreadedWriter (w.release(), writerThread, 1 << 20)); // about 20 s of audio of headroom
    activeWriter = threadedWriter.get();
    return true;
}

void BridgeProcessor::closeWriter (bool deleteFile)
{
    {
        const ScopedLock sl (writerLock);
        activeWriter = nullptr;
        threadedWriter.reset(); // flushes and closes the file
    }
    if (deleteFile && partialFile != File()) partialFile.deleteFile();
}

void BridgeProcessor::startRecording()
{
    if (state.load() != State::Idle) return;
    if (! openWriter()) return;
    samplesWritten = 0;
    samplesDropped = 0;
    wasPlaying = hostPlaying.load();
    if (autoMode)
    {
        state = State::Armed;
        if (onMessage) onMessage ("Armed. Press play in FL Studio to start recording.");
    }
    else
    {
        bpmPending = true;
        state = State::Recording;
        if (onMessage) onMessage (u8 ("Recording…"));
    }
}

void BridgeProcessor::stopAndSave()
{
    const auto st = state.load();
    if (st == State::Recording) { state = State::Saving; handleAsyncUpdate(); }
    else if (st == State::Armed) cancelRecording();
}

void BridgeProcessor::cancelRecording()
{
    state = State::Idle;
    closeWriter (true);
    if (onMessage) onMessage ("Cancelled.");
}

File BridgeProcessor::finalFileFor (double bpm) const
{
    String base = bounceName.trim();
    if (base.isEmpty()) base = "FL bounce " + Time::getCurrentTime().formatted ("%Y-%m-%d %H-%M");
    base = base.removeCharacters ("\\/:*?\"<>|").trim();
    String tempo;
    if (bpm > 20.0 && bpm < 400.0)
        tempo = std::abs (bpm - std::round (bpm)) < 0.05 ? String ((int) std::round (bpm)) : String (bpm, 1);
    const String stem = tempo.isEmpty() ? base : base + " (" + tempo + "bpm)";
    auto f = vaultFolder.getChildFile (stem + ".wav");
    for (int i = 2; f.exists(); ++i) f = vaultFolder.getChildFile (stem + " (" + String (i) + ").wav");
    return f;
}

void BridgeProcessor::handleAsyncUpdate()
{
    if (state.load() != State::Saving) return;
    const double bpm = recordBpm.load();
    const auto frames = samplesWritten.load();
    const auto dropped = samplesDropped.load();
    closeWriter (false);

    if (frames < (juce::int64) (rate * 0.5))
    {
        partialFile.deleteFile();
        state = State::Idle;
        if (onMessage) onMessage ("Nothing recorded (it needs at least half a second).");
        return;
    }
    const auto dest = finalFileFor (bpm);
    if (partialFile.moveFileTo (dest))
    {
        lastSaved = dest;
        // JUCE can't encode MP3, so Studio HQ converts this recording to MP3 and removes the WAV
        {
            auto* o = new DynamicObject();
            o->setProperty ("version", 2);
            o->setProperty ("kind", "bounce");
            o->setProperty ("wav", dest.getFullPathName());
            o->setProperty ("bpm", bpm);
            const auto inbox = supportDir().getChildFile ("inbox");
            inbox.createDirectory();
            auto tmp = inbox.getChildFile ("bounce-" + String (Time::currentTimeMillis()) + ".tmp");
            if (tmp.replaceWithText (JSON::toString (var (o)))) tmp.moveFileTo (tmp.withFileExtension ("json"));
        }
        if (onSaved) onSaved (dest, bpm);
        if (onMessage) onMessage ("Saved " + dest.getFileName() + " (Studio HQ turns it into an MP3)" + (dropped > 0 ? "  (warning: some audio was dropped)" : ""));
    }
    else
    {
        if (onMessage) onMessage ("Couldn't save the file in " + vaultFolder.getFullPathName());
        partialFile.deleteFile();
    }
    state = State::Idle;
    if (keepArmed) startRecording();
}

// ---------------------------------------------------------------------------------------------
void BridgeProcessor::getStateInformation (MemoryBlock& dest)
{
    auto* o = new DynamicObject();
    o->setProperty ("name", bounceName);
    o->setProperty ("folder", vaultFolder.getFullPathName());
    o->setProperty ("auto", autoMode);
    o->setProperty ("keepArmed", keepArmed);
    MemoryOutputStream out (dest, false);
    out.writeString (JSON::toString (var (o)));
}

void BridgeProcessor::setStateInformation (const void* data, int size)
{
    auto v = JSON::parse (String::fromUTF8 ((const char*) data, size));
    if (! v.isObject()) return;
    bounceName = v.getProperty ("name", "").toString();
    auto f = v.getProperty ("folder", "").toString();
    if (f.isNotEmpty()) vaultFolder = File (f);
    autoMode = (bool) v.getProperty ("auto", true);
    keepArmed = (bool) v.getProperty ("keepArmed", false);
}

AudioProcessorEditor* BridgeProcessor::createEditor() { return new BridgeEditor (*this); }
AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new BridgeProcessor(); }


// ---------------------------------------------------------------------------------------------
namespace
{
    // FL names its autosaves like "Level Above (autosaved on 15-10-26 at 14h41).flp" (or "overwritten on").
    String projectNameFromBackup (const String& fileName)
    {
        auto n = fileName.upToLastOccurrenceOf (".flp", false, true);
        const int i = n.lastIndexOf (" (autosaved on ");
        const int j = n.lastIndexOf (" (overwritten on ");
        const int cut = jmax (i, j);
        return cut > 0 ? n.substring (0, cut) : String();
    }

    void collectFlps (const File& dir, int depth, Array<File>& mains, Array<File>& backups)
    {
        for (const auto& e : RangedDirectoryIterator (dir, false, "*", File::findFilesAndDirectories))
        {
            const auto f = e.getFile();
            if (f.getFileName().startsWithChar ('.')) continue;
            if (e.isDirectory())
            {
                if (depth >= 4) continue;
                if (f.getFileName() == "Backup") { for (const auto& b : RangedDirectoryIterator (f, false, "*.flp")) backups.add (b.getFile()); continue; }
                if (f.getFileName().equalsIgnoreCase ("Templates")) continue;
                collectFlps (f, depth + 1, mains, backups);
            }
            else if (f.hasFileExtension (".flp")) mains.add (f);
        }
    }
}

BridgeProcessor::ProjectGuess BridgeProcessor::guessCurrentProject()
{
    ProjectGuess g;
    StringArray roots;
    if (auto cfg = supportDir().getChildFile ("bridge.json"); cfg.existsAsFile())
    {
        const var parsed = JSON::parse (cfg);           // keep the value alive while we read its array
        const var folders = parsed.getProperty ("projectFolders", {});
        if (auto* arr = folders.getArray()) for (auto& r : *arr) roots.add (r.toString());
    }
    if (roots.isEmpty()) roots.add (File::getSpecialLocation (File::userHomeDirectory).getChildFile ("Documents/Image-Line/FL Studio/Projects").getFullPathName());

    Array<File> mains, backups;
    for (auto& r : roots) if (File (r).isDirectory()) collectFlps (File (r), 0, mains, backups);

    // the most recent thing FL touched: either a saved project file or one of its autosaves
    File newestMain, newestBackup;
    for (auto& f : mains) if (newestMain == File() || f.getLastModificationTime() > newestMain.getLastModificationTime()) newestMain = f;
    for (auto& f : backups) if (projectNameFromBackup (f.getFileName()).isNotEmpty() && (newestBackup == File() || f.getLastModificationTime() > newestBackup.getLastModificationTime())) newestBackup = f;

    if (newestMain == File() && newestBackup == File())
    {
        g.note = "No FL projects found. Save your project in FL (Cmd+S), then press Refresh.";
        return g;
    }

    const bool useBackup = newestBackup != File() && (newestMain == File() || newestBackup.getLastModificationTime() > newestMain.getLastModificationTime());
    File touched = useBackup ? newestBackup : newestMain;
    g.name = useBackup ? projectNameFromBackup (newestBackup.getFileName()) : newestMain.getFileNameWithoutExtension();
    g.ageSeconds = (Time::getCurrentTime() - touched.getLastModificationTime()).inSeconds();

    // find the saved file with that name
    for (auto& f : mains) if (f.getFileNameWithoutExtension() == g.name) { if (g.flp == File() || f.getLastModificationTime() > g.flp.getLastModificationTime()) g.flp = f; }
    if (g.flp == File())
    {
        g.unsaved = true;
        g.note = "FL is working on \"" + g.name + "\", which hasn't been saved yet. Save it in FL (Cmd+S), then press Refresh.";
    }
    else
    {
        const auto mins = g.ageSeconds / 60;
        g.note = mins < 1 ? "Active just now" : mins < 90 ? "Last activity " + String (mins) + " min ago" : "Last activity " + String (mins / 60) + " h ago. If this isn't the project you're on, save yours in FL and press Refresh.";
    }
    return g;
}

bool BridgeProcessor::saveToStudioHq (const String& name, const ProjectGuess& project, String& message)
{
    if (! project.flp.existsAsFile()) { message = project.note.isNotEmpty() ? project.note : "Save your project in FL (Cmd+S) first, then press Refresh."; return false; }
    const auto inbox = supportDir().getChildFile ("inbox");
    if (! inbox.createDirectory().wasOk()) { message = "Can't write to " + inbox.getFullPathName(); return false; }

    auto* o = new DynamicObject();
    const auto bpm = hostBpm.load();
    o->setProperty ("version", 1);
    o->setProperty ("name", name.trim()); // empty = let Studio HQ tidy the project name itself
    o->setProperty ("bpm", bpm > 20.0 ? var (bpm) : var());
    o->setProperty ("timeSignature", var (Array<var> { timeSigNum.load(), timeSigDen.load() }));
    o->setProperty ("flp", project.flp.getFullPathName());
    o->setProperty ("savedAt", (juce::int64) Time::currentTimeMillis());
    o->setProperty ("source", "fl-plugin");

    // write to a temp name and rename, so the app never reads half a file
    const auto stem = String (Time::currentTimeMillis()) + "-" + String (Random::getSystemRandom().nextInt (100000));
    const auto tmp = inbox.getChildFile (stem + ".tmp");
    const auto dest = inbox.getChildFile (stem + ".json");
    if (! tmp.replaceWithText (JSON::toString (var (o))) || ! tmp.moveFileTo (dest)) { message = "Couldn't write to Studio HQ's inbox."; tmp.deleteFile(); return false; }

    message = "Saved \"" + (name.trim().isEmpty() ? project.name : name.trim()) + "\"" + (bpm > 20.0 ? " at " + String (bpm, std::abs (bpm - std::round (bpm)) < 0.05 ? 0 : 1) + " BPM" : String()) + " to Studio HQ.";
    { String loopMsg; if (saveLoopForProject (loopMsg)) message += " Kept a loop of what you played as its preview."; }
    return true;
}

// ---------------------------------------------------------------------------------------------
bool BridgeProcessor::saveLoopForProject (String& message)
{
    if (! ringHasAudio.load()) { message = "Nothing played yet, so there is no loop to keep."; return false; }
    const auto guess = guessCurrentProject();
    if (! guess.flp.existsAsFile()) { message = "Save the project in FL Studio first, so the loop has a project to belong to."; return false; }

    AudioBuffer<float> out;
    {
        const ScopedLock rl (ringLock);
        const int size = loopRing.getNumSamples();
        const juce::int64 have = jmin<juce::int64> (ringTotal, size);
        if (have < (juce::int64) (rate * 2.0)) { message = "Not enough audio played to make a loop (needs a couple of seconds)."; return false; }
        const double barSamples = ringBpm > 20.0 ? rate * 60.0 / ringBpm * ringBeatsPerBar : 0.0;
        juce::int64 end = ringTotal, len = (juce::int64) (rate * 8.0);
        // prefer whole bars ending on the last bar line: 4 bars, else 2, else 1
        if (barSamples > 0.0 && lastBarMark > 0)
            for (int bars : { 4, 2, 1 })
            {
                const auto l = (juce::int64) std::llround (barSamples * bars);
                if (l <= have && l <= lastBarMark && ringTotal - lastBarMark < (juce::int64) (barSamples * 1.5)) { end = lastBarMark; len = l; break; }
            }
        len = jmin (len, have);
        out.setSize (2, (int) len);
        for (int c = 0; c < 2; ++c)
            for (juce::int64 i = 0; i < len; ++i)
                out.setSample (c, (int) i, loopRing.getSample (c, (int) ((end - len + i) % size)));
    }
    // a click-free loop point: 5 ms fade at both ends
    const int fade = jmin (out.getNumSamples() / 4, (int) (rate * 0.005));
    for (int i = 0; i < fade; ++i)
    {
        const float g = (float) i / (float) fade;
        for (int c = 0; c < 2; ++c) { out.setSample (c, i, out.getSample (c, i) * g); const int j = out.getNumSamples() - 1 - i; out.setSample (c, j, out.getSample (c, j) * g); }
    }
    const auto dir = supportDir().getChildFile ("loops");
    dir.createDirectory();
    auto wavFile = dir.getChildFile ("loop-" + String (Time::currentTimeMillis()) + ".wav");
    {
        WavAudioFormat wav;
        std::unique_ptr<OutputStream> stream (wavFile.createOutputStream());
        if (stream == nullptr) { message = "Couldn't write the loop."; return false; }
        auto w = wav.createWriterFor (stream, AudioFormatWriterOptions().withSampleRate (rate).withNumChannels (2).withBitsPerSample (16));
        if (w == nullptr) { message = "Couldn't write the loop."; return false; }
        w->writeFromAudioSampleBuffer (out, 0, out.getNumSamples());
    }
    auto* o = new DynamicObject();
    o->setProperty ("version", 2);
    o->setProperty ("kind", "loop");
    o->setProperty ("flp", guess.flp.getFullPathName());
    o->setProperty ("wav", wavFile.getFullPathName());
    o->setProperty ("bpm", ringBpm);
    const auto inbox = supportDir().getChildFile ("inbox");
    inbox.createDirectory();
    auto tmp = inbox.getChildFile ("loop-" + String (Time::currentTimeMillis()) + ".tmp");
    if (! tmp.replaceWithText (JSON::toString (var (o))) || ! tmp.moveFileTo (tmp.withFileExtension ("json"))) { message = "Couldn't hand the loop to Studio HQ."; return false; }
    message = "Kept a " + String (out.getNumSamples() / rate, 1) + " s loop as the preview for " + guess.name + ".";
    return true;
}
