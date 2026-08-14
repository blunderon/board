import { expect, test } from 'bun:test';
import { IllegalMoveError, moveKey, Position, replayLine, replayUci, sameMove } from './index.js';

test('compares complete move identity including promotion', () => {
  expect(sameMove({ from: 'e2', to: 'e4' }, { from: 'e2', to: 'e4' })).toBe(true);
  expect(sameMove({ from: 'e2', to: 'e4' }, { from: 'd2', to: 'e4' })).toBe(false);
  expect(
    sameMove(
      { from: 'a7', to: 'a8', promotion: 'queen' },
      { from: 'a7', to: 'a8', promotion: 'knight' },
    ),
  ).toBe(false);
  expect(moveKey({ from: 'a7', to: 'a8', promotion: 'knight' })).toBe('a7a8n');
});

test('replays a mixed SAN and coordinate line into immutable snapshots', () => {
  const start = Position.initial();
  const line = replayLine(start, ['e4', 'e7e5', { from: 'g1', to: 'f3' }]);

  expect(line.moves.map((move) => [move.uci, move.san])).toEqual([
    ['e2e4', 'e4'],
    ['e7e5', 'e5'],
    ['g1f3', 'Nf3'],
  ]);
  expect(line.positions).toHaveLength(4);
  expect(line.positions[0]).toBe(start);
  expect(line.final.fen).toBe(line.positions[3]?.fen);
  expect(start.fen).toBe(Position.initial().fen);
});

test('replays an engine principal variation and reports the failing ply', () => {
  const line = replayUci(Position.initial(), 'e2e4 e7e5 g1f3');

  expect(line.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3']);
  expect(() => replayUci(Position.initial(), 'e2e4 e7e5 e1e3')).toThrow(
    new IllegalMoveError('illegal move "e1e3" at ply 3'),
  );
});
