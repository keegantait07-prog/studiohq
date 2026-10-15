#pragma once
#include "PluginProcessor.h"
#include "LibraryDb.h"

/** The sound and MIDI browser tab: search the Studio HQ library, preview samples through the plugin,
    and drag files into FL Studio. */
class SoundsPanel : public juce::Component, private juce::ListBoxModel, private juce::Timer
{
public:
    explicit SoundsPanel (BridgeProcessor&);
    ~SoundsPanel() override;
    void resized() override;
    void paint (juce::Graphics&) override;
    bool keyPressed (const juce::KeyPress&) override;
    void reload();

    // for tests
    int numRowsShown() const { return rows.size(); }
    bool loaded() const { return db != nullptr; }
    void setSearch (const juce::String& s) { search.setText (s, false); applyFilter(); }
    void setKind (const juce::String& k);
    void selectRowForTest (int row) { list.selectRow (row); }
    const SoundItem* itemAtRow (int row) const { return row >= 0 && row < rows.size() && db ? &db->sounds.getReference (rows[row]) : nullptr; }
    int numProjects() const { return db ? db->projects.size() : 0; }
    void setProjectByIndex (int i) { sourceBox.setSelectedId (i + 2, juce::sendNotificationSync); }

private:
    struct RowComp;
    int getNumRows() override { return rows.size(); }
    void paintListBoxItem (int, juce::Graphics&, int, int, bool) override {}
    juce::Component* refreshComponentForRow (int row, bool selected, juce::Component* existing) override;
    void selectedRowsChanged (int lastRowSelected) override;
    void timerCallback() override;
    void applyFilter();
    void setData (std::shared_ptr<LibraryDb>, const juce::String& error);
    void playSelected();

    BridgeProcessor& proc;
    std::shared_ptr<LibraryDb> db;
    juce::Array<int> rows; // indices into db->sounds

    juce::TextEditor search;
    juce::ComboBox kindBox, sourceBox;
    juce::ToggleButton favBtn { "Favorites" }, autoBtn { "Auto-play" }, loopBtn { "Loop" };
    juce::TextButton refreshBtn { "Reload" }, playBtn { "Play" }, revealBtn { "Show in Finder" };
    juce::Slider volume;
    juce::ListBox list { {}, this };
    juce::Label info, count, nowPlaying;
    juce::String message;
    float progress = 0.f;
    juce::Rectangle<int> progressArea;
    juce::Component::SafePointer<juce::Component> self;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SoundsPanel)
};
