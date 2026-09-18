/**
 * The mark, and the mark with the name beside it.
 *
 * A PNG rather than an inline SVG: the art is what it is, and re-drawing it by hand in
 * paths would mean the logo in the header could drift away from the one on the taskbar.
 * Both files are generated from `brand/` by `pnpm icons`, at twice the size they are
 * ever drawn at, so they stay sharp on a retina screen.
 *
 * `alt=""` and `aria-hidden` wherever the name is already on the page — a screen reader
 * announcing "Worship Archive" twice in a row is noise, not branding.
 */
export function Logo({
  className = '',
  decorative = true,
  alt = 'Worship Archive',
}: {
  className?: string;
  decorative?: boolean;
  alt?: string;
}) {
  return (
    <img
      src="/logo-mark.png"
      width={54}
      height={48}
      alt={decorative ? '' : alt}
      {...(decorative ? { 'aria-hidden': true } : {})}
      className={`w-auto select-none ${className}`}
    />
  );
}

export function Wordmark({
  className = '',
  alt = 'Worship Archive',
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/logo-wordmark.png"
      width={176}
      height={64}
      alt={alt}
      className={`w-auto select-none ${className}`}
    />
  );
}
