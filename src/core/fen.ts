import type { Color, Piece, PieceType, Square } from '../shared.js';

const FILES = 'abcdefgh';
const PIECES: Readonly<Record<string, PieceType>> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** Reads only the piece-placement field needed to render a board. */
export function parsePieces(fen: string): ReadonlyMap<Square, Piece> {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) throw new Error('FEN has no piece placement');

  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`piece placement must have 8 ranks, got ${ranks.length}`);

  const pieces = new Map<Square, Piece>();
  for (const [row, rank] of ranks.entries()) {
    let file = 0;
    for (const character of rank) {
      if (/^[1-8]$/.test(character)) {
        file += Number(character);
        continue;
      }

      const type = PIECES[character.toLowerCase()];
      if (!type || file > 7) throw new Error(`invalid piece placement: ${placement}`);
      const color: Color = character === character.toUpperCase() ? 'white' : 'black';
      pieces.set(`${FILES[file]}${8 - row}` as Square, { color, type });
      file++;
    }

    if (file !== 8) throw new Error(`rank ${8 - row} covers ${file} files, expected 8`);
  }

  return pieces;
}
