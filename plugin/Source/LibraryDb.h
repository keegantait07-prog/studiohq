#pragma once
#include <juce_core/juce_core.h>

/** Read-only view of the Studio HQ library (sounds, FL projects and their MIDI), straight from its database,
    so the browser works even when the Studio HQ app is closed. */
struct SoundItem
{
    int id = 0;
    juce::File file;
    juce::String name, ext, kind, key, tags, dirRel, hay;
    double duration = 0.0, bpm = 0.0;
    bool favorite = false;
    int notes = 0; // MIDI only
    bool isMidi() const { return kind == "midi"; }
};

struct ProjectItem
{
    int id = 0;
    juce::String name;
    juce::Array<int> soundIds;
    int samples = 0, midis = 0;
};

class LibraryDb
{
public:
    static juce::File defaultDbFile();
    /** Loads everything into memory (a second or so for ~20k sounds). Call off the message thread. */
    bool load (const juce::File& dbFile, juce::String& error);

    juce::Array<SoundItem> sounds;
    juce::Array<ProjectItem> projects;
    juce::StringArray kinds;
    juce::HashMap<int, int> indexById; // sound id -> position in `sounds`
};
