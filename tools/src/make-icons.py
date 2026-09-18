#!/usr/bin/env python3
"""
Generate the app icon at every size the packagers need, from the brand art.

This used to *draw* an icon — a rounded square and a stylised book, built from three
shapes because detail that survives one size and not the other is worse than no detail.
It exists because there was no logo. There is one now, so the job changed: take
`brand/logo-mark.png` and produce every size and shape the platforms ask for, so that
one source file is the only thing anyone ever edits.

    python3 tools/src/make-icons.py        (or: pnpm icons)

Two backgrounds, for two different reasons. App icons get an opaque white rounded
square: a transparent icon on a white Windows taskbar disappears, and Android's
maskable icons are composited onto whatever shape the launcher wants — which crops a
transparent one to a blue blob. Tray icons stay transparent, because a menu bar is not
white and never will be.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
MARK = ROOT / "brand" / "logo-mark.png"
UI_PUBLIC = ROOT / "packages" / "ui" / "public"
DESKTOP_BUILD = ROOT / "packages" / "desktop" / "build"

WHITE = (255, 255, 255, 255)
# 4x supersampling: the only anti-aliasing available without a vector rasteriser, and
# at 16px the difference between this and none is legibility.
SUPER = 4


def rounded_square(size: int, radius_ratio: float, colour: tuple[int, int, int, int]):
    s = size * SUPER
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle(
        [0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=colour
    )
    return image.resize((size, size), Image.LANCZOS)


def centred(mark: Image.Image, canvas: Image.Image, scale: float) -> Image.Image:
    """The mark centred on a canvas, its longest side `scale` of the canvas."""
    box = int(canvas.width * scale)
    art = mark.copy()
    art.thumbnail((box, box), Image.LANCZOS)
    out = canvas.copy()
    out.alpha_composite(art, ((out.width - art.width) // 2, (out.height - art.height) // 2))
    return out


def app_icon(mark: Image.Image, size: int, *, scale: float, inset: float = 0.0):
    """A white rounded square with the mark on it, optionally inset in its canvas."""
    plate_size = int(size * (1 - inset * 2))
    plate = centred(mark, rounded_square(plate_size, 0.22, WHITE), scale)
    if inset == 0.0:
        return plate
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(plate, ((size - plate_size) // 2, (size - plate_size) // 2))
    return canvas


def scaled_to_height(image: Image.Image, height: int) -> Image.Image:
    width = round(image.width * height / image.height)
    return image.resize((width, height), Image.LANCZOS)


def main() -> None:
    mark = Image.open(MARK).convert("RGBA")

    # The web app. 0.62 keeps the mark inside the 80%-diameter circle Android promises
    # not to crop, so the same file serves as the maskable icon too.
    for size in (192, 512):
        app_icon(mark, size, scale=0.62).save(UI_PUBLIC / f"icon-{size}.png")

    # The favicon, at the three sizes browsers actually ask for. Written from the mark
    # rather than copied from the supplied .ico, which was a 432KB nine-image file for
    # something that renders at 16 pixels.
    app_icon(mark, 64, scale=0.72).save(
        UI_PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )

    # In the interface: twice the size they are drawn at, for a retina screen.
    scaled_to_height(mark, 96).save(UI_PUBLIC / "logo-mark.png")
    wordmark = Image.open(ROOT / "brand" / "logo-wordmark.png").convert("RGBA")
    scaled_to_height(wordmark, 128).save(UI_PUBLIC / "logo-wordmark.png")

    # The desktop app. macOS insets its icons inside the canvas — a full-bleed one looks
    # a size larger than everything beside it in the dock — and Windows does not.
    app_icon(mark, 1024, scale=0.60).save(DESKTOP_BUILD / "icon.png")
    app_icon(mark, 1024, scale=0.60, inset=0.08).save(DESKTOP_BUILD / "icon-mac.png")

    # The tray: transparent, because a menu bar is not white.
    for size in (16, 24, 32, 48):
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        centred(mark, canvas, 0.92).save(DESKTOP_BUILD / f"tray-{size}.png")

    print(f"icons written from {MARK.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
