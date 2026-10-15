# Studio HQ Bridge (FL Studio plugin)

A VST3 / Audio Unit effect that lives on FL Studio's **Master** track and connects FL to Studio HQ.

## Build and install

```bash
cd plugin
./build.sh          # downloads JUCE + CMake on first run, builds, runs tests, installs, validates
```

It installs to `~/Library/Audio/Plug-Ins/VST3/` and `~/Library/Audio/Plug-Ins/Components/` and signs the plugin ad hoc, so it runs on the Mac that built it. Then in FL Studio:

1. **Options → Manage plugins → Find installed plugins** (if it doesn't appear, make sure `~/Library/Audio/Plug-Ins/VST3` is in the plugin search paths).
2. Open the **Mixer**, click an empty slot on the **Master** track, and choose **Studio HQ Bridge** (look under *Studio HQ* or search for it).

## Save to Studio HQ (the main tab)

One button, no recording. It works out which FL project is open (from FL's own autosave file names, so it even notices a brand-new project), reads FL's tempo, and tells Studio HQ. The project appears in your Vault as a beat with that BPM; open Studio HQ to see it (if the app is closed, it's added the next time the app starts).

- If you haven't saved the project yet, it says so. Press **Cmd+S** in FL, then **Refresh**.
- Leave the name empty to use the project's own name, or type a different one.
- Press it again later to update the tempo or name; it won't create duplicates.
- When you export a bounce into your beat folder, it links to the project by itself.

## Record audio (optional)

Only needed if you want a quick audio capture. Records what FL sends to the Master, in real time, and saves it into your Studio HQ beat folder, named `<name> (<tempo>bpm).wav`. The tempo comes from FL itself, and Studio HQ reads it from the file name, so the beat arrives in the Vault with the right BPM.

- **Arm, then press play** (default): the plugin waits for FL to start playing, records until FL stops, then saves. Turn off *Record automatically…* for a plain *Record now / Stop* button.
- The file is a 24-bit WAV at FL's sample rate. A name that already exists gets `(2)`, `(3)`, … instead of being overwritten. Recordings under half a second are discarded.
- It saves into the folder Studio HQ watches (the app writes it to `~/Library/Application Support/Studio HQ/bridge.json`), or `~/Desktop/! BEATS` if the app hasn't run. Change it with **Choose…**.
- Audio passes through untouched. Anything you preview in the Sounds tab is **never** recorded.

## Sounds & MIDI

Searches your Studio HQ library (read directly from its database, so the app doesn't need to be open): every scanned sound, plus each FL project's own samples and the MIDI exported from its patterns. Filter by type or by FL project.

- Click (or arrow through) a sound to hear it through the plugin; Space plays/stops; Loop and volume are below the list.
- MIDI files show their note count. They have no audio preview.
- **Drag** a row out of the plugin into FL, or use **Show in Finder** and drag from there.

## Tested in FL Studio 2026

Checked by loading it in FL Studio 2026 itself (Apple Silicon):

- FL's plugin scan finds it (VST3 and AU, status "ok") and it can be added to the Master track.
- It shows FL's tempo (130 BPM matched FL's display), and *FL is playing / stopped* follows the transport.
- Arming then pressing play started the recording by itself, and stopping saved `FL Test (130bpm).wav` (24-bit, 48 kHz stereo). Recording sample previews from FL's browser captured real audio (peak −8 dBFS). A second take with the same name became `FL Test (130bpm) (2).wav`.
- The Sounds & MIDI tab loaded the full library (19,520 sounds) and a preview played with FL stopped. The folder picker works, and the plugin's settings (name, folder, last file) are remembered when its window is reopened.

- **Save to Studio HQ** (checked live in FL): it identified the open project ("Active just now"), showed FL's tempo (163 BPM), and pressing Save wrote an inbox item with the right name, tempo and project path. Studio HQ picked it up at once, both when the app was already open and when it started afterwards, and saving twice didn't duplicate the beat.

**Not tested in FL:** dragging a row from the plugin into FL's playlist or channel rack, recording during FL's *Export* (offline render), and the "project not saved yet" message (checked with a simulated host only).

## Known limits

- The plugin is read-only toward your library. Favorites and tags are changed in the Studio HQ app, then press **Reload**.
- Previews play through FL's mixer, so they need FL's audio engine running. If you hear nothing while FL is stopped, switch off *Smart disable* for the slot (the plug-in wrapper's settings, gear icon).
- JUCE (the framework) is licensed AGPLv3 / commercial. That's fine for using this plugin yourself; if you ever distribute it, you need to follow that license or buy one.
- Apple Silicon only (arm64), signed ad hoc, not notarized.

## Tests

`./build.sh` runs `BridgeTest`, which drives the plugin like a host (fake tempo, play/stop) and checks the recorded files, the browser against your real library, and that previews never leak into a bounce. It also validates the installed plugin with `pluginval` (and Apple's `auval` for the AU).

## Preview loops and MP3 bounces

- **Preview loop.** While FL plays, the plugin keeps the last ~40 s of what reaches the Master. When you close the project (the plugin is unloaded), or press Save to Studio HQ, it keeps the last 4 whole bars (else 2, else 1, else 8 s) as a short MP3 and Studio HQ plays it as that beat's preview in the Vault. It only applies to a saved project, and the plugin must be on the Master. A newer loop replaces the older one. Verified by the host-simulation test and by pushing loops through the real app inbox; not yet checked by closing a project inside FL.
- **Bounces are MP3 only.** The plugin records a WAV (JUCE cannot encode MP3); Studio HQ converts it to a 320 kbps MP3 in your beat folder and deletes the WAV. If the app is closed, the WAV waits until it is open again.
