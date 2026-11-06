# Depth and texture brief

Paste this with any UI request. It exists to stop designs coming out flat, 2D and textureless.

Everything you design must read as physical objects lit by one light, not coloured rectangles. Flat is a failure.

## 1. Choose the materials before you draw anything
List 3 to 5 real materials the interface is made of, for example: matte powder-coated steel chassis, anodised aluminium caps, soft-touch rubber knobs, smoked-glass display, OLED emission. For each give the base colour, the finish (matte, satin, polished), the grain, and how it reacts to light. Every element belongs to exactly one material. Nothing is just "a grey box".

## 2. One light, everywhere
Pick one key light (top-left, about 35 degrees up) and never break it.
- Top and left edges get a 1px highlight. Bottom and right edges get a 1px shadow.
- Raised things cast their shadow down and to the right.
- Recessed things are darker at the top-left (inner shadow).
- The key light is slightly warm, the ambient fill slightly cool.

## 3. At least five depth layers on every screen
chassis, panel, recessed well, raised control, emissive element. Raised and recessed must still be distinguishable when the screenshot is turned greyscale.

## 4. Replace borders with edge light
Do not separate things with 1px solid grey outlines. Use a highlight and shadow pair, an inset shadow, or a change of material. Build every shadow from three layers: contact (tight and dark), key (medium, offset), ambient (wide, soft, low opacity). Never use one soft grey drop shadow.

## 5. Texture is mandatory, but quiet
Every large surface carries grain: a noise overlay at 2 to 5 percent (SVG feTurbulence or canvas), brushed metal as anisotropic streaks, a faint vignette toward the edges. It must be visible at 200 percent zoom and read as material, not dirt, at 100 percent. A smooth CSS gradient on its own is not texture.

## 6. Light comes from things that are on
Live elements emit three things: a small bright core, a mid glow, and a wide faint spill that lights the surfaces around them. Build the spill with radial gradients and a screen or plus-lighter blend, not a drop-shadow on the whole component. Elements that are off emit nothing.

## 7. Controls respond physically
Press moves the control down 1 to 2px, removes its top highlight and tightens its shadow. Release springs back (stiffness about 120, damping about 14). Hover is a small lift in light, not a colour swap.

## 8. Type is part of the material
Small labels look printed or stamped, with a 1px highlight underneath. Large numbers look like emissive displays. Use one real typeface (not the system default), tabular numerals, and a clear four-step size scale.

## 9. Weight and asymmetry
Heavier things sit lower and larger. Avoid centred, symmetric grids. One dominant object, smaller supporting ones.

## Verification (required, do not skip)
Screenshot at 100 percent and at 200 percent, then report each test:
1. Greyscale test: desaturate the screenshot. Can you still tell raised from recessed?
2. Squint test: blur it. Is there one clear focal point?
3. Zoom test: at 200 percent, does every large surface show texture?
If any test fails, fix it before calling the work done. End by listing what you would still call flat.

## Anti-patterns
Pure flat fills. One radius everywhere. A single grey shadow. Glow done as a drop-shadow. Glass cards over gradient blobs. Borders around everything. Obviously tiled texture patterns. Fake stitching or fake screws: physical, not kitsch.
