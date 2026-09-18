import { MARK_PATHS, MARK_VIEWBOX, WORDMARK_PATHS, WORDMARK_VIEWBOX } from './logo-paths.js';

/**
 * The mark, and the mark with the name beside it.
 *
 * Outlines rather than a picture, so both take `currentColor`. That is the whole point:
 * the header's home link colours its own logo the way it colours its own label — muted
 * when you are somewhere else, accent when you are here, following the hover in
 * between — and a PNG cannot do that. The paths come from `brand/` via
 * `pnpm trace:logo`; see `logo-paths.ts`.
 *
 * `fill-rule="evenodd"` is load-bearing on the wordmark: the counters in the letters
 * are separate rings, and without it every `o` fills in solid.
 *
 * `alt`/`aria-label` are deliberately absent by default. Wherever these appear the name
 * is already on the page or in the window title, and a screen reader announcing
 * "Worship Archive" twice in a row is noise rather than branding — pass `label` on the
 * one screen where the logo really is the only thing saying what this is.
 */
function Svg({
  viewBox,
  paths,
  className,
  label,
}: {
  viewBox: string;
  paths: readonly string[];
  className: string;
  label?: string | undefined;
}) {
  return (
    <svg
      viewBox={viewBox}
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function Logo({ className = '', label }: { className?: string; label?: string }) {
  return (
    <Svg
      viewBox={MARK_VIEWBOX}
      paths={MARK_PATHS}
      className={`w-auto ${className}`}
      label={label}
    />
  );
}

export function Wordmark({ className = '', label }: { className?: string; label?: string }) {
  return (
    <Svg
      viewBox={WORDMARK_VIEWBOX}
      paths={WORDMARK_PATHS}
      className={`w-auto ${className}`}
      label={label}
    />
  );
}
