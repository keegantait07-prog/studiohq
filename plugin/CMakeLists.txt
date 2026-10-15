cmake_minimum_required(VERSION 3.22)
project(StudioHQBridge VERSION 0.1.0)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "")

add_subdirectory(JUCE)

juce_add_plugin(StudioHQBridge
    COMPANY_NAME "Studio HQ"
    PLUGIN_MANUFACTURER_CODE Shqx
    PLUGIN_CODE Bnce
    FORMATS VST3 AU
    PRODUCT_NAME "Studio HQ Bridge"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    VST3_CATEGORIES Fx Tools
    AU_MAIN_TYPE kAudioUnitType_Effect)

target_sources(StudioHQBridge PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/LibraryDb.cpp
    Source/SoundsPanel.cpp
    Source/SavePanel.cpp)

target_compile_definitions(StudioHQBridge PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_REPORT_APP_USAGE=0)

target_link_libraries(StudioHQBridge
    PRIVATE
        juce::juce_audio_utils
        juce::juce_audio_processors
        sqlite3
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags)

# Headless test: drives the processor with a fake host (tempo, play/stop) and checks the recorded file.
juce_add_console_app(BridgeTest PRODUCT_NAME "BridgeTest")
target_sources(BridgeTest PRIVATE Tests/BridgeTest.cpp Source/PluginProcessor.cpp Source/PluginEditor.cpp Source/LibraryDb.cpp Source/SoundsPanel.cpp Source/SavePanel.cpp)
target_compile_definitions(BridgeTest PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1)
target_link_libraries(BridgeTest PRIVATE sqlite3 juce::juce_audio_utils juce::juce_audio_processors juce::juce_recommended_config_flags)
