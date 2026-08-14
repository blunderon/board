/**
 * The board as the screen reader sees it. Every square carries its coordinate and its
 * contents, because "e4" alone tells a player who cannot see the board nothing at all
 * (docs/testing.md "Accessibility").
 *
 * Pure and DOM-free: the template calls these, and the unit tests call the same functions the
 * template does, so the labels a user hears are the labels a test asserts on.
 *
 * Engine-free as well: every core import here is `import type`, erased at compile time, so this
 * module pulls none of position.ts, board.ts or fen.ts in behind it. That is why the square
 * functions take a piece and not the Position it came from - the caller already holds one.
 */
import type { Color, Piece, PieceType, Square } from '../shared.js';

const FILES = 'abcdefgh';

/** Spoken names, since a screen reader reads "n" as the letter, not as "knight". */
const TYPE_NAMES: Record<PieceType, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

const COLOR_NAMES: Record<Color, string> = { white: 'white', black: 'black' };

/** One rendered board row. `rank` is the row header a screen reader reads before the cells. */
export interface BoardRow {
  readonly rank: number;
  readonly squares: readonly Square[];
}

/**
 * Every square in FEN reading order: rank 8 down to rank 1, file a to file h. The E2E board
 * oracle reads the rendered cells back out as a FEN, so this order is load-bearing.
 */
export const SQUARES: readonly Square[] = Array.from({ length: 8 }, (_, row) =>
  Array.from({ length: 8 }, (_, file) => `${FILES[file]}${8 - row}` as Square),
).flat();

/** The same squares grouped into the eight rows the grid renders. */
export const BOARD_ROWS: readonly BoardRow[] = Array.from({ length: 8 }, (_, row) => ({
  rank: 8 - row,
  squares: SQUARES.slice(row * 8, row * 8 + 8),
}));

/** The grid rows, flipped (rank 1 at top, files h to a) if the seat is Black. */
export function boardRows(seat: Color): readonly BoardRow[] {
  if (seat === 'white') return BOARD_ROWS;

  return Array.from({ length: 8 }, (_, row) => ({
    rank: row + 1,
    squares: Array.from({ length: 8 }, (_, file) => `${FILES[7 - file]}${row + 1}` as Square),
  }));
}

/** The spoken name of a piece kind on its own, e.g. "knight". */
export function pieceTypeLabel(type: PieceType): string {
  return TYPE_NAMES[type];
}

/** The spoken name of a piece, e.g. "white knight". */
export function pieceLabel(piece: Piece): string {
  return `${COLOR_NAMES[piece.color]} ${pieceTypeLabel(piece.type)}`;
}

/** The accessible name of a square: "e4, white knight" or "e4, empty". */
export function describeSquare(piece: Piece | null, square: Square): string {
  return `${square}, ${piece === null ? 'empty' : pieceLabel(piece)}`;
}

/**
 * Light or dark, so the template can colour a square without recomputing the parity.
 *
 * The file index is zero-based and the rank is one-based, so an EVEN sum is a light square: a1 is
 * 0 + 1 = 1, odd, and a1 is dark on every chess set ever made.
 */
export function squareShade(square: Square): 'light' | 'dark' {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0 ? 'light' : 'dark';
}
