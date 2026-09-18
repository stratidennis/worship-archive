/**
 * A page whose content scrolls *under* nothing.
 *
 * The header used to be `sticky top-0` in normal document flow, which meant the window
 * itself scrolled: the scrollbar ran the full height of the viewport, straight past the
 * header, and the header floated over the content rather than sitting above it.
 *
 * Here the shell is exactly one viewport tall, the header is a real row in it, and
 * `Scroll` is the only thing that moves. The scrollbar therefore starts below the
 * header — which is what every desktop application looks like, and what the set
 * workspace, the editor and the performance views already did. These are the pages that
 * had been left behind.
 *
 * Printing undoes all of it: a fixed-height box with an inner scroller prints one page
 * of a five-page song list and silently drops the rest.
 */
export function Page({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh flex-col print:block print:h-auto">{children}</div>;
}

/** The scrolling region of a {@link Page}. Full width, so its bar sits at the edge. */
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
