#pragma once
#include "PluginProcessor.h"

/** The main tab: one button that registers the open FL project in Studio HQ. No recording involved. */
class SavePanel : public juce::Component, private juce::Timer
{
public:
    explicit SavePanel (BridgeProcessor&);
    ~SavePanel() override;
    void resized() override;
    void paint (juce::Graphics&) override;
    void refresh();
    void pressSave() { saveBtn.onClick(); }
    juce::String statusText() const { return result; }
    BridgeProcessor::ProjectGuess currentGuess() const { return guess; }

private:
    void timerCallback() override;

    BridgeProcessor& proc;
    BridgeProcessor::ProjectGuess guess;
    juce::Label nameLabel, projectLine, noteLine, hint, status;
    juce::TextEditor nameEdit;
    juce::TextButton refreshBtn { "Refresh" }, saveBtn { "Save to Studio HQ" };
    juce::String result;
    bool resultOk = false;
    bool nameTouched = false;
    juce::Rectangle<int> tempoArea;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SavePanel)
};
