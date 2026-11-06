#!/usr/bin/env python3
"""Turn raw material photos (from scripts/nanobanana.py) into the transparent texture overlays the app uses.

Each plate is flattened (the photo's lighting falloff is removed), made seamless by blending it with a half-shifted copy of
itself, then written as a WebP of white and black speckle whose opacity follows the texture. Laid over any surface colour it
adds grain and sheen without changing the colour, so every theme keeps its own palette.

  python3 scripts/make-textures.py <folder holding steel.png aluminium.png rubber.png glass.png>

Needs Pillow. Output goes to src/renderer/src/assets/textures/.
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter, ImageStat

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "renderer", "src", "assets", "textures")
TILE = 512


def flatten(img: Image.Image, radius: int) -> Image.Image:
    """Subtract the slow lighting gradient so only the surface detail remains, centred on mid grey."""
    low = img.filter(ImageFilter.GaussianBlur(radius))
    return ImageChops.subtract(img, low, 1, 128)


def normalise(img: Image.Image, target_std: float) -> Image.Image:
    """Scale contrast about mid grey so every plate has a similar strength."""
    std = ImageStat.Stat(img).stddev[0] or 1
    k = min(10.0, target_std / std)
    return img.point(lambda v: max(0, min(255, int(128 + (v - 128) * k))))


def seamless(img: Image.Image) -> Image.Image:
    """Blend the image with a copy shifted by half a tile, weighted so the tile's edges come from the copy's seamless centre."""
    n = img.width
    shifted = ImageChops.offset(img, n // 2, n // 2)
    mask = Image.new("L", (n, n))
    px = []
    for y in range(n):
        wy = 1 - abs(2 * y / (n - 1) - 1)
        for x in range(n):
            w = (1 - abs(2 * x / (n - 1) - 1)) * wy
            px.append(int(255 * w * w * (3 - 2 * w)))  # smoothstep
    mask.putdata(px)
    return Image.composite(img, shifted, mask)


def to_overlay(img: Image.Image, gain: float) -> Image.Image:
    """White where the plate is lighter than mid grey, black where it is darker; opacity follows the difference."""
    grey = img.convert("L")
    alpha = grey.point(lambda v: min(255, int(abs(v - 128) * gain)))
    ink = grey.point(lambda v: 255 if v >= 128 else 0)
    out = Image.merge("RGBA", (ink, ink, ink, alpha))
    return out


def process(src: str, name: str, radius: int, std: float, gain: float, tile: bool = True) -> None:
    img = Image.open(src).convert("L").resize((TILE, TILE), Image.LANCZOS)
    img = normalise(flatten(img, radius), std)
    if tile:
        img = seamless(img)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.webp")
    to_overlay(img, gain).save(path, "WEBP", quality=70, alpha_quality=45, method=6)
    print(f"{name}: {os.path.getsize(path) // 1024} KB")


def glass(src: str) -> None:
    """The glass photo shows a panel on a pedestal: keep only the panel's face, and turn its reflection bands into a white sheen."""
    img = Image.open(src).convert("L")
    w, h = img.size
    face = img.crop((int(w * 0.17), int(h * 0.16), int(w * 0.84), int(h * 0.86))).resize((TILE, TILE), Image.LANCZOS)
    face = face.point(lambda v: min(255, int(max(0, v - 14) * 2.2)))  # lift the faint bands out of the black
    sheen = Image.merge("RGBA", (Image.new("L", face.size, 255),) * 3 + (face.point(lambda v: int(v * 0.30)),))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "glass.webp")
    sheen.save(path, "WEBP", quality=70, alpha_quality=45, method=6)
    print(f"glass: {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    d = sys.argv[1]
    process(os.path.join(d, "steel.png"), "steel", radius=60, std=12, gain=0.5)
    process(os.path.join(d, "aluminium.png"), "aluminium", radius=90, std=12, gain=0.6)
    process(os.path.join(d, "rubber.png"), "rubber", radius=50, std=12, gain=0.45)
    glass(os.path.join(d, "glass.png"))
