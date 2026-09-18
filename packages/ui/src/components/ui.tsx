import { forwardRef } from 'react';
import { IconChevronDown } from './icons.js';

/**
 * The controls everything else is built from.
 *
 * Deliberately not a component library. A second design system alongside Tailwind would
 * mean two sources of truth for colour and spacing, a runtime CSS-in-JS dependency, and
 * roughly double the bundle — on an app whose whole premise is that it loads with no
 * network. These are a few dozen lines that read the same `--color-*` tokens as the
 * songs do, so light, dark and stage all follow for free.
 *
 * Every control is 36px tall (`h-9`) so a row of mixed buttons, inputs and selects
 * lines up without anyone thinking about it.
 */

type Variant = 'default' | 'primary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

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
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Pressed state for toggles — styled as primary and announced to a screen reader. */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', active, className = '', type = 'button', ...rest },
  ref,
) {
  const chosen: Variant = active ? 'primary' : variant;
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={active === undefined ? undefined : active}
      className={`${BASE} ${VARIANTS[chosen]} ${SIZES[size]} ${className}`}
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
      size={size}
      aria-label={label}
      title={label}
      className={`${size === 'sm' ? 'w-7 px-0' : 'w-9 px-0'} ${className}`}
      {...rest}
    />
  );
});

const FIELD =
  'h-9 w-full rounded-lg border border-(--color-line) bg-(--color-surface) px-3 text-sm ' +
  'outline-none transition-colors placeholder:text-(--color-muted) ' +
  'focus:border-(--color-chord) disabled:opacity-40';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${FIELD} ${className}`} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`${FIELD} h-auto py-2 leading-relaxed ${className}`}
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
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = '', children, ...rest }, ref) {
  return (
    <span className="relative inline-flex items-center">
      <select
        ref={ref}
        className={`${FIELD} cursor-pointer appearance-none pr-8 ${className}`}
        {...rest}
      >
        {children}
      </select>
      <IconChevronDown
        size={15}
        className="pointer-events-none absolute right-2.5 text-(--color-muted)"
      />
    </span>
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
