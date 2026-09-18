/**
 * Every icon in the app, in one place.
 *
 * Lucide: a single MIT-licensed set, drawn on one grid, tree-shaken by Vite so only the
 * icons actually used are bundled — and bundled, not fetched, which the no-internet
 * promise requires.
 *
 * Emoji were what this replaced. They were never really icons: a `⚙` or a `⌂` renders
 * as a different picture on every platform, sits on a different baseline, cannot take a
 * stroke weight, and on some Android builds arrives in full colour.
 *
 * One wrapper so weight and size are decided here rather than at three dozen call
 * sites. 2.25 is deliberately heavier than Lucide's default 2 — these are read at a
 * glance, on a laptop on a music stand, sometimes in a dark room.
 */

import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Disc3,
  GripVertical,
  House,
  Library,
  ListMusic,
  Minus,
  Moon,
  Music4,
  Pencil,
  Plus,
  Printer,
  Redo2,
  Save,
  Search,
  Settings,
  Sun,
  Trash2,
  Undo2,
  Users,
  X,
  type LucideProps,
} from 'lucide-react';

export type IconProps = Omit<LucideProps, 'ref'> & { size?: number };

const WEIGHT = 2.25;

function make(Component: React.ComponentType<LucideProps>) {
  return function Icon({ size = 16, strokeWidth = WEIGHT, ...rest }: IconProps) {
    return <Component size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
  };
}

export const IconHome = make(House);
export const IconLibrary = make(Library);
export const IconSets = make(ListMusic);
export const IconLead = make(Disc3);
export const IconSettings = make(Settings);
export const IconBack = make(ArrowLeft);
export const IconPlus = make(Plus);
export const IconCheck = make(Check);
export const IconClose = make(X);
export const IconGrip = make(GripVertical);
export const IconChevronDown = make(ChevronDown);
export const IconChevronRight = make(ChevronRight);
export const IconChevronUp = make(ChevronUp);
export const IconEdit = make(Pencil);
export const IconPrint = make(Printer);
export const IconTrash = make(Trash2);
export const IconSearch = make(Search);
export const IconCalendar = make(Calendar);
export const IconSun = make(Sun);
export const IconMoon = make(Moon);
export const IconSave = make(Save);
export const IconUndo = make(Undo2);
export const IconRedo = make(Redo2);
export const IconMinus = make(Minus);
export const IconMusic = make(Music4);
export const IconUp = make(ArrowUp);
export const IconDown = make(ArrowDown);
export const IconMergeUp = make(ArrowUpToLine);
export const IconPeople = make(Users);
