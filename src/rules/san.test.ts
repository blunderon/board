import { expect, test } from 'bun:test';
import type { Promotion, Square } from '../shared.js';
import { Position, toSan } from './index.js';

test('writes captures, castling, promotion, check, and disambiguation', () => {
  const capture = Position.initial().play({ from: 'e2', to: 'e4' }).play({ from: 'd7', to: 'd5' });
  expect(toSan(capture, findMove(capture, 'e4', 'd5'))).toBe('exd5');

  const castles = Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  expect(toSan(castles, findMove(castles, 'e1', 'g1'))).toBe('O-O');

  const promotion = Position.fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  expect(toSan(promotion, findMove(promotion, 'a7', 'a8', 'queen'))).toBe('a8=Q+');

  const ambiguous = Position.fromFen('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');
  expect(toSan(ambiguous, findMove(ambiguous, 'b1', 'd2'))).toBe('Nbd2');
});

function findMove(position: Position, from: Square, to: Square, promotion?: Promotion) {
  const found = position
    .legalMoves()
    .find(
      (candidate) =>
        candidate.from === from && candidate.to === to && candidate.promotion === promotion,
    );
  if (!found) throw new Error(`missing test move ${from}${to}`);
  return found;
}
