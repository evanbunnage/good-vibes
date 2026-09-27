#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["pillow"]
# ///
"""Regenerates AppIcon.icns, icon-preview.png, and the README logos. Run: uv run packaging/make-icon.py"""
import base64
import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S, GRID = 1024, 128
TITLE = "CoolSwitch"
TEAL, FACE, LIGHT, WHITE, SHADOW, BLACK = (
    "#008080",
    "#C0C0C0",
    "#DFDFDF",
    "#FFFFFF",
    "#808080",
    "#000000",
)
NAVY, BLUE = (0, 0, 128), (16, 132, 208)
# Hand-drawn 7px-tall, variable-width title-bar glyphs, like the tiny bitmap fonts
# of the era. Add a glyph here to use a new letter in TITLE.
GLYPHS = {
    "C": [".##.", "#..#", "#...", "#...", "#...", "#..#", ".##."],
    "S": [".##.", "#..#", "#...", ".##.", "...#", "#..#", ".##."],
    "c": ["...", "...", ".##", "#..", "#..", "#..", ".##"],
    "o": ["....", "....", ".##.", "#..#", "#..#", "#..#", ".##."],
    "l": ["#", "#", "#", "#", "#", "#", "#"],
    "s": ["...", "...", ".##", "#..", ".#.", "..#", "##."],
    "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
    "i": ["#", ".", "#", "#", "#", "#", "#"],
    "t": [".#.", ".#.", "###", ".#.", ".#.", ".#.", "..#"],
    "h": ["#...", "#...", "###.", "#..#", "#..#", "#..#", "#..#"],
}


def raised(d, x0, y0, x1, y1):
    """Win95 raised bevel: light and white top-left, gray and black bottom-right."""
    d.rectangle([x0, y0, x1, y1], fill=FACE)
    d.line([(x0, y1), (x0, y0), (x1, y0)], fill=LIGHT)
    d.line([(x0 + 1, y1 - 1), (x0 + 1, y0 + 1), (x1 - 1, y0 + 1)], fill=WHITE)
    d.line([(x0 + 1, y1 - 1), (x1 - 1, y1 - 1), (x1 - 1, y0 + 1)], fill=SHADOW)
    d.line([(x0, y1), (x1, y1), (x1, y0)], fill=BLACK)


def sunken(d, x0, y0, x1, y1):
    d.rectangle([x0, y0, x1, y1], fill=WHITE)
    d.line([(x0, y1), (x0, y0), (x1, y0)], fill=SHADOW)
    d.line([(x0 + 1, y1 - 1), (x0 + 1, y0 + 1), (x1 - 1, y0 + 1)], fill=BLACK)
    d.line([(x0, y1), (x1, y1), (x1, y0)], fill=WHITE)


def title_button(d, x, y, glyph):
    raised(d, x, y, x + 8, y + 7)
    if glyph == "min":
        d.rectangle([x + 2, y + 5, x + 5, y + 5], fill=BLACK)
    elif glyph == "max":
        d.rectangle([x + 2, y + 2, x + 6, y + 5], outline=BLACK)
        d.line([(x + 2, y + 2), (x + 6, y + 2)], fill=BLACK)
        d.line([(x + 2, y + 3), (x + 6, y + 3)], fill=BLACK)
    else:
        for i in range(4):
            d.point([(x + 2 + i, y + 2 + i), (x + 5 - i, y + 2 + i)], fill=BLACK)
            d.point([(x + 3 + i, y + 2 + i), (x + 6 - i, y + 2 + i)], fill=BLACK)


def window(img, x0, y0, x1, y1, active, title, dialog=False):
    d = ImageDraw.Draw(img)
    raised(d, x0, y0, x1, y1)
    tx0, ty0, tx1, ty1 = x0 + 3, y0 + 3, x1 - 3, y0 + 13
    if active:
        for x in range(tx0, tx1 + 1):
            t = (x - tx0) / (tx1 - tx0)
            d.line(
                [(x, ty0), (x, ty1)],
                fill=tuple(int(NAVY[i] + (BLUE[i] - NAVY[i]) * t) for i in range(3)),
            )
    else:
        d.rectangle([tx0, ty0, tx1, ty1], fill=SHADOW)
    x = tx0 + 2
    for letter in title or "":
        for row, bits in enumerate(GLYPHS[letter]):
            for col, bit in enumerate(bits):
                if bit == "#":
                    d.point((x + col, ty0 + 2 + row), fill=WHITE)
        x += len(GLYPHS[letter][0]) + 1
    bx = tx1 - 1 - 9
    title_button(d, bx, ty0 + 2, "close")
    if not dialog:  # Dialogs have only the close button.
        title_button(d, bx - 11, ty0 + 2, "max")
        title_button(d, bx - 20, ty0 + 2, "min")
    sunken(d, x0 + 3, ty1 + 3, x1 - 4, y1 - 4)


def art():
    img = Image.new("RGB", (GRID, GRID), TEAL)
    window(img, 23, 25, 85, 79, active=False, title=None)
    window(img, 41, 45, 105, 103, active=True, title=TITLE, dialog=True)
    return img.resize((S, S), Image.NEAREST)


def icon():
    # macOS icon grid: 824px body centered in 1024, ~185px corner radius.
    body, inset = 824, (S - 824) // 2
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [inset, inset + 12, inset + body, inset + body + 12],
        radius=185,
        fill=(0, 0, 0, 90),
    )
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    # Smooth squircle edge: draw the mask at 4x and downsample.
    big = Image.new("L", (S * 4, S * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [inset * 4, inset * 4, (inset + body) * 4 - 1, (inset + body) * 4 - 1],
        radius=185 * 4,
        fill=255,
    )
    mask = big.resize((S, S), Image.LANCZOS)
    img.paste(art(), (0, 0), mask)
    return img


out = Path(__file__).with_name("AppIcon.icns")
image = icon()
image.save(
    out,
    sizes=[
        (16, 16),
        (32, 32),
        (64, 64),
        (128, 128),
        (256, 256),
        (512, 512),
        (1024, 1024),
    ],
)
image.resize((256, 256), Image.LANCZOS).save(
    Path(__file__).with_name("icon-preview.png")
)


def logo(ink):
    """The icon and its name in the title-bar glyphs, as one SVG for READMEs: the
    icon 32 units tall (no macOS margin), each glyph pixel 3 units, so it's sharp
    at 32px. Laid out like SkeinFiend's logo, so the two sit together."""
    inset = (S - 824) // 2
    body = image.crop((inset, inset, S - inset, S - inset)).resize((128, 128), Image.LANCZOS)
    png = io.BytesIO()
    body.save(png, format="PNG", optimize=True)
    px, x, top = 3, 43, 5
    rects = []
    for letter in TITLE:
        for row, bits in enumerate(GLYPHS[letter]):
            col = 0
            while col < len(bits):
                if bits[col] == "#":
                    run = len(bits[col:]) - len(bits[col:].lstrip("#"))
                    rects.append(f"M{x + col * px} {top + row * px}h{run * px}v{px}h{-run * px}z")
                    col += run
                else:
                    col += 1
        x += (len(GLYPHS[letter][0]) + 1) * px
    width = x - px
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 32" width="{width * 3}" height="96" role="img" aria-label="{TITLE}">'
        f'<image width="32" height="32" href="data:image/png;base64,{base64.b64encode(png.getvalue()).decode()}"/>'
        f'<path fill="{ink}" shape-rendering="crispEdges" d="{"".join(rects)}"/></svg>\n'
    )


for name, ink in (("light", "#232723"), ("dark", "#f6f1ea")):
    Path(__file__).with_name(f"logo-{name}.svg").write_text(logo(ink))
print("wrote", out)
