import { expect, test } from 'bun:test';
import { parsePieces } from './fen.js';

test('reads pieces directly from FEN without importing the rules engine', () => {
  const pieces = parsePieces('8/8/8/3q4/4P3/8/8/8 w - - 0 1');

  expect(pieces.get('d5')).toEqual({ color: 'black', type: 'queen' });
  expect(pieces.get('e4')).toEqual({ color: 'white', type: 'pawn' });
  expect(pieces.size).toBe(2);
});
