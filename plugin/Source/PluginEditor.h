#pragma once
#include "PluginProcessor.h"
#include "SoundsPanel.h"
#include "SavePanel.h"

class BridgeLookAndFeel : public juce::LookAndFeel_V4
{
public:
    BridgeLookAndFeel();
    void drawButtonBackground (juce::Graphics&, juce::Button&, const juce::Colour&, bool highlighted, bool down) override;
};

class BridgeEditor : public juce::AudioProcessorEditor, public juce::DragAndDropContainer, private juce::Timer
{
public:
    explicit BridgeEditor (BridgeProcessor&);
    SoundsPanel& soundsPanel() { return sounds; }
    SavePanel& saveTabPanel() { return savePanel; }
    void selectTab (int t) { showTab (t); }
    ~BridgeEditor() override;
    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void recordClicked();
    void chooseFolder();
    void showTab (int tab);
    int tab = 0;
    juce::TextButton saveTab { "Save to Studio HQ" }, bounceTab { "Record audio" }, soundsTab { "Sounds & MIDI" };
    SoundsPanel sounds;
    SavePanel savePanel;
    juce::Array<juce::Component*> bounceParts;

    BridgeProcessor& proc;
    BridgeLookAndFeel laf;
    juce::Label nameLabel, folderLabel, folderPath, status, lastSaved;
    juce::TextEditor nameEdit;
    juce::TextButton chooseBtn { u8 ("Choose…") }, openBtn { "Open" }, recBtn, revealBtn { "Show in Finder" };
    juce::ToggleButton autoToggle { "Record automatically when I press play in FL Studio" }, keepToggle { "Stay armed after saving" };
    std::unique_ptr<juce::FileChooser> chooser;
    float meterL = 0.f, meterR = 0.f;
    juce::Rectangle<int> tempoArea, meterArea;
    juce::String statusText;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BridgeEditor)
};
