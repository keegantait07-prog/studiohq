#include "SoundsPanel.h"

using namespace juce;

static const Colour kPanel (0xff14161a), kLine (0xff23262c), kText (0xffe7e8ea), kDim (0xff8b8f98), kAccent (0xffff6b3d);

static Colour kindColour (const String& k)
{
    if (k == "kick" || k == "snare" || k == "clap" || k == "hat" || k == "perc" || k == "808") return Colour (0xffff6b3d);
    if (k == "bass" || k == "melody" || k == "vocal") return Colour (0xff3987e5);
    if (k == "midi") return Colour (0xffeda100);
    return Colour (0xff8b8f98);
}

// One row. Handles selection, double-click to restart, and dragging the file out into FL Studio.
struct SoundsPanel::RowComp : public Component
{
    RowComp (SoundsPanel& o) : owner (o) {}
    SoundsPanel& owner;
    int row = -1;
    bool selected = false;
    Point<int> downPos;

    void paint (Graphics& g) override
    {
        auto* it = owner.itemAtRow (row);
        if (it == nullptr) return;
        auto r = getLocalBounds();
        if (selected) { g.setColour (Colour (0xff1d1f25)); g.fillRect (r); g.setColour (kAccent); g.fillRect (r.removeFromLeft (2)); }
        else if (isMouseOver()) { g.setColour (Colour (0xff15171b)); g.fillRect (r); }
        r.reduce (12, 0);
        g.setColour (it->favorite ? Colour (0xffe8b93a) : kDim);
        g.setFont (FontOptions (13.0f));
        g.drawText (it->favorite ? u8 ("★") : u8 ("☆"), r.removeFromLeft (20), Justification::centredLeft);

        auto cols = r;
        auto right = cols.removeFromRight (250);
        g.setColour (kText);
        g.setFont (FontOptions (13.0f));
        g.drawText (it->name, cols.removeFromLeft (cols.getWidth() - 96), Justification::centredLeft, true);

        auto chip = cols.removeFromLeft (90).reduced (0, 6);
        g.setColour (kindColour (it->kind).withAlpha (0.18f));
        g.fillRoundedRectangle (chip.toFloat(), 4.0f);
        g.setColour (kindColour (it->kind));
        g.setFont (FontOptions (11.0f, Font::bold));
        g.drawText (it->kind, chip, Justification::centred);

        g.setColour (kDim);
        g.setFont (FontOptions (12.0f));
        String len = it->isMidi() ? String (it->notes) + " notes" : it->duration < 10 ? String (it->duration, 2) + "s" : String ((int) it->duration / 60) + ":" + String ((int) it->duration % 60).paddedLeft ('0', 2);
        g.drawText (len, right.removeFromLeft (70), Justification::centredRight);
        g.setColour (kText);
        g.drawText (it->bpm > 0 ? String (it->bpm, it->bpm == (int) it->bpm ? 0 : 1) : String(), right.removeFromLeft (46), Justification::centredRight);
        g.setColour (kDim);
        g.drawText (it->key.isEmpty() ? String() : it->key.replace (" minor", "m").replace (" major", ""), right.removeFromLeft (46).translated (8, 0), Justification::centredLeft);
        g.drawText (it->dirRel, right.translated (10, 0).withTrimmedLeft (0), Justification::centredLeft, true);
    }

    void mouseDown (const MouseEvent& e) override
    {
        downPos = e.getPosition();
        owner.list.selectRowsBasedOnModifierKeys (row, e.mods, false);
        owner.list.grabKeyboardFocus();
        // star toggling is done in the app; the plugin is read-only
    }
    void mouseDoubleClick (const MouseEvent&) override { owner.playSelected(); }
    void mouseDrag (const MouseEvent& e) override
    {
        if (e.getDistanceFromDragStart() < 8) return;
        auto* it = owner.itemAtRow (row);
        if (it == nullptr || ! it->file.existsAsFile()) return;
        StringArray files;
        auto sel = owner.list.getSelectedRows();
        if (sel.contains (row))
            for (int i = 0; i < sel.size() && files.size() < 40; ++i) if (auto* x = owner.itemAtRow (sel[i])) files.add (x->file.getFullPathName());
        if (files.isEmpty()) files.add (it->file.getFullPathName());
        DragAndDropContainer::performExternalDragDropOfFiles (files, false, this);
    }
    void mouseEnter (const MouseEvent&) override { repaint(); }
    void mouseExit (const MouseEvent&) override { repaint(); }
};

SoundsPanel::SoundsPanel (BridgeProcessor& p) : proc (p)
{
    search.setTextToShowWhenEmpty (u8 ("Search sounds, folders, tags…"), kDim);
    search.setFont (FontOptions (14.0f));
    search.setIndents (10, 7);
    search.onTextChange = [this] { applyFilter(); };
    addAndMakeVisible (search);

    kindBox.addItem ("All types", 1);
    kindBox.setSelectedId (1, dontSendNotification);
    kindBox.onChange = [this] { applyFilter(); };
    addAndMakeVisible (kindBox);

    sourceBox.addItem ("Whole library", 1);
    sourceBox.setSelectedId (1, dontSendNotification);
    sourceBox.onChange = [this] { applyFilter(); };
    addAndMakeVisible (sourceBox);

    favBtn.onClick = [this] { applyFilter(); };
    addAndMakeVisible (favBtn);
    autoBtn.setToggleState (true, dontSendNotification);
    addAndMakeVisible (autoBtn);
    loopBtn.onClick = [this] { proc.setPreviewLooping (loopBtn.getToggleState()); };
    addAndMakeVisible (loopBtn);
    refreshBtn.onClick = [this] { reload(); };
    addAndMakeVisible (refreshBtn);
    playBtn.onClick = [this] { if (proc.isPreviewPlaying()) proc.togglePreview(); else playSelected(); };
    addAndMakeVisible (playBtn);
    revealBtn.onClick = [this] { if (auto* it = itemAtRow (list.getSelectedRow())) it->file.revealToUser(); };
    addAndMakeVisible (revealBtn);

    volume.setSliderStyle (Slider::LinearHorizontal);
    volume.setTextBoxStyle (Slider::NoTextBox, false, 0, 0);
    volume.setRange (0.0, 1.0, 0.01);
    volume.setValue (proc.previewGain.load(), dontSendNotification);
    volume.setColour (Slider::trackColourId, kAccent);
    volume.setColour (Slider::thumbColourId, Colours::white);
    volume.onValueChange = [this] { proc.previewGain = (float) volume.getValue(); };
    addAndMakeVisible (volume);

    list.setRowHeight (26);
    list.setColour (ListBox::backgroundColourId, kPanel);
    list.setColour (ListBox::outlineColourId, kLine);
    list.setOutlineThickness (1);
    addAndMakeVisible (list);

    info.setFont (FontOptions (12.0f));
    info.setColour (Label::textColourId, kDim);
    addAndMakeVisible (info);
    count.setFont (FontOptions (12.0f));
    count.setColour (Label::textColourId, kDim);
    count.setJustificationType (Justification::centredRight);
    addAndMakeVisible (count);
    nowPlaying.setFont (FontOptions (13.0f, Font::bold));
    addAndMakeVisible (nowPlaying);

    setWantsKeyboardFocus (true);
    reload();
    startTimerHz (20);
}

SoundsPanel::~SoundsPanel() { proc.stopPreview(); }

void SoundsPanel::setKind (const String& k)
{
    for (int i = 0; i < kindBox.getNumItems(); ++i) if (kindBox.getItemText (i) == k) { kindBox.setSelectedItemIndex (i, sendNotificationSync); return; }
}

void SoundsPanel::reload()
{
    info.setText (u8 ("Reading the Studio HQ library…"), dontSendNotification);
    Component::SafePointer<SoundsPanel> safe (this);
    Thread::launch ([safe]
    {
        auto d = std::make_shared<LibraryDb>();
        String err;
        const bool ok = d->load (LibraryDb::defaultDbFile(), err);
        MessageManager::callAsync ([safe, d, ok, err]
        {
            if (safe != nullptr) safe->setData (ok ? d : nullptr, err);
        });
    });
}

void SoundsPanel::setData (std::shared_ptr<LibraryDb> d, const String& error)
{
    db = d;
    kindBox.clear (dontSendNotification);
    sourceBox.clear (dontSendNotification);
    kindBox.addItem ("All types", 1);
    sourceBox.addItem ("Whole library", 1);
    if (db)
    {
        const StringArray order { "kick", "snare", "clap", "hat", "perc", "808", "bass", "loop", "melody", "vocal", "fx", "midi", "other" };
        for (auto& k : order) if (db->kinds.contains (k)) kindBox.addItem (k, kindBox.getNumItems() + 1);
        for (int i = 0; i < db->projects.size(); ++i)
        {
            auto& p = db->projects.getReference (i);
            sourceBox.addItem ("FL project: " + p.name + "  (" + String (p.samples) + " samples, " + String (p.midis) + " MIDI)", i + 2);
        }
    }
    kindBox.setSelectedId (1, dontSendNotification);
    sourceBox.setSelectedId (1, dontSendNotification);
    message = error;
    info.setText (error, dontSendNotification);
    applyFilter();
}

void SoundsPanel::applyFilter()
{
    rows.clear();
    if (db == nullptr) { list.updateContent(); count.setText ("", dontSendNotification); return; }
    const auto words = StringArray::fromTokens (search.getText().toLowerCase(), " ", "");
    const String kind = kindBox.getSelectedId() > 1 ? kindBox.getText() : String();
    std::set<int> inProject;
    const int src = sourceBox.getSelectedId();
    const bool byProject = src > 1 && (src - 2) < db->projects.size();
    if (byProject) for (int id : db->projects.getReference (src - 2).soundIds) inProject.insert (id);

    for (int i = 0; i < db->sounds.size(); ++i)
    {
        auto& s = db->sounds.getReference (i);
        if (kind.isNotEmpty() && s.kind != kind) continue;
        if (favBtn.getToggleState() && ! s.favorite) continue;
        if (byProject && inProject.count (s.id) == 0) continue;
        bool ok = true;
        for (auto& w : words) if (! s.hay.contains (w)) { ok = false; break; }
        if (ok) rows.add (i);
    }
    list.updateContent();
    list.deselectAllRows();
    list.scrollToEnsureRowIsOnscreen (0);
    count.setText (String (rows.size()) + (rows.size() == 1 ? " sound" : " sounds"), dontSendNotification);
    if (message.isEmpty()) info.setText ("Click a sound to hear it. Drag it into FL Studio.", dontSendNotification);
}

Component* SoundsPanel::refreshComponentForRow (int row, bool selected, Component* existing)
{
    auto* c = dynamic_cast<RowComp*> (existing);
    if (c == nullptr) c = new RowComp (*this);
    c->row = row;
    c->selected = selected;
    c->repaint();
    return c;
}

void SoundsPanel::selectedRowsChanged (int last)
{
    auto* it = itemAtRow (last);
    if (it == nullptr) return;
    nowPlaying.setText (it->name, dontSendNotification);
    if (it->isMidi())
    {
        proc.stopPreview();
        message = "MIDI has no audio preview. Drag it into FL's piano roll, or use Show in Finder.";
        info.setText (message, dontSendNotification);
        return;
    }
    message = {};
    info.setText (it->file.getFullPathName(), dontSendNotification);
    if (autoBtn.getToggleState()) playSelected();
}

void SoundsPanel::playSelected()
{
    auto* it = itemAtRow (list.getSelectedRow());
    if (it == nullptr || it->isMidi()) return;
    String err;
    if (! proc.loadPreview (it->file, err)) { message = err; info.setText (err, dontSendNotification); }
}

bool SoundsPanel::keyPressed (const KeyPress& k)
{
    if (k == KeyPress::spaceKey) { if (proc.isPreviewPlaying()) proc.togglePreview(); else playSelected(); return true; }
    return false;
}

void SoundsPanel::timerCallback()
{
    if (! isVisible()) return;
    const double len = proc.previewLengthSeconds();
    progress = len > 0 ? (float) jlimit (0.0, 1.0, proc.previewPositionSeconds() / len) : 0.f;
    playBtn.setButtonText (proc.isPreviewPlaying() ? "Stop" : "Play");
    repaint (progressArea);
}

void SoundsPanel::paint (Graphics& g)
{
    g.setColour (Colour (0xff1d2026));
    g.fillRoundedRectangle (progressArea.toFloat(), 2.0f);
    g.setColour (kAccent);
    g.fillRoundedRectangle (progressArea.toFloat().withWidth (progressArea.getWidth() * progress), 2.0f);
}

void SoundsPanel::resized()
{
    auto b = getLocalBounds();
    auto top = b.removeFromTop (30);
    refreshBtn.setBounds (top.removeFromRight (70));
    top.removeFromRight (8);
    favBtn.setBounds (top.removeFromRight (92));
    sourceBox.setBounds (top.removeFromRight (170));
    top.removeFromRight (8);
    kindBox.setBounds (top.removeFromRight (100));
    top.removeFromRight (8);
    search.setBounds (top);
    b.removeFromTop (8);

    auto bottom = b.removeFromBottom (104);
    list.setBounds (b);

    bottom.removeFromTop (8);
    auto r1 = bottom.removeFromTop (28);
    playBtn.setBounds (r1.removeFromLeft (64));
    r1.removeFromLeft (8);
    revealBtn.setBounds (r1.removeFromRight (112));
    r1.removeFromRight (10);
    volume.setBounds (r1.removeFromRight (110));
    r1.removeFromRight (6);
    loopBtn.setBounds (r1.removeFromRight (62));
    autoBtn.setBounds (r1.removeFromRight (86));
    nowPlaying.setBounds (r1);
    bottom.removeFromTop (6);
    progressArea = bottom.removeFromTop (5);
    bottom.removeFromTop (6);
    auto r2 = bottom.removeFromTop (20);
    count.setBounds (r2.removeFromRight (110));
    info.setBounds (r2);
}
