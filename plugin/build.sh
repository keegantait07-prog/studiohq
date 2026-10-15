#!/bin/bash
# One command: fetch the tools (first run only), build, run the tests, install the plugin.
#   ./build.sh            build + test + install
#   ./build.sh --no-install
set -euo pipefail
cd "$(dirname "$0")"

[ -d JUCE ] || git clone --depth 1 https://github.com/juce-framework/JUCE.git JUCE

mkdir -p .tools
if ! ls -d .tools/cmake-*/CMake.app >/dev/null 2>&1; then
  TAG=$(curl -s https://api.github.com/repos/Kitware/CMake/releases/latest | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
  curl -sL "https://github.com/Kitware/CMake/releases/download/$TAG/cmake-${TAG#v}-macos-universal.tar.gz" | tar xz -C .tools
fi
if [ ! -d .tools/pluginval.app ]; then
  curl -sL https://github.com/Tracktion/pluginval/releases/latest/download/pluginval_macOS.zip -o .tools/pluginval.zip
  unzip -qo .tools/pluginval.zip -d .tools && rm .tools/pluginval.zip
fi

CM=$(ls -d .tools/cmake-*/CMake.app/Contents/bin/cmake)
$CM -S . -B build -DCMAKE_BUILD_TYPE=Release
$CM --build build --config Release -j "$(sysctl -n hw.ncpu)" --target BridgeTest StudioHQBridge_VST3 StudioHQBridge_AU

echo "--- host simulation tests"
./build/BridgeTest_artefacts/Release/BridgeTest | tail -3

[ "${1:-}" = "--no-install" ] && exit 0
./install.sh
echo "--- validating the installed plugin"
./.tools/pluginval.app/Contents/MacOS/pluginval --strictness-level 5 --validate-in-process "$HOME/Library/Audio/Plug-Ins/VST3/Studio HQ Bridge.vst3" | tail -2
