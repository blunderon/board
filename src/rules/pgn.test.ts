import { expect, test } from 'bun:test';
import { createGame, PgnError, Position, parsePgn, resolveSan } from './index.js';

test('requires SAN capture markers to agree with the legal move', () => {
  expect(() => resolveSan(Position.initial(), 'Nxf3')).toThrow(PgnError);

  const capture = Position.initial().play({ from: 'e2', to: 'e4' }).play({ from: 'd7', to: 'd5' });
  expect(() => resolveSan(capture, 'ed5')).toThrow(PgnError);
  expect(resolveSan(capture, 'exd5')).toMatchObject({ from: 'e4', to: 'd5', capture: true });
});

test('round-trips quotes and backslashes in PGN tags', () => {
  const game = createGame();
  game.move('e4');

  const parsed = parsePgn(game.toPgn({ Event: 'A ] "quoted" \\ event' }));

  expect(parsed.tags.Event).toBe('A ] "quoted" \\ event');
});

test('ignores closing parentheses inside variation line comments', () => {
  const parsed = parsePgn(
    '1. e4 (1. d4 ; a commented ) must be ignored\n1... d5) 1... e5 2. Nf3 *',
  );

  expect(parsed.moves.map((move) => [move.from, move.to])).toEqual([
    ['e2', 'e4'],
    ['e7', 'e5'],
    ['g1', 'f3'],
  ]);
});

test('allows brackets inside movetext comments but rejects late tag pairs', () => {
  expect(parsePgn('1. e4 {[analysis]} e5 *').san).toEqual(['e4', 'e5']);
  expect(parsePgn('1. e4 ; [analysis] comment\ne5 *').san).toEqual(['e4', 'e5']);
  expect(() => parsePgn('1. e4 [Event "late"] e5 *')).toThrow(PgnError);
});

test('requires setup and result tags to agree with their PGN fields', () => {
  expect(() => parsePgn('[Result "1-0"]\n\n1. e4 *')).toThrow(PgnError);
  expect(() => parsePgn('[SetUp "1"]\n\n*')).toThrow(PgnError);
  expect(() => parsePgn('[FEN "4k3/8/8/8/8/8/8/4K3 w - - 0 1"]\n\n*')).toThrow(PgnError);
});

test('preserves recursive variations, comments, and numeric annotations', () => {
  const parsed = parsePgn(
    '1. e4 {King pawn} (1. d4 $2 d5 {Queen pawn} (1... Nf6)) 1... e5 $1 2. Nf3 *',
  );

  expect(parsed.line.moves.map((node) => node.san)).toEqual(['e4', 'e5', 'Nf3']);
  expect(parsed.line.moves[0]?.comments).toEqual(['King pawn']);
  expect(parsed.line.moves[1]?.nags).toEqual([1]);
  expect(parsed.line.moves[0]?.variations[0]?.moves.map((node) => node.san)).toEqual(['d4', 'd5']);
  expect(parsed.line.moves[0]?.variations[0]?.moves[1]?.comments).toEqual(['Queen pawn']);
  expect(parsed.line.moves[0]?.variations[0]?.moves[1]?.variations[0]?.moves[0]?.san).toBe('Nf6');
});

test('rejects annotations and variations that are not attached to a move', () => {
  expect(() => parsePgn('$1 1. e4 *')).toThrow(PgnError);
  expect(() => parsePgn('(1. d4) 1. e4 *')).toThrow(PgnError);
});

test('normalizes symbolic annotations and permits a trailing comment', () => {
  const parsed = parsePgn('1. e4!? e5 ! * {Imported successfully}');

  expect(parsed.line.moves[0]?.nags).toEqual([5]);
  expect(parsed.line.moves[1]?.nags).toEqual([1]);
  expect(parsed.san).toEqual(['e4!?', 'e5']);
});
