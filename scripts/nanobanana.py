#!/usr/bin/env python3
"""Generate or edit an image with Google's Gemini image models ("Nano Banana"). No third-party packages.

The API key is read from the GEMINI_API_KEY environment variable, or from ~/.config/studio-hq/gemini.env
(one line: GEMINI_API_KEY=..., or just the bare key). The key is never printed, logged or written anywhere else.

What leaves your machine: the prompt, and any images you pass with --image. They go to Google's Gemini API.

Examples:
  python3 scripts/nanobanana.py --prompt "brushed anodised aluminium, seamless, macro" --out metal.png
  python3 scripts/nanobanana.py --prompt "make the sky dusk" --image photo.png --out edited.png --size 2K
"""
import argparse
import base64
import json
import mimetypes
import os
import ssl
import stat
import sys
import urllib.error
import urllib.request

ENV_FILE = os.path.expanduser("~/.config/studio-hq/gemini.env")
# Model ids as published by the plugin repo you showed me; they are previews and Google may rename them.
FAST_MODEL = "gemini-3.1-flash-image-preview"
PRO_MODEL = "gemini-3-pro-image-preview"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Some Python installs on macOS ship without trusted certificates. Use the system list; verification stays on.
SYSTEM_CA = "/etc/ssl/cert.pem"


def tls_context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=SYSTEM_CA if os.path.exists(SYSTEM_CA) else None)


def load_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if os.path.exists(ENV_FILE):
        mode = os.stat(ENV_FILE).st_mode
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            sys.exit(f"{ENV_FILE} is readable by other users. Run: chmod 600 {ENV_FILE}")
        with open(ENV_FILE, encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith("#")]
        for line in lines:
            name, _, value = line.removeprefix("export ").partition("=")
            if name.strip() == "GEMINI_API_KEY" and value.strip():
                return value.strip().strip("'\"")
        if len(lines) == 1 and "=" not in lines[0] and " " not in lines[0]:
            return lines[0].strip("'\"")  # the file holds just the bare key
    sys.exit(
        "No Gemini API key found. Create one at https://aistudio.google.com/apikey, then put this line in "
        f"{ENV_FILE}:  GEMINI_API_KEY=your-key   (and run: chmod 600 {ENV_FILE})"
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Generate or edit an image with Gemini (Nano Banana).")
    p.add_argument("--prompt", "-p", required=True, help="What to generate, or how to edit the input image(s)")
    p.add_argument("--out", "-o", default="generated.png", help="Output file (default: generated.png)")
    p.add_argument("--image", "-i", action="append", default=[], help="Input image to edit or use as reference (repeatable, up to 14)")
    p.add_argument("--aspect", choices=["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], help="Aspect ratio")
    p.add_argument("--size", choices=["1K", "2K", "4K"], help="Output size. Switches to the Pro model, which costs more.")
    p.add_argument("--model", help="Override the model id")
    args = p.parse_args()
    if len(args.image) > 14:
        sys.exit("At most 14 input images.")

    parts = [{"text": args.prompt}]
    for path in args.image:
        mime = mimetypes.guess_type(path)[0] or "image/png"
        with open(path, "rb") as f:
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(f.read()).decode()}})

    image_config = {}
    if args.aspect:
        image_config["aspectRatio"] = args.aspect
    if args.size:
        image_config["imageSize"] = args.size
    body = {"contents": [{"parts": parts}]}
    if image_config:
        body["generationConfig"] = {"imageConfig": image_config}

    model = args.model or (PRO_MODEL if args.size else FAST_MODEL)
    req = urllib.request.Request(
        ENDPOINT.format(model=model),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": load_key()},
    )
    print(f"Generating with {model} ...", file=sys.stderr)
    try:
        with urllib.request.urlopen(req, timeout=180, context=tls_context()) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:600]
        sys.exit(f"Gemini API error {e.code}: {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach the Gemini API: {e.reason}")

    saved = False
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and not saved:
                with open(args.out, "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                saved = True
            elif part.get("text"):
                print(part["text"])
    if not saved:
        reason = data.get("promptFeedback") or data.get("candidates", [{}])[0].get("finishReason", "no image returned")
        sys.exit(f"No image came back: {reason}")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
