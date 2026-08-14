import { expect, test } from 'bun:test';
import { PuzzleSession, VariationTree } from './index.js';

test('classifies attempts without modifying the authored solution', () => {
  const solution = new VariationTree();
  solution.addLine(['e4', 'e5', 'Nf3']);
  const session = new PuzzleSession(solution, { player: 'white' });

  expect(session.attempt('e2e5').status).toBe('illegal');
  expect(session.attempt('d4')).toMatchObject({ status: 'incorrect', move: { san: 'd4' } });
  expect(session.current.position.fen).toBe(solution.root.position.fen);
  expect(solution.root.children.map((node) => node.move?.san)).toEqual(['e4']);
});

test('accepts an authored branch, applies the main reply, and reports completion', () => {
  const solution = new VariationTree();
  solution.addLine(['e4', 'e5', 'Nf3']);
  const session = new PuzzleSession(solution, { player: 'white' });

  const first = session.attempt('e4');
  expect(first.status).toBe('accepted');
  expect(first.move?.san).toBe('e4');
  expect(first.replies.map((move) => move.san)).toEqual(['e5']);
  expect(session.position.turn).toBe('white');

  const final = session.attempt('Nf3');
  expect(final.status).toBe('complete');
  expect(session.complete).toBe(true);
});

test('supports branching solutions and product-controlled replies', () => {
  const solution = new VariationTree();
  solution.addLine(['e4', 'e5', 'Nf3']);
  solution.addLine(['d4', 'd5', 'c4']);
  const session = new PuzzleSession(solution, { player: 'white', autoReply: false });

  expect(session.expectedMoves.map((move) => move.san)).toEqual(['e4', 'd4']);
  expect(session.attempt('d4').replies).toEqual([]);
  expect(session.position.turn).toBe('black');
  expect(session.attempt('d5').status).toBe('incorrect');
  expect(session.position.turn).toBe('black');
  expect(session.reply().move?.san).toBe('d5');
  expect(session.position.turn).toBe('white');

  session.reset();
  expect(session.current.position.fen).toBe(solution.root.position.fen);
});

test('automatically applies an opponent setup move and resets after it', () => {
  const solution = new VariationTree();
  solution.addLine(['e4', 'e5', 'Nf3']);
  const session = new PuzzleSession(solution, { player: 'black' });

  expect(session.current.move?.san).toBe('e4');
  expect(session.position.turn).toBe('black');
  expect(session.expectedMoves.map((move) => move.san)).toEqual(['e5']);
  expect(session.attempt('e5').status).toBe('complete');

  session.reset();
  expect(session.current.move?.san).toBe('e4');
});

test('isolates the authored solution from later editor changes', () => {
  const solution = new VariationTree();
  solution.addLine(['e4']);
  const session = new PuzzleSession(solution);

  solution.play('d4');

  expect(session.expectedMoves.map((move) => move.san)).toEqual(['e4']);
  expect(session.attempt('d4').status).toBe('incorrect');
});

test('round-trips puzzle progress through a JSON-safe snapshot', () => {
  const solution = new VariationTree();
  solution.addLine(['e4', 'e5', 'Nf3']);
  const session = new PuzzleSession(solution);
  session.attempt('e4');

  const restored = PuzzleSession.fromSnapshot(JSON.parse(JSON.stringify(session.snapshot)));

  expect(restored.current.move?.san).toBe('e5');
  expect(restored.expectedMoves.map((move) => move.san)).toEqual(['Nf3']);
  expect(restored.attempt('Nf3').status).toBe('complete');
});

test('rejects snapshots that violate automatic reply state', () => {
  const solution = new VariationTree();
  solution.addLine(['e4', 'e5', 'Nf3']);
  const session = new PuzzleSession(solution);
  const snapshot = JSON.parse(JSON.stringify(session.snapshot));
  snapshot.solution.current = [0];

  expect(() => PuzzleSession.fromSnapshot(snapshot)).toThrow(TypeError);
});

test('rejects a move on the root of a solution snapshot', () => {
  const solution = new VariationTree();
  solution.addLine(['e4']);
  const snapshot = JSON.parse(JSON.stringify(new PuzzleSession(solution).snapshot));
  snapshot.solution.root.move = 'e2e4';

  expect(() => PuzzleSession.fromSnapshot(snapshot)).toThrow(TypeError);
});
