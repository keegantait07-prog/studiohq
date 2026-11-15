#!/bin/bash
# PreToolUse hook: block writes into the Claude desktop app's own files
# (the app bundle and its Application Support data). Reads are allowed.
# Exit 2 = block the tool call and show stderr to Claude.
exec python3 -I -c '
import json, os, re, sys
d = json.load(sys.stdin)
ti = d.get("tool_input") or {}
home = os.path.expanduser("~")
protected = [
    "/Applications/Claude.app",
    home + "/Applications/Claude.app",
    home + "/Library/Application Support/Claude",
    home + "/Library/Caches/Claude",
    home + "/Library/Preferences/com.anthropic.claudefordesktop",
]
def hit(s):
    s = s.replace("~", home).replace("$HOME", home)
    return any(p in s for p in protected)
tool = d.get("tool_name", "")
bad = False
if tool in ("Write", "Edit", "NotebookEdit"):
    bad = hit(os.path.abspath(ti.get("file_path") or ti.get("notebook_path") or ""))
elif tool == "Bash":
    cmd = ti.get("command", "").replace("\\ ", " ").replace("\"", "").replace(chr(39), "")
    writes = re.search(r"(>|\btee\b|\brm\b|\bmv\b|\bcp\b|\bsed\s+-i|\btouch\b|\bmkdir\b|\bchmod\b|\bdd\b|\binstall\b|\bln\b|\bunlink\b|\btruncate\b)", cmd)
    bad = bool(writes) and hit(cmd)
if bad:
    sys.stderr.write("Blocked: writes to the Claude desktop app files are not allowed (no-claude-app-writes hook).\n")
    sys.exit(2)
'
