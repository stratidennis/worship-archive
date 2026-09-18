import { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { IconChevronDown, IconMinus, IconPlus } from './icons.js';

/**
 * The controls everything else is built from.
 *
 * Deliberately not a component library. A second design system alongside Tailwind would
 * mean two sources of truth for colour and spacing, a runtime CSS-in-JS dependency, and
 * roughly double the bundle — on an app whose whole premise is that it loads with no
 * network. These are a couple of hundred lines that read the same `--color-*` tokens as
 * the songs do, so light, dark and stage all follow for free.
 *
 * Every control is 36px tall (`h-9`) so a row of mixed buttons, inputs and selects
 * lines up without anyone thinking about it.
 *
 * The rule the app follows: **nothing outside this file writes button, input or select
 * classes by hand.** Page-local one-offs were how the key selector and the capo box
 * ended up looking like neither the rest of the app nor each other.
 */

export type Variant = 'default' | 'primary' | 'ghost' | 'danger';
export type Size = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const VARIANTS: Record<Variant, string> = {
  default: 'border-(--color-line) bg-(--color-surface) hover:bg-(--color-line)',
  primary:
    'border-(--color-chord) bg-(--color-chord) text-white hover:brightness-110 ' +
    'disabled:border-(--color-line) disabled:bg-transparent disabled:text-(--color-muted)',
  ghost: 'border-transparent hover:bg-(--color-line)',
  danger: 'border-(--color-line) bg-(--color-surface) text-red-500 hover:bg-red-500/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 text-xs',
  md: 'h-9 text-sm',
};

/*
  Padding and width are separate from the size, and a square button picks the width.

  They used to be one string — `h-9 px-3` — with `IconButton` appending `w-9 px-0` to
  cancel the padding. It never did: two padding utilities in one class list are resolved
  by the order Tailwind emits them, not the order they are written, so `px-3` won and a
  36px button kept 24px of padding. The icon inside is a flex item, so instead of
  overflowing it quietly shrank — every square icon button in the app was drawing a
  17px icon at 10px. Nothing looked broken, it just looked wrong.
*/
const PADDING: Record<Size, string> = { sm: 'px-2', md: 'px-3' };
const SQUARE: Record<Size, string> = { sm: 'w-7', md: 'w-9' };

/** The button look, for the few places that need it on something that is not a button. */
export function buttonClasses(
  variant: Variant = 'default',
  size: Size = 'md',
  className = '',
  /** Square and unpadded, for a button whose whole content is one icon. */
  icon = false,
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${
    icon ? SQUARE[size] : PADDING[size]
  } ${className}`;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Pressed state for toggles — styled as primary and announced to a screen reader. */
  active?: boolean;
  /** Square and unpadded. Set by {@link IconButton}; rarely worth passing by hand. */
  icon?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    active,
    icon = false,
    className = '',
    type = 'button',
    ...rest
  },
  ref,
) {
  const chosen: Variant = active ? 'primary' : variant;
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={active === undefined ? undefined : active}
      className={buttonClasses(chosen, size, className, icon)}
      {...rest}
    />
  );
});

/** A square button holding one icon. `label` is required — an icon says nothing aloud. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'children'> & { label: string; children: React.ReactNode }
>(function IconButton({ label, size = 'md', className = '', ...rest }, ref) {
  return (
    <Button
      ref={ref}
      icon
      size={size}
      aria-label={label}
      title={label}
      className={className}
      {...rest}
    />
  );
});

/**
 * A router link that looks like a button.
 *
 * Every page had its own copy of the button classes for this, and they had all drifted —
 * different heights, different hovers, one without a transition.
 */
export function ButtonLink({
  variant = 'default',
  size = 'md',
  icon = false,
  className = '',
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: boolean }) {
  return <Link className={buttonClasses(variant, size, className, icon)} {...rest} />;
}

const FIELD =
  'rounded-lg border border-(--color-line) bg-(--color-surface) ' +
  'outline-none transition-colors placeholder:text-(--color-muted) ' +
  'focus:border-(--color-chord) disabled:opacity-40';

/*
  `tight` rather than a `size` prop: `size` is already a native attribute on both
  `<input>` and `<select>`, and shadowing it would mean every caller passing a real one
  got something else. Tight is the 28px row used inside a section's toolbar, where a
  full-height field would tower over the lyric it belongs to.
*/
const FIELD_SIZES = { sm: 'h-7 px-2 text-xs', md: 'h-9 px-3 text-sm' } as const;

/*
  Full width unless the caller asked for a width.

  Not `w-full` in the base with an override after it: two width utilities in one class
  list are resolved by the order Tailwind emits them, not the order they are written, so
  `w-32` lost to the base's `w-full` and every field in the editor's section toolbar
  stretched across the row. Deciding here is the only version that is actually true.
*/
const HAS_WIDTH = /(^|\s)w-/;

function fieldClasses(tight: boolean | undefined, className: string): string {
  const width = HAS_WIDTH.test(className) ? '' : 'w-full ';
  return `${width}${FIELD} ${FIELD_SIZES[tight ? 'sm' : 'md']} ${className}`;
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { tight?: boolean }
>(function Input({ className = '', tight, ...rest }, ref) {
  return <input ref={ref} className={fieldClasses(tight, className)} {...rest} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`w-full ${FIELD} h-auto px-3 py-2 text-sm leading-relaxed ${className}`}
      {...rest}
    />
  );
});

/**
 * A native `<select>`, with our own arrow.
 *
 * Native because it is the only control that gets a phone's wheel picker and a
 * keyboard's type-ahead for free. The browser's own arrow is hidden and replaced so it
 * matches every other chevron in the app rather than whichever one the platform draws.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { tight?: boolean }
>(function Select({ className = '', tight, children, ...rest }, ref) {
  return (
    <span className="relative inline-flex items-center">
      <select
        ref={ref}
        className={`${fieldClasses(tight, className)} cursor-pointer appearance-none ${
          tight ? 'pr-6' : 'pr-8'
        }`}
        {...rest}
      >
        {children}
      </select>
      <IconChevronDown
        size={tight ? 13 : 15}
        className={`pointer-events-none absolute text-(--color-muted) ${
          tight ? 'right-1.5' : 'right-2.5'
        }`}
      />
    </span>
  );
});

/**
 * A checkbox.
 *
 * Native, with `accent-color`: `color-scheme` is already set per theme in `index.css`,
 * so the browser draws the tick in our blue and the box in the right shade without a
 * hand-built replacement that would lose the platform's own focus and touch behaviour.
 */
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(function Checkbox({ className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={`h-4 w-4 shrink-0 accent-(--color-chord) ${className}`}
      {...rest}
    />
  );
});

/** A label above a control, with the small-caps look used throughout. */
export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-(--color-muted)">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-(--color-muted)">{hint}</span>}
    </label>
  );
}

/*
  Segmented controls.

  One bordered strip with the current choice filled in, rather than N separate buttons.
  It says "these belong together and exactly one of them is true" far faster, and it is
  the same shape whether the segments are links (the header nav), radio buttons
  (Settings, Join) or tabs (the running order).
*/

export function Segmented({
  label,
  children,
  className = '',
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      {...(label ? { role: 'group', 'aria-label': label } : {})}
      className={`inline-flex items-center overflow-hidden rounded-lg border border-(--color-line) bg-(--color-raised) ${className}`}
    >
      {children}
    </div>
  );
}

const SEGMENT_SIZES: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-2.5 text-sm',
};

/** Classes for one segment. `first:border-l-0` draws the dividers without extra markup. */
export function segmentClasses(active: boolean, size: Size = 'md', className = ''): string {
  return (
    'inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-(--color-line) ' +
    'font-medium transition-colors first:border-l-0 disabled:cursor-not-allowed disabled:opacity-40 ' +
    `${SEGMENT_SIZES[size]} ` +
    (active
      ? 'bg-(--color-chord) text-white '
      : 'text-(--color-muted) hover:bg-(--color-line) hover:text-(--color-stage-fg) ') +
    className
  );
}

export function Segment({
  active,
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; size?: Size }) {
  return <button type={type} className={segmentClasses(active, size, className)} {...rest} />;
}

/**
 * − value + , as one strip.
 *
 * Transpose and capo are the same control with different bounds, and they appeared on
 * four pages in four slightly different hand-rolled forms. The middle segment is a
 * button because resetting to zero is the thing people actually want from it mid-song.
 */
export function Stepper({
  caption,
  value,
  display,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  resetTo,
  labels,
  size = 'md',
}: {
  caption?: string;
  value: number;
  /** What to show in the middle — defaults to the value. */
  display?: string;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  resetTo?: number;
  labels: { down: string; up: string; reset?: string };
  size?: Size;
}) {
  const iconSize = size === 'sm' ? 13 : 15;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {caption && <span className="text-xs text-(--color-muted)">{caption}</span>}
      <Segmented>
        <Segment
          active={false}
          size={size}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={labels.down}
          title={labels.down}
        >
          <IconMinus size={iconSize} />
        </Segment>
        {/* The value, which is also the reset. Never disabled: greying out the number
            whenever it read zero made the whole strip look switched off. */}
        <button
          type="button"
          onClick={() => resetTo !== undefined && onChange(resetTo)}
          {...(labels.reset ? { 'aria-label': labels.reset, title: labels.reset } : {})}
          className={`inline-flex shrink-0 items-center justify-center border-l border-(--color-line) font-medium tabular-nums transition-colors hover:bg-(--color-line) ${
            size === 'sm' ? 'h-7 min-w-8 px-1.5 text-xs' : 'h-9 min-w-9 px-2 text-sm'
          }`}
        >
          {display ?? value}
        </button>
        <Segment
          active={false}
          size={size}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={labels.up}
          title={labels.up}
        >
          <IconPlus size={iconSize} />
        </Segment>
      </Segmented>
    </span>
  );
}
