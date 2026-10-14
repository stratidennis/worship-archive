import { useLayoutEffect, type RefObject } from 'react';
import { androidBand } from './androidBand.js';

interface DisplaySize {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
}

/** Browser bars change only the visible height; rotation and desktop resizing need a new fit. */
export function shouldResizePerformanceArea(
  previous: DisplaySize,
  next: DisplaySize,
  handheld: boolean,
): boolean {
  return (
    !handheld ||
    previous.width !== next.width ||
    previous.screenWidth !== next.screenWidth ||
    previous.screenHeight !== next.screenHeight
  );
}

/** Hold the song area steady when touch scrolling hides or shows browser chrome. */
export function useStablePerformanceHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handheld =
      !window.worship &&
      !window.worshipClient &&
      // Android has no browser address bar. Its fullscreen/keyboard/split-window
      // changes really do resize the available area, even though phones still scroll.
      !androidBand() &&
      window.matchMedia('(pointer: coarse)').matches;
    const size = (): DisplaySize => ({
      width: window.innerWidth,
      height: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    });
    let previous = size();
    let frame: number | null = null;

    const lockHeight = (): void => {
      // Read the small viewport CSS height when available. Older engines only know
      // `vh`, which can include hidden browser bars, so cap that to the visible area.
      element.style.height = '';
      const height = Math.min(element.getBoundingClientRect().height, window.innerHeight);
      element.style.height = `${height}px`;
      previous = size();
    };
    const onResize = (): void => {
      if (shouldResizePerformanceArea(previous, size(), handheld)) lockHeight();
    };
    const onOrientationChange = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(onResize);
    };
    const onFullscreenChange = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(lockHeight);
    };

    lockHeight();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientationChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.screen.orientation?.addEventListener('change', onOrientationChange);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientationChange);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.screen.orientation?.removeEventListener('change', onOrientationChange);
      if (frame !== null) cancelAnimationFrame(frame);
      element.style.height = '';
    };
  }, [ref]);
}
