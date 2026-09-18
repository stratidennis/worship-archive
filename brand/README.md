# Brand art

Two files, and everything else is generated from them.

| file                | what it is                     |
| ------------------- | ------------------------------ |
| `logo-mark.png`     | The mark alone, cropped tight. |
| `logo-wordmark.png` | Mark and name, cropped tight.  |

Both carry a diagonal gradient that runs from the **light theme's** accent to the
**dark theme's** — `oklch(48% 0.16 255)` to `oklch(78% 0.13 245)`, near enough. That is
the point of it: a favicon, a taskbar icon and a dock icon are drawn by the operating
system on a background nobody can predict, and one that spans both accents belongs on
either. Inside the app the logo is drawn from outlines in `currentColor` instead, so it
takes whichever accent the theme in front of you actually uses.

Two generators, both committed output:

- `pnpm icons` — the favicon, the PWA icons and the desktop and tray icons, from
  `logo-mark.png`. These keep the gradient.
- `pnpm trace:logo` — the outlines, into `packages/ui/src/components/logo-paths.ts` and
  `packages/ui/public/favicon.svg`.

Edit the art here and re-run both. Nothing under `packages/` is drawn by hand.
