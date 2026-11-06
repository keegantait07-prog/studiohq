#!/usr/bin/env python3
"""Draw the two seamless metal overlays the Thorn theme uses, with Pillow only (no image model).

  thorn-scratch.webp  fine random scratches and dust on a transparent tile, laid over black surfaces
  thorn-brushed.webp  horizontal brushing streaks, laid over metal plates

Every stroke is also drawn one tile over in each direction, so the tile repeats without a seam. Fixed seeds keep it reproducible.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "renderer", "src", "assets", "textures")
N = 768


def wrap(draw_fn):
    for dx in (-N, 0, N):
        for dy in (-N, 0, N):
            draw_fn(dx, dy)


def scratch() -> Image.Image:
    random.seed(7)
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for _ in range(85):
        x, y = random.uniform(0, N), random.uniform(0, N)
        ang = random.gauss(math.radians(-28), 0.55) if random.random() < .7 else random.uniform(0, math.pi)
        ln = random.expovariate(1 / 30) + 6
        a = int(random.choice([22, 34, 50, 74, 110]) * random.uniform(.5, 1))
        x2, y2 = x + math.cos(ang) * ln, y + math.sin(ang) * ln
        w = 1
        wrap(lambda dx, dy: d.line([(x + dx, y + dy), (x2 + dx, y2 + dy)], fill=(255, 255, 255, a), width=w))
    for _ in range(110):  # dust and pits
        x, y, r = random.uniform(0, N), random.uniform(0, N), random.choice([.5, .8, 1.2])
        a = random.choice([40, 80, 130])
        wrap(lambda dx, dy: d.ellipse([x + dx - r, y + dy - r, x + dx + r, y + dy + r], fill=(255, 255, 255, a)))
    return img.filter(ImageFilter.GaussianBlur(.35))


def brushed() -> Image.Image:
    random.seed(11)
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(N):
        for _ in range(2):
            x = random.uniform(0, N)
            ln = random.uniform(60, 420)
            light = random.random() < .55
            a = random.randint(3, 16)
            col = (255, 255, 255, a) if light else (0, 0, 0, a + 10)
            wrap(lambda dx, dy: d.line([(x + dx, y + dy), (x + ln + dx, y + dy)], fill=col, width=1))
    return img.filter(ImageFilter.GaussianBlur(.4))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (("thorn-scratch", scratch), ("thorn-brushed", brushed)):
        p = os.path.join(OUT, name + ".webp")
        fn().save(p, "WEBP", quality=70, alpha_quality=60, method=6)
        print(name, os.path.getsize(p) // 1024, "KB")
