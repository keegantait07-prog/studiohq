#include "PluginEditor.h"

using namespace juce;

static const Colour kBg (0xff0d0e11), kPanel (0xff14161a), kLine (0xff23262c), kText (0xffe7e8ea), kDim (0xff8b8f98), kAccent (0xffff6b3d), kGood (0xff4cc38a);

BridgeLookAndFeel::BridgeLookAndFeel()
{
    setColour (ResizableWindow::backgroundColourId, kBg);
    setColour (Label::textColourId, kText);
    setColour (TextEditor::backgroundColourId, Colour (0xff0f1013));
    setColour (TextEditor::textColourId, kText);
    setColour (TextEditor::outlineColourId, kLine);
    setColour (TextEditor::focusedOutlineColourId, kAccent);
    setColour (TextButton::buttonColourId, Colour (0xff1a1c21));
    setColour (TextButton::textColourOffId, kText);
    setColour (ToggleButton::textColourId, kText);
    setColour (ToggleButton::tickColourId, kAccent);
    setColour (ToggleButton::tickDisabledColourId, kDim);
}

void BridgeLookAndFeel::drawButtonBackground (Graphics& g, Button& b, const Colour& bg, bool highlighted, bool down)
{
    auto r = b.getLocalBounds().toFloat().reduced (0.5f);
    auto c = bg;
    if (down) c = c.brighter (0.15f); else if (highlighted) c = c.brighter (0.08f);
    g.setColour (c);
    g.fillRoundedRectangle (r, 8.0f);
    g.setColour (kLine);
    g.drawRoundedRectangle (r, 8.0f, 1.0f);
}

BridgeEditor::BridgeEditor (BridgeProcessor& p) : AudioProcessorEditor (&p), proc (p), sounds (p)
{
    setLookAndFeel (&laf);
    setSize (700, 620);

    auto label = [this] (Label& l, const String& t, Font f, Colour c, Justification j = Justification::centredLeft)
    { l.setText (t, dontSendNotification); l.setFont (f); l.setColour (Label::textColourId, c); l.setJustificationType (j); addAndMakeVisible (l); };
    label (nameLabel, "BEAT NAME", FontOptions (11.0f, Font::bold), kDim);
    label (folderLabel, "SAVE TO (YOUR STUDIO HQ VAULT FOLDER)", FontOptions (11.0f, Font::bold), kDim);
    label (folderPath, "", FontOptions (13.0f), kText);
    label (status, "", FontOptions (13.0f), kDim);
    label (lastSaved, "", FontOptions (13.0f), kGood);

    nameEdit.setText (proc.bounceName, false);
    nameEdit.setTextToShowWhenEmpty ("e.g. Moon  (leave empty to name it by date)", kDim);
    nameEdit.setFont (FontOptions (15.0f));
    nameEdit.setIndents (10, 8);
    nameEdit.onTextChange = [this] { proc.bounceName = nameEdit.getText(); };
    addAndMakeVisible (nameEdit);

    chooseBtn.onClick = [this] { chooseFolder(); };
    openBtn.onClick = [this] { proc.vaultFolder.createDirectory(); proc.vaultFolder.revealToUser(); };
    revealBtn.onClick = [this] { if (proc.lastSaved.existsAsFile()) proc.lastSaved.revealToUser(); };
    addAndMakeVisible (chooseBtn);
    addAndMakeVisible (openBtn);
    addChildComponent (revealBtn);

    autoToggle.setToggleState (proc.autoMode, dontSendNotification);
    autoToggle.onClick = [this] { proc.autoMode = autoToggle.getToggleState(); };
    keepToggle.setToggleState (proc.keepArmed, dontSendNotification);
    keepToggle.onClick = [this] { proc.keepArmed = keepToggle.getToggleState(); };
    addAndMakeVisible (autoToggle);
    addAndMakeVisible (keepToggle);

    recBtn.onClick = [this] { recordClicked(); };
    addAndMakeVisible (recBtn);

    proc.onMessage = [this] (const String& m) { statusText = m; };
    proc.onSaved = [this] (const File& f, double) { lastSaved.setText (u8 ("✓ ") + f.getFileName(), dontSendNotification); revealBtn.setVisible (true); };
    if (proc.lastSaved.existsAsFile()) { lastSaved.setText (u8 ("✓ ") + proc.lastSaved.getFileName(), dontSendNotification); revealBtn.setVisible (true); }

    bounceParts = { &nameLabel, &folderLabel, &folderPath, &status, &lastSaved, &nameEdit, &chooseBtn, &openBtn, &recBtn, &autoToggle, &keepToggle };
    for (auto* t : { &bounceTab, &soundsTab })
    {
        t->setClickingTogglesState (true);
        t->setRadioGroupId (7);
        t->setColour (TextButton::buttonOnColourId, kAccent.withMultipliedBrightness (0.8f));
        t->setColour (TextButton::textColourOnId, Colours::white);
        addAndMakeVisible (*t);
    }
    bounceTab.onClick = [this] { showTab (0); };
    soundsTab.onClick = [this] { showTab (1); };
    addChildComponent (sounds);
    showTab (0);

    startTimerHz (30);
}

void BridgeEditor::showTab (int t)
{
    tab = t;
    bounceTab.setToggleState (t == 0, dontSendNotification);
    soundsTab.setToggleState (t == 1, dontSendNotification);
    for (auto* c : bounceParts) c->setVisible (t == 0);
    revealBtn.setVisible (t == 0 && proc.lastSaved.existsAsFile());
    sounds.setVisible (t == 1);
    if (t == 1) sounds.grabKeyboardFocus();
    repaint();
}

BridgeEditor::~BridgeEditor()
{
    proc.onMessage = nullptr;
    proc.onSaved = nullptr;
    setLookAndFeel (nullptr);
}

void BridgeEditor::chooseFolder()
{
    chooser = std::make_unique<FileChooser> ("Choose the folder Studio HQ watches for your beats", proc.vaultFolder);
    chooser->launchAsync (FileBrowserComponent::openMode | FileBrowserComponent::canSelectDirectories, [this] (const FileChooser& fc)
    {
        auto f = fc.getResult();
        if (f != File()) proc.vaultFolder = f;
    });
}

void BridgeEditor::recordClicked()
{
    switch (proc.state.load())
    {
        case BridgeProcessor::State::Idle:      proc.startRecording(); break;
        case BridgeProcessor::State::Armed:     proc.cancelRecording(); break;
        case BridgeProcessor::State::Recording: proc.stopAndSave(); break;
        case BridgeProcessor::State::Saving:    break;
    }
}

void BridgeEditor::timerCallback()
{
    const auto fall = [] (float cur, float peak) { return peak > cur ? peak : cur * 0.85f; };
    meterL = fall (meterL, proc.peakL.exchange (0.f));
    meterR = fall (meterR, proc.peakR.exchange (0.f));

    folderPath.setText (proc.vaultFolder.getFullPathName().replace (File::getSpecialLocation (File::userHomeDirectory).getFullPathName(), "~"), dontSendNotification);

    const auto st = proc.state.load();
    const double secs = (double) proc.samplesWritten.load() / jmax (1.0, proc.currentRate.load());
    String txt;
    Colour col = kAccent;
    switch (st)
    {
        case BridgeProcessor::State::Idle:      txt = proc.autoMode ? String ("Arm, then press play in FL") : String ("Record now"); break;
        case BridgeProcessor::State::Armed:     txt = u8 ("Armed. Waiting for play…   (click to cancel)"); col = Colour (0xffe8b93a); break;
        case BridgeProcessor::State::Recording: txt = String::formatted ("Recording  %d:%02d   (click to stop and save)", (int) secs / 60, (int) secs % 60); col = Colour (0xffe34948); break;
        case BridgeProcessor::State::Saving:    txt = u8 ("Saving…"); col = kDim; break;
    }
    recBtn.setButtonText (txt);
    recBtn.setColour (TextButton::buttonColourId, col.withMultipliedBrightness (st == BridgeProcessor::State::Idle ? 0.9f : 0.75f));
    recBtn.setColour (TextButton::textColourOffId, Colours::white);
    recBtn.setEnabled (st != BridgeProcessor::State::Saving);

    const bool busy = st != BridgeProcessor::State::Idle;
    autoToggle.setEnabled (! busy);
    nameEdit.setEnabled (! busy);
    chooseBtn.setEnabled (! busy);

    status.setText (statusText, dontSendNotification);
    if (tab == 0) repaint (tempoArea.getUnion (meterArea));
}

void BridgeEditor::paint (Graphics& g)
{
    g.fillAll (kBg);
    auto b = getLocalBounds().reduced (20);

    g.setColour (kAccent);
    g.setFont (FontOptions (20.0f, Font::bold));
    g.drawText ("Studio HQ Bridge", b.removeFromTop (28), Justification::centredLeft);
    g.setColour (kDim);
    g.setFont (FontOptions (12.5f));
    g.drawText (u8 ("Put this on the Master track. Bounce your beat into the Vault, or audition your sounds."), b.removeFromTop (20), Justification::centredLeft);
    if (tab != 0) return;

    // tempo + transport
    g.setColour (kPanel);
    g.fillRoundedRectangle (tempoArea.toFloat(), 10.0f);
    g.setColour (kLine);
    g.drawRoundedRectangle (tempoArea.toFloat().reduced (0.5f), 10.0f, 1.0f);

    const double bpm = proc.hostBpm.load();
    g.setColour (kText);
    g.setFont (FontOptions (34.0f, Font::bold));
    auto inner = tempoArea.reduced (16, 8);
    g.drawText (bpm > 0 ? String (bpm, 1) : u8 ("—"), inner.removeFromLeft (150), Justification::centredLeft);
    g.setColour (kDim);
    g.setFont (FontOptions (13.0f));
    g.drawText (String (u8 ("BPM  ·  ")) + String (proc.timeSigNum.load()) + "/" + String (proc.timeSigDen.load()), inner.removeFromLeft (110), Justification::centredLeft);
    const bool playing = proc.hostPlaying.load();
    g.setColour (playing ? kGood : kDim);
    g.fillEllipse ((float) inner.getX(), (float) inner.getCentreY() - 4.0f, 8.0f, 8.0f);
    g.drawText (playing ? "FL is playing" : "FL is stopped", inner.withTrimmedLeft (16).removeFromTop (inner.getHeight()), Justification::centredLeft);

    // meters
    auto m = meterArea;
    auto bar = [&g] (Rectangle<int> r, float v)
    {
        g.setColour (Colour (0xff1d2026));
        g.fillRoundedRectangle (r.toFloat(), 3.0f);
        const float w = jlimit (0.f, 1.f, std::pow (v, 0.5f)) * (float) r.getWidth();
        g.setColour (v > 0.98f ? Colour (0xffe34948) : kAccent);
        g.fillRoundedRectangle (r.withWidth ((int) w).toFloat(), 3.0f);
    };
    bar (m.removeFromTop (8), meterL);
    m.removeFromTop (4);
    bar (m.removeFromTop (8), meterR);
}

void BridgeEditor::resized()
{
    auto b = getLocalBounds().reduced (20);
    b.removeFromTop (54);
    auto tabs = b.removeFromTop (30);
    bounceTab.setBounds (tabs.removeFromLeft (150));
    tabs.removeFromLeft (6);
    soundsTab.setBounds (tabs.removeFromLeft (150));
    b.removeFromTop (12);
    sounds.setBounds (b);
    tempoArea = b.removeFromTop (64);
    b.removeFromTop (8);
    meterArea = b.removeFromTop (20);
    b.removeFromTop (12);

    nameLabel.setBounds (b.removeFromTop (16));
    nameEdit.setBounds (b.removeFromTop (34));
    b.removeFromTop (12);
    folderLabel.setBounds (b.removeFromTop (16));
    auto row = b.removeFromTop (30);
    openBtn.setBounds (row.removeFromRight (64));
    row.removeFromRight (6);
    chooseBtn.setBounds (row.removeFromRight (84));
    row.removeFromRight (10);
    folderPath.setBounds (row);
    b.removeFromTop (12);
    autoToggle.setBounds (b.removeFromTop (24));
    keepToggle.setBounds (b.removeFromTop (24));
    b.removeFromTop (10);
    recBtn.setBounds (b.removeFromTop (52));
    b.removeFromTop (8);
    status.setBounds (b.removeFromTop (20));
    auto last = b.removeFromTop (28);
    revealBtn.setBounds (last.removeFromRight (120));
    lastSaved.setBounds (last);
}
