import { expect, test } from 'bun:test';
import { boardState, Position } from './index.js';

test('projects a rules position into the complete DOM board input', () => {
  const position = Position.fromFen('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');

  expect(boardState(position)).toEqual({
    fen: position.fen,
    legalMoves: position.destinations(),
    checkedKing: 'e8',
  });
});
