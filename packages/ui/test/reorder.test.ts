import { describe, expect, it } from 'vitest';
import { indexAtPoint, moveItem, shiftFor } from '../src/lib/reorder.js';

describe('moving an item', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an item down', () => {
    // The classic off-by-one: dragging "a" to index 2 must land it third, not fourth.
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to the very start and the very end', () => {
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveItem(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('is a no-op when nothing moves', () => {
    expect(moveItem(list, 1, 1)).toEqual(list);
  });

  it('never loses or duplicates an item', () => {
    for (let from = 0; from < list.length; from++) {
      for (let to = -2; to < list.length + 2; to++) {
        const result = moveItem(list, from, to);
        expect(result).toHaveLength(list.length);
        expect([...result].sort()).toEqual([...list].sort());
      }
    }
  });

  it('clamps a target beyond the ends rather than dropping the item', () => {
    expect(moveItem(list, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(list, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('leaves the list alone when the source is not in it', () => {
    expect(moveItem(list, 9, 0)).toEqual(list);
    expect(moveItem(list, -1, 0)).toEqual(list);
  });

  it('does not mutate the original', () => {
    const original = [...list];
    moveItem(list, 0, 3);
    expect(list).toEqual(original);
  });

  it('handles a single item and an empty list', () => {
    expect(moveItem(['only'], 0, 0)).toEqual(['only']);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});

describe('finding the row under the pointer', () => {
  // Rows of different heights, as a real set has: songs are taller than gaps.
  const rects = [
    { top: 0, height: 40 },
    { top: 40, height: 60 },
    { top: 100, height: 40 },
  ];

  it('picks a row while the pointer is in its top half', () => {
    expect(indexAtPoint(rects, 5)).toBe(0);
    expect(indexAtPoint(rects, 19)).toBe(0);
  });

  it('moves to the next row once past the midpoint', () => {
    expect(indexAtPoint(rects, 21)).toBe(1);
    expect(indexAtPoint(rects, 69)).toBe(1);
    expect(indexAtPoint(rects, 71)).toBe(2);
  });

  it('clamps above the list and below it', () => {
    expect(indexAtPoint(rects, -500)).toBe(0);
    expect(indexAtPoint(rects, 5000)).toBe(2);
  });

  it('returns 0 for an empty list rather than -1', () => {
    expect(indexAtPoint([], 100)).toBe(0);
  });
});

describe('making room for the dragged row', () => {
  const H = 40;

  it('pushes the rows it passes upwards when dragging down', () => {
    // Dragging row 0 to position 2: rows 1 and 2 slide up, row 3 is untouched.
    expect(shiftFor(0, 0, 2, H)).toBe(0);
    expect(shiftFor(1, 0, 2, H)).toBe(-H);
    expect(shiftFor(2, 0, 2, H)).toBe(-H);
    expect(shiftFor(3, 0, 2, H)).toBe(0);
  });

  it('pushes the rows it passes downwards when dragging up', () => {
    // Dragging row 3 to position 1: rows 1 and 2 slide down, row 0 is untouched.
    expect(shiftFor(0, 3, 1, H)).toBe(0);
    expect(shiftFor(1, 3, 1, H)).toBe(H);
    expect(shiftFor(2, 3, 1, H)).toBe(H);
    expect(shiftFor(3, 3, 1, H)).toBe(0);
  });

  it('moves nothing when the target is where it started', () => {
    for (let i = 0; i < 4; i++) expect(shiftFor(i, 2, 2, H)).toBe(0);
  });

  it('leaves exactly one row-sized gap, wherever it is going', () => {
    // The invariant that makes the gap land in the right place: the shifted rows always
    // free up precisely one row of space at the target.
    for (const [from, to] of [
      [0, 3],
      [3, 0],
      [1, 2],
      [2, 1],
    ] as const) {
      const shifted = [0, 1, 2, 3].filter((i) => shiftFor(i, from, to, H) !== 0);
      expect(shifted).toHaveLength(Math.abs(to - from));
    }
  });
});
