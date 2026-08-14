/**
 * Arrow-key traversal of the board grid. Traversal CLAMPS at the edges rather than wrapping:
 * wrapping from h4 round to a4 reads as teleporting, and a player who cannot see the board has
 * no way to notice it happened.
 *
 * Keys this function does not own return null, so the caller leaves the event alone. That is
 * what keeps Tab working and the grid free of a keyboard trap.
 */
import type { Color, Square } from '../shared.js';

const FILES = 'abcdefgh';

/** How far each key moves, in files and ranks. Absent keys are not ours to handle. */
const STEPS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

const clamp = (value: number): number => Math.min(7, Math.max(0, value));

/** Splits a square into file and rank indices, or null when it is not a real square. */
function indices(square: Square): [number, number] | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  return [FILES.indexOf(square[0]), Number(square[1]) - 1];
}

/**
 * The square a key moves focus to, or null when the key belongs to someone else. Home and End
 * jump to the ends of the current rank, which is the standard grid contract.
 */
export function nextSquare(
  square: Square,
  key: string,
  orientation: Color = 'white',
): Square | null {
  const start = indices(square);
  if (start === null) return null;

  const [file, rank] = start;
  if (key === 'Home') return `${FILES[orientation === 'white' ? 0 : 7]}${rank + 1}` as Square;
  if (key === 'End') return `${FILES[orientation === 'white' ? 7 : 0]}${rank + 1}` as Square;

  const baseStep = STEPS[key];
  if (baseStep === undefined) return null;

  const step = orientation === 'white' ? baseStep : [-baseStep[0], -baseStep[1]];

  return `${FILES[clamp(file + step[0])]}${clamp(rank + step[1]) + 1}` as Square;
}
