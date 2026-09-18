#!/usr/bin/env python3
"""
Generate the app icon at every size the packagers need.

Committed output, reproducible source. The icon is drawn rather than designed: a
rounded square in the app's own chord blue, with a stylised open book of music. It has
to read at 16px in a Windows tray and at 1024px in the macOS dock, so it is built from
three shapes and nothing else — detail that survives one size and not the other is
worse than no detail.

    python3 tools/src/make-icons.py
"""

from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BG = (34, 63, 122)          # oklch(48% 0.16 255) as sRGB — the --color-chord token
BG_DARK = (24, 45, 90)
FG = (247, 249, 252)
ACCENT = (247, 190, 106)    # --color-cue: the one warm note


def draw(size: int) -> Image.Image:
    # 4x supersampling: the only anti-aliasing available without a vector rasteriser,
    # and at 16px the difference between this and none is legibility.
    s = size * 4
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)

    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)
    d.rounded_rectangle([0, 0, s - 1, int(s * 0.5)], radius=radius, fill=BG)
    d.rectangle([0, int(s * 0.3), s - 1, int(s * 0.55)], fill=BG)
    d.rounded_rectangle(
        [int(s * 0.04), int(s * 0.04), int(s * 0.96), int(s * 0.96)],
        radius=int(s * 0.19),
        outline=BG_DARK,
        width=max(1, int(s * 0.012)),
    )

    # An open book: two pages meeting at a spine.
    top, bottom = int(s * 0.30), int(s * 0.74)
    left, right = int(s * 0.16), int(s * 0.84)
    mid = s // 2
    lift = int(s * 0.05)
    d.polygon(
        [(left, top + lift), (mid, top), (mid, bottom), (left, bottom + lift)], fill=FG
    )
    d.polygon(
        [(right, top + lift), (mid, top), (mid, bottom), (right, bottom + lift)], fill=FG
    )
    d.line([(mid, top), (mid, bottom)], fill=BG_DARK, width=max(1, int(s * 0.012)))

    # A single note on the right-hand page — the one element that says "music" at 16px.
    head_r = int(s * 0.055)
    head_x, head_y = int(s * 0.63), int(s * 0.60)
    d.ellipse(
        [head_x - head_r, head_y - int(head_r * 0.8), head_x + head_r, head_y + int(head_r * 0.8)],
        fill=ACCENT,
    )
    d.line(
        [(head_x + head_r - int(s * 0.004), head_y), (head_x + head_r - int(s * 0.004), int(s * 0.42))],
        fill=ACCENT,
        width=max(1, int(s * 0.022)),
    )

    # Two stave lines on the left-hand page, suggesting text without drawing any.
    for i, y in enumerate((0.47, 0.55, 0.63)):
        d.line(
            [(int(s * 0.24), int(s * y) + int(lift * (1 - y))), (int(s * 0.43), int(s * y))],
            fill=BG_DARK,
            width=max(1, int(s * 0.018)),
        )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    master = draw(1024)

    (ROOT / "packages/desktop/build").mkdir(parents=True, exist_ok=True)
    master.save(ROOT / "packages/desktop/build/icon.png")

    # electron-builder derives .ico and .icns itself, but a tray icon must be small and
    # drawn at its real size rather than downscaled from 1024.
    for size in (16, 24, 32, 48):
        draw(size).save(ROOT / f"packages/desktop/build/tray-{size}.png")

    for size in (192, 512):
        draw(size).save(ROOT / f"packages/ui/public/icon-{size}.png")

    # Apple wants transparent padding around the glyph; a full-bleed square looks wrong
    # next to every other icon in the dock.
    padded = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    inner = draw(int(1024 * 0.82))
    offset = (1024 - inner.width) // 2
    padded.paste(inner, (offset, offset), inner)
    padded.save(ROOT / "packages/desktop/build/icon-mac.png")

    print("wrote packages/desktop/build/ and packages/ui/public/")


if __name__ == "__main__":
    main()
