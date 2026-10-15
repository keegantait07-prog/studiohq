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

## Bounce to Vault

Records what FL sends to the Master and saves it into your Studio HQ beat folder, named `<name> (<tempo>bpm).wav`. The tempo comes from FL itself, and Studio HQ reads it from the file name, so the beat arrives in the Vault with the right BPM.

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

**Not tested in FL:** dragging a row from the plugin into FL's playlist or channel rack, and recording during FL's *Export* (offline render).

## Known limits

- The plugin is read-only toward your library. Favorites and tags are changed in the Studio HQ app, then press **Reload**.
- Previews play through FL's mixer, so they need FL's audio engine running. If you hear nothing while FL is stopped, switch off *Smart disable* for the slot (the plug-in wrapper's settings, gear icon).
- JUCE (the framework) is licensed AGPLv3 / commercial. That's fine for using this plugin yourself; if you ever distribute it, you need to follow that license or buy one.
- Apple Silicon only (arm64), signed ad hoc, not notarized.

## Tests

`./build.sh` runs `BridgeTest`, which drives the plugin like a host (fake tempo, play/stop) and checks the recorded files, the browser against your real library, and that previews never leak into a bounce. It also validates the installed plugin with `pluginval` (and Apple's `auval` for the AU).
