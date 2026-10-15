#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>

/** The JUCE String(const char*) constructor assumes ASCII, so literals with symbols go through this. */
inline juce::String u8 (const char* s) { return juce::String::fromUTF8 (s); }

/** Studio HQ Bridge: passes audio through untouched and can record it into your Studio HQ Vault folder.
    Put it on FL Studio's Master track. The recorded file is named "<name> (<tempo>bpm).wav" using the
    host's tempo, so Studio HQ picks up the BPM from the file name. */
class BridgeProcessor : public juce::AudioProcessor, private juce::AsyncUpdater
{
public:
    enum class State { Idle = 0, Armed, Recording, Saving };

    BridgeProcessor();
    ~BridgeProcessor() override;

    // ---- AudioProcessor ----
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override { transport.releaseResources(); }
    bool isBusesLayoutSupported (const BusesLayout&) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Studio HQ Bridge"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    // ---- recording controls (message thread) ----
    /** Auto mode: waits for the host to start playing, records until it stops. Manual: records right now. */
    void startRecording();
    void stopAndSave();
    void cancelRecording();

    // ---- settings (message thread) ----
    juce::String bounceName;
    juce::File vaultFolder;
    bool autoMode = true;
    bool keepArmed = false;

    // ---- live info for the UI (any thread) ----
    std::atomic<State> state { State::Idle };
    std::atomic<double> hostBpm { 0.0 };
    std::atomic<bool> hostPlaying { false };
    std::atomic<int> timeSigNum { 4 }, timeSigDen { 4 };
    std::atomic<float> peakL { 0.f }, peakR { 0.f };
    std::atomic<juce::int64> samplesWritten { 0 };
    std::atomic<juce::int64> samplesDropped { 0 };
    std::atomic<double> currentRate { 44100.0 };

    std::function<void (const juce::File&, double bpm)> onSaved;
    std::function<void (const juce::String&)> onMessage;

    static juce::File defaultVaultFolder();

    // ---- "Save to Studio HQ": register the project as a beat, no recording needed ----
    struct ProjectGuess
    {
        juce::File flp;            // the saved project file, if found
        juce::String name;         // project name FL is using
        juce::int64 ageSeconds = -1; // how long ago FL last touched it
        bool unsaved = false;      // FL is working on a project that has no file yet
        juce::String note;         // human-readable explanation for the UI
    };
    /** Supports a folder override for tests (SHQ_SUPPORT_DIR). */
    static juce::File supportDir();
    /** Works out which FL project is open from FL's autosave file names ("<name> (autosaved on ... ).flp"). */
    static ProjectGuess guessCurrentProject();
    /** Drops a small file in Studio HQ's inbox. The app adds the beat when it sees it. */
    bool saveToStudioHq (const juce::String& name, const ProjectGuess& project, juce::String& message);
    juce::File lastSaved;

    // ---- preview loop: the last few bars the host played, saved as the beat's preview ----
    /** Writes the captured loop for the open project and tells Studio HQ. Called on close and when you press Save. */
    bool saveLoopForProject (juce::String& message);

    // ---- sound preview (message thread) ----
    /** Loads and starts playing a sample through this plugin's output. Never part of a recording. */
    bool loadPreview (const juce::File& file, juce::String& error);
    void stopPreview();
    void togglePreview();
    bool isPreviewPlaying() const { return transport.isPlaying(); }
    double previewLengthSeconds() const { return transport.getLengthInSeconds(); }
    double previewPositionSeconds() const { return transport.getCurrentPosition(); }
    void setPreviewPosition (double seconds) { transport.setPosition (seconds); }
    void setPreviewLooping (bool b) { looping = b; if (readerSource) readerSource->setLooping (b); }
    std::atomic<float> previewGain { 0.8f };

private:
    void handleAsyncUpdate() override;
    bool openWriter();
    void closeWriter (bool deleteFile);
    juce::File finalFileFor (double bpm) const;

    juce::TimeSliceThread writerThread { "Studio HQ writer" };
    juce::CriticalSection writerLock;
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> threadedWriter;
    std::atomic<juce::AudioFormatWriter::ThreadedWriter*> activeWriter { nullptr };
    juce::File partialFile;
    std::atomic<double> recordBpm { 0.0 };
    std::atomic<bool> bpmPending { false };
    bool wasPlaying = false;
    double rate = 44100.0;
    int blockSize = 512;

    juce::AudioFormatManager formatManager;
    juce::TimeSliceThread previewThread { "Studio HQ preview" };
    juce::AudioTransportSource transport;
    std::unique_ptr<juce::AudioFormatReaderSource> readerSource;
    juce::AudioBuffer<float> previewBuffer;
    bool looping = false;

    // rolling capture (audio thread writes; a mutex-free snapshot is taken only when nothing is playing or on the message thread)
    juce::AudioBuffer<float> loopRing;
    juce::int64 ringTotal = 0;          // samples written since the ring was prepared
    juce::int64 lastBarMark = -1;       // ringTotal at the most recent bar line
    double lastBarIndex = -1.0;
    double ringBpm = 0.0;
    int ringBeatsPerBar = 4;
    std::atomic<bool> ringHasAudio { false };
    juce::CriticalSection ringLock;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BridgeProcessor)
};
