#include "PluginEditor.h"

using namespace juce;

static const Colour kBg (0xff08080b), kPanel (0xff101015), kLine (0xff22222c), kText (0xffececf1), kDim (0xff8a8a99), kAccent (0xffc6ff4a), kGood (0xff7dffb0);

BridgeLookAndFeel::BridgeLookAndFeel()
{
    setColour (ResizableWindow::backgroundColourId, kBg);
    setColour (Label::textColourId, kText);
    setColour (TextEditor::backgroundColourId, Colour (0xff0a0a0e));
    setColour (TextEditor::textColourId, kText);
    setColour (TextEditor::outlineColourId, kLine);
    setColour (TextEditor::focusedOutlineColourId, kAccent);
    setColour (TextButton::buttonColourId, Colour (0xff17171e));
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
    const float rad = jmin (r.getHeight() * 0.5f, 22.0f);
    const bool lime = c.getHue() > 0.18f && c.getHue() < 0.3f && c.getSaturation() > 0.5f;
    if (lime)
    {
        for (int i = 3; i >= 1; --i) { g.setColour (kAccent.withAlpha (0.05f * (float) (4 - i))); g.fillRoundedRectangle (r.expanded ((float) i * 2.0f), rad + (float) i * 2.0f); }
    }
    g.setGradientFill (ColourGradient (c.brighter (0.12f), 0.0f, r.getY(), c.darker (0.12f), 0.0f, r.getBottom(), false));
    g.fillRoundedRectangle (r, rad);
    g.setColour (lime ? c.brighter (0.3f) : kLine.brighter (0.15f));
    g.drawRoundedRectangle (r, rad, 1.0f);
}

BridgeEditor::BridgeEditor (BridgeProcessor& p) : AudioProcessorEditor (&p), proc (p), sounds (p), savePanel (p)
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
    for (auto* t : { &saveTab, &bounceTab, &soundsTab })
    {
        t->setClickingTogglesState (true);
        t->setRadioGroupId (7);
        t->setColour (TextButton::buttonOnColourId, kAccent);
        t->setColour (TextButton::textColourOnId, Colour (0xff0c1004));
        addAndMakeVisible (*t);
    }
    saveTab.onClick = [this] { showTab (0); };
    bounceTab.onClick = [this] { showTab (1); };
    soundsTab.onClick = [this] { showTab (2); };
    addChildComponent (sounds);
    addChildComponent (savePanel);
    showTab (0);

    startTimerHz (30);
}

void BridgeEditor::showTab (int t)
{
    tab = t;
    saveTab.setToggleState (t == 0, dontSendNotification);
    bounceTab.setToggleState (t == 1, dontSendNotification);
    soundsTab.setToggleState (t == 2, dontSendNotification);
    for (auto* c : bounceParts) c->setVisible (t == 1);
    revealBtn.setVisible (t == 1 && proc.lastSaved.existsAsFile());
    savePanel.setVisible (t == 0);
    sounds.setVisible (t == 2);
    if (t == 0) savePanel.refresh();
    if (t == 2) sounds.grabKeyboardFocus();
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
    Colour col = Colour (0xffff7a45); // ember: the record button stays warm so it never reads as the lime "save" action
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
    if (tab == 1) repaint (tempoArea.getUnion (meterArea));
}

void BridgeEditor::paint (Graphics& g)
{
    g.fillAll (kBg);
    g.setGradientFill (ColourGradient (kAccent.withAlpha (0.10f), (float) getWidth() * 0.85f, -40.0f, Colours::transparentBlack, (float) getWidth() * 0.35f, 220.0f, true));
    g.fillRect (getLocalBounds().removeFromTop (260));
    auto b = getLocalBounds().reduced (20);

    // logo: four level bars with a glow
    {
        auto lg = b.removeFromTop (28);
        const float hs[4] = { 0.45f, 1.0f, 0.65f, 0.3f };
        for (int i = 0; i < 4; ++i)
        {
            const float h = 20.0f * hs[i], x = (float) lg.getX() + (float) i * 6.0f, y = (float) lg.getBottom() - 4.0f - h;
            g.setColour (kAccent.withAlpha (0.18f)); g.fillRoundedRectangle (x - 1.5f, y - 1.5f, 6.0f, h + 3.0f, 3.0f);
            g.setColour (kAccent);                   g.fillRoundedRectangle (x, y, 3.0f, h, 1.5f);
        }
        g.setColour (kText);
        g.setFont (FontOptions (17.0f, Font::bold));
        g.drawText ("STUDIO HQ", lg.withTrimmedLeft (34).removeFromLeft (110), Justification::centredLeft);
        g.setColour (kDim);
        g.setFont (FontOptions (12.0f));
        g.drawText ("BRIDGE", lg.withTrimmedLeft (34 + 108).removeFromLeft (70), Justification::centredLeft);
    }
    g.setColour (kDim);
    g.setFont (FontOptions (12.5f));
    g.drawText (u8 ("Put this on the Master track. Save your beat to Studio HQ, or audition your sounds."), b.removeFromTop (20), Justification::centredLeft);
    if (tab != 1) return;

    // tempo + transport
    g.setColour (kPanel);
    g.setGradientFill (ColourGradient (Colour (0xff15151c), 0.0f, (float) tempoArea.getY(), kPanel, 0.0f, (float) tempoArea.getBottom(), false));
    g.fillRoundedRectangle (tempoArea.toFloat(), 16.0f);
    g.setColour (kLine);
    g.drawRoundedRectangle (tempoArea.toFloat().reduced (0.5f), 16.0f, 1.0f);

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
        g.setColour (Colour (0xff17171e));
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
    saveTab.setBounds (tabs.removeFromLeft (170));
    tabs.removeFromLeft (6);
    bounceTab.setBounds (tabs.removeFromLeft (130));
    tabs.removeFromLeft (6);
    soundsTab.setBounds (tabs.removeFromLeft (140));
    b.removeFromTop (14);
    sounds.setBounds (b);
    savePanel.setBounds (b);
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
