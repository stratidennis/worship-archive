#!/usr/bin/env python3
"""
Trace the brand PNGs into SVG paths.

The logo arrived as PNG. A picture is fine on a taskbar and wrong in an interface: the
header needs it to take the colour of the link it sits in — muted when you are
elsewhere, accent when you are here, and something else again on hover — and you cannot
recolour a picture. `filter` tricks get close and lie at the edges; a mask needs the
bitmap anyway and softens at small sizes.

So the outlines get extracted once, here, and committed as path data the interface can
paint with `currentColor`.

    python3 tools/src/trace-logo.py        (or: pnpm trace:logo)

Marching squares at the half-alpha contour, with linear interpolation along each cell
edge, so the result follows the real curve rather than the pixel staircase — tracing the
pixel boundary and smoothing it afterwards gives visible flats on exactly the rounded
corners this logo is made of. Then Ramer–Douglas–Peucker to drop the points that carry
no shape.

Holes come out as their own closed loops, wound the other way, which `fill-rule:
evenodd` renders correctly without anyone having to care which is which.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "brand"
OUT_TS = ROOT / "packages" / "ui" / "src" / "components" / "logo-paths.ts"
OUT_FAVICON = ROOT / "packages" / "ui" / "public" / "favicon.svg"

# Pixels of error allowed when dropping a point, measured on the source image. Small
# enough that a rounded corner stays round, large enough that a straight edge is two
# points and not two hundred.
EPSILON = 0.6

# The four cell corners, and which pairs of them each marching-squares case joins.
# Corner order is top-left, top-right, bottom-right, bottom-left; edges are named for
# the two corners they span.
TOP, RIGHT, BOTTOM, LEFT = 0, 1, 2, 3
CASES: dict[int, list[tuple[int, int]]] = {
    1: [(LEFT, TOP)],
    2: [(TOP, RIGHT)],
    3: [(LEFT, RIGHT)],
    4: [(RIGHT, BOTTOM)],
    5: [(LEFT, TOP), (RIGHT, BOTTOM)],
    6: [(TOP, BOTTOM)],
    7: [(LEFT, BOTTOM)],
    8: [(BOTTOM, LEFT)],
    9: [(BOTTOM, TOP)],
    10: [(TOP, RIGHT), (BOTTOM, LEFT)],
    11: [(BOTTOM, RIGHT)],
    12: [(RIGHT, LEFT)],
    13: [(RIGHT, TOP)],
    14: [(TOP, LEFT)],
}


def alpha_grid(path: Path) -> np.ndarray:
    """The alpha channel as floats in 0..1, padded so shapes at the edge still close."""
    image = Image.open(path).convert("RGBA")
    grid = np.asarray(image, dtype=np.float32)[:, :, 3] / 255.0
    return np.pad(grid, 1, mode="constant", constant_values=0.0)


def crossing(a: float, b: float, level: float) -> float:
    """Where between two corners the contour crosses, as a fraction of the edge."""
    if a == b:
        return 0.5
    return (level - a) / (b - a)


def cell_points(
    row: int, col: int, values: tuple[float, float, float, float], level: float
) -> dict[int, tuple[float, float]]:
    tl, tr, br, bl = values
    return {
        TOP: (col + crossing(tl, tr, level), float(row)),
        RIGHT: (float(col + 1), row + crossing(tr, br, level)),
        BOTTOM: (col + crossing(bl, br, level), float(row + 1)),
        LEFT: (float(col), row + crossing(tl, bl, level)),
    }


def segments(grid: np.ndarray, level: float = 0.5) -> list[tuple[tuple, tuple]]:
    """Every contour segment in the grid, as ((x1,y1), (x2,y2)) pairs."""
    above = grid > level
    tl, tr = above[:-1, :-1], above[:-1, 1:]
    br, bl = above[1:, 1:], above[1:, :-1]
    index = tl.astype(np.uint8) | (tr << 1) | (br << 2) | (bl << 3)

    out: list[tuple[tuple, tuple]] = []
    for row, col in zip(*np.nonzero((index > 0) & (index < 15))):
        case = int(index[row, col])
        points = cell_points(
            row,
            col,
            (
                float(grid[row, col]),
                float(grid[row, col + 1]),
                float(grid[row + 1, col + 1]),
                float(grid[row + 1, col]),
            ),
            level,
        )
        for start, end in CASES[case]:
            out.append((points[start], points[end]))
    return out


def key(point: tuple[float, float]) -> tuple[int, int]:
    """Segments meet exactly on cell edges, so rounding is safe and makes joins cheap."""
    return (round(point[0] * 64), round(point[1] * 64))


def loops(pieces: list[tuple[tuple, tuple]]) -> list[list[tuple[float, float]]]:
    """Walk the segments into closed rings."""
    starts: dict[tuple[int, int], list[tuple]] = {}
    for a, b in pieces:
        starts.setdefault(key(a), []).append((a, b))

    used: set[int] = set()
    rings: list[list[tuple[float, float]]] = []
    for index, (a, _b) in enumerate(pieces):
        if index in used:
            continue
        ring = [a]
        current = pieces[index]
        used.add(index)
        while True:
            ring.append(current[1])
            following = starts.get(key(current[1]), [])
            nxt = None
            for candidate in following:
                position = pieces.index(candidate)
                if position not in used:
                    nxt = (position, candidate)
                    break
            if nxt is None:
                break
            used.add(nxt[0])
            current = nxt[1]
            if key(current[1]) == key(ring[0]):
                ring.append(current[1])
                break
        if len(ring) > 3:
            rings.append(ring)
    return rings


def simplify(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    """Ramer–Douglas–Peucker, iteratively so a long ring cannot blow the stack."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        length = (dx * dx + dy * dy) ** 0.5
        worst, at = 0.0, first
        for i in range(first + 1, last):
            px, py = points[i]
            if length == 0:
                distance = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                distance = abs(dy * px - dx * py + bx * ay - by * ax) / length
            if distance > worst:
                worst, at = distance, i
        if worst > epsilon:
            keep[at] = True
            stack.append((first, at))
            stack.append((at, last))
    return [p for p, k in zip(points, keep) if k]


def trace(path: Path) -> tuple[list[str], int, int]:
    grid = alpha_grid(path)
    rings = loops(segments(grid))
    height, width = grid.shape[0] - 2, grid.shape[1] - 2

    paths: list[str] = []
    for ring in rings:
        simple = simplify(ring, EPSILON)
        if len(simple) < 4:
            continue
        # The padding put everything one pixel in; take it back out.
        coords = [(x - 1, y - 1) for x, y in simple]
        d = f"M{coords[0][0]:.1f} {coords[0][1]:.1f}"
        d += "".join(f"L{x:.1f} {y:.1f}" for x, y in coords[1:-1])
        paths.append(d + "Z")
    return paths, width, height


def main() -> None:
    mark, mark_w, mark_h = trace(BRAND / "logo-mark.png")
    word, word_w, word_h = trace(BRAND / "logo-wordmark.png")

    OUT_TS.write_text(
        "/*\n"
        " * The logo, as outlines.\n"
        " *\n"
        " * Generated by `pnpm trace:logo` from `brand/`. Do not edit by hand — edit the\n"
        " * art and re-run it.\n"
        " *\n"
        " * Paths rather than a picture so the mark can be painted with `currentColor`,\n"
        " * which is what lets the header's home link colour its own logo the way it\n"
        " * colours its own label: muted elsewhere, accent here, and following the hover.\n"
        " *\n"
        " * `fill-rule=\"evenodd\"` is not optional — the counters in the letterforms are\n"
        " * separate rings, and without it they fill in solid.\n"
        " */\n\n"
        f"export const MARK_VIEWBOX = '0 0 {mark_w} {mark_h}';\n"
        f"export const MARK_PATHS: readonly string[] = [\n"
        + "".join(f"  '{d}',\n" for d in mark)
        + "];\n\n"
        f"export const WORDMARK_VIEWBOX = '0 0 {word_w} {word_h}';\n"
        f"export const WORDMARK_PATHS: readonly string[] = [\n"
        + "".join(f"  '{d}',\n" for d in word)
        + "];\n",
        encoding="utf8",
    )

    # A favicon that is also the outlines. A new URL as well as a better format: browsers
    # hold on to a favicon far past any reload, and an .ico that changed under the same
    # name can go on showing the old one for days.
    square = max(mark_w, mark_h)
    dx, dy = (square - mark_w) / 2, (square - mark_h) / 2
    OUT_FAVICON.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {square} {square}">'
        f'<g transform="translate({dx:.1f} {dy:.1f})" fill="#65b9fc" fill-rule="evenodd">'
        + "".join(f'<path d="{d}"/>' for d in mark)
        + "</g></svg>",
        encoding="utf8",
    )

    print(f"mark: {len(mark)} paths, wordmark: {len(word)} paths")
    print(f"  {OUT_TS.relative_to(ROOT)} — {OUT_TS.stat().st_size // 1024}KB")
    print(f"  {OUT_FAVICON.relative_to(ROOT)} — {OUT_FAVICON.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
