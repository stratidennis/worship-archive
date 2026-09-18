/**
 * The scrolling region of a page.
 *
 * Full width, so its scrollbar sits at the edge of the window rather than beside a
 * centred column — and the only thing that scrolls, because the header above it is a
 * real row in a viewport-height box (see `Chrome`) rather than something sticky that
 * the whole document slides under. That is what puts the scrollbar below the chrome
 * instead of running the full height of the screen past it.
 *
 * Printing undoes it: a fixed-height box with an inner scroller prints one page of a
 * five-page song list and silently drops the rest.
 */
export function Scroll({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto print:overflow-visible ${className}`}>
      {children}
    </div>
  );
}
