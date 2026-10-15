#include "SavePanel.h"

using namespace juce;

static const Colour kPanel (0xff14161a), kLine (0xff23262c), kText (0xffe7e8ea), kDim (0xff8b8f98), kAccent (0xffff6b3d), kGood (0xff4cc38a), kWarn (0xffe8b93a);

SavePanel::SavePanel (BridgeProcessor& p) : proc (p)
{
    auto label = [this] (Label& l, Font f, Colour c, Justification j = Justification::centredLeft)
    { l.setFont (f); l.setColour (Label::textColourId, c); l.setJustificationType (j); addAndMakeVisible (l); };
    label (nameLabel, FontOptions (11.0f, Font::bold), kDim);
    nameLabel.setText ("BEAT NAME IN STUDIO HQ", dontSendNotification);
    label (projectLine, FontOptions (15.0f, Font::bold), kText);
    label (noteLine, FontOptions (12.5f), kDim);
    label (status, FontOptions (13.5f), kGood);
    label (hint, FontOptions (12.5f), kDim);
    hint.setJustificationType (Justification::topLeft);
    hint.setText (u8 ("No recording needed. Studio HQ adds this project to your Vault so you can track it, tag it and open it in FL. When you export a bounce into your beat folder, it links up on its own."), dontSendNotification);

    nameEdit.setFont (FontOptions (15.0f));
    nameEdit.setIndents (10, 8);
    nameEdit.setTextToShowWhenEmpty (u8 ("Leave empty to use the project name"), kDim);
    nameEdit.onTextChange = [this] { nameTouched = true; };
    addAndMakeVisible (nameEdit);

    refreshBtn.onClick = [this] { refresh(); };
    addAndMakeVisible (refreshBtn);

    saveBtn.setColour (TextButton::buttonColourId, kAccent.withMultipliedBrightness (0.9f));
    saveBtn.setColour (TextButton::textColourOffId, Colours::white);
    saveBtn.onClick = [this]
    {
        String msg;
        resultOk = proc.saveToStudioHq (nameEdit.getText(), guess, msg);
        result = msg;
        if (resultOk) result += "  Open Studio HQ to see it in your Vault.";
        status.setColour (Label::textColourId, resultOk ? kGood : kWarn);
        status.setText (result, dontSendNotification);
    };
    addAndMakeVisible (saveBtn);

    refresh();
    startTimerHz (4);
}

SavePanel::~SavePanel() {}

void SavePanel::refresh()
{
    guess = BridgeProcessor::guessCurrentProject();
    projectLine.setText (guess.name.isEmpty() ? String (u8 ("No project found")) : "FL project: " + guess.name, dontSendNotification);
    noteLine.setColour (Label::textColourId, guess.unsaved || guess.name.isEmpty() ? kWarn : kDim);
    noteLine.setText (guess.note, dontSendNotification);
    saveBtn.setEnabled (guess.flp.existsAsFile());
    repaint();
}

void SavePanel::timerCallback()
{
    if (isVisible()) repaint (tempoArea);
}

void SavePanel::paint (Graphics& g)
{
    g.setColour (kPanel);
    g.fillRoundedRectangle (tempoArea.toFloat(), 10.0f);
    g.setColour (kLine);
    g.drawRoundedRectangle (tempoArea.toFloat().reduced (0.5f), 10.0f, 1.0f);
    const double bpm = proc.hostBpm.load();
    auto inner = tempoArea.reduced (16, 8);
    g.setColour (kText);
    g.setFont (FontOptions (30.0f, Font::bold));
    g.drawText (bpm > 0 ? String (bpm, 1) : String (u8 ("—")), inner.removeFromLeft (130), Justification::centredLeft);
    g.setColour (kDim);
    g.setFont (FontOptions (13.0f));
    g.drawText (u8 ("BPM, read from FL and saved with the beat"), inner, Justification::centredLeft);
}

void SavePanel::resized()
{
    auto b = getLocalBounds();
    projectLine.setBounds (b.removeFromTop (24));
    auto row = b.removeFromTop (22);
    refreshBtn.setBounds (row.removeFromRight (80).translated (0, 0));
    noteLine.setBounds (row);
    b.removeFromTop (14);
    tempoArea = b.removeFromTop (60);
    b.removeFromTop (16);
    nameLabel.setBounds (b.removeFromTop (16));
    nameEdit.setBounds (b.removeFromTop (36));
    b.removeFromTop (18);
    saveBtn.setBounds (b.removeFromTop (60));
    b.removeFromTop (12);
    status.setBounds (b.removeFromTop (44));
    hint.setBounds (b.removeFromTop (70));
}
