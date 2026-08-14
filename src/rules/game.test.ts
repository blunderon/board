import { describe, expect, test } from 'bun:test';
import type { Square } from '../shared.js';
import { createGame, IllegalMoveError, INITIAL_FEN, PgnError } from './index.js';

describe('Game', () => {
  test('plays both sides using obvious coordinate moves or SAN', () => {
    const game = createGame();

    expect(game.move({ from: 'e2', to: 'e4' }).san).toBe('e4');
    expect(game.move('e5').from).toBe('e7');
    expect(game.move('Nf3').to).toBe('f3');

    expect(game.turn).toBe('black');
    expect(game.history).toHaveLength(3);
  });

  test('reports bad move submissions with one public error type', () => {
    const game = createGame();

    expect(() => game.move({ from: 'e2', to: 'e5' })).toThrow(IllegalMoveError);
    expect(() => game.move('e5')).toThrow(IllegalMoveError);
    expect(() => game.move('not a move')).toThrow(IllegalMoveError);
  });

  test('does not let callbacks or history readers rewrite played moves', () => {
    const game = createGame();
    const played = game.move('e4');

    expect(() => Object.assign(played, { san: 'd4' })).toThrow(TypeError);
    expect(game.history[0]?.san).toBe('e4');
  });

  test("plays Fool's Mate to a complete result and can undo it", () => {
    const game = createGame();
    for (const move of ['f3', 'e5', 'g4', 'Qh4#']) game.move(move);

    expect(game.status).toEqual({
      outcome: 'checkmate',
      winner: 'black',
      turn: 'white',
      check: true,
      over: true,
      drawClaims: [],
    });
    expect(game.undo()?.san).toBe('Qh4#');
    expect(game.status.over).toBe(false);
  });

  test('does not write a result tag that contradicts the game', () => {
    const game = createGame();
    for (const move of ['f3', 'e5', 'g4', 'Qh4#']) game.move(move);

    expect(game.toPgn({ Result: '*' })).toStartWith('[Result "0-1"]');
  });

  test('groups legal destinations for a board without exposing engine internals', () => {
    const game = createGame();
    const destinations = game.destinations();

    expect(destinations.get('e2' satisfies Square)).toEqual(['e3', 'e4']);
    expect(destinations.has('e7')).toBe(false);
    expect(destinations).toEqual(game.position.destinations());
  });

  test('writes a replayable PGN', () => {
    const game = createGame();
    for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) game.move(move);

    const replay = createGame();
    replay.loadPgn(game.toPgn({ Event: 'Offline example' }));

    expect(replay.fen).toBe(game.fen);
    expect(replay.history.map((move) => move.san)).toEqual(game.history.map((move) => move.san));
  });

  test('allows claimable draws and stops at automatic draws', () => {
    const game = createGame();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) {
      game.move(move);
    }

    expect(game.status.drawClaims).toContain('threefold-repetition');
    expect(game.status.over).toBe(false);
    expect(game.claimDraw('threefold-repetition').outcome).toBe('threefold-repetition');
    expect(game.status.over).toBe(true);

    game.reset();
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(move);
    }
    expect(game.status.outcome).toBe('fivefold-repetition');
    expect(game.status.over).toBe(true);
  });

  test('distinguishes the fifty-move claim from the automatic seventy-five-move draw', () => {
    const claimable = createGame({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 99 1' });
    claimable.move('Ra2');
    expect(claimable.status.drawClaims).toContain('fifty-move');
    expect(claimable.status.over).toBe(false);

    const automatic = createGame({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 149 1' });
    automatic.move('Ra2');
    expect(automatic.status.outcome).toBe('seventy-five-move');
    expect(automatic.status.over).toBe(true);
  });

  test('claims a draw by declaring an intended legal move', () => {
    const repetition = createGame();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) {
      repetition.move(move);
    }
    expect(repetition.claimDraw('threefold-repetition', 'Ng8').outcome).toBe(
      'threefold-repetition',
    );
    expect(repetition.history.at(-1)?.san).toBe('Ng1');

    const fiftyMoves = createGame({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 99 1' });
    expect(fiftyMoves.claimDraw('fifty-move', 'Ra2').outcome).toBe('fifty-move');
    expect(fiftyMoves.fen).toBe('4k3/8/8/8/8/8/8/R3K3 w - - 99 1');
  });

  test('preserves the FEN move number when writing a game that starts with black', () => {
    const game = createGame({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12',
    });
    game.move('e5');
    game.move('Nf3');

    expect(game.toPgn()).toBe(
      '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12"]\n\n12... e5 13. Nf3 *',
    );
  });

  test('keeps the current game intact when a PGN cannot be loaded completely', () => {
    const game = createGame();
    game.move('e4');
    const before = { fen: game.fen, history: game.history };
    const pgn =
      '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. Nf3 Nf6 6. Ng1 Ng8 7. Nf3 Nf6 8. Ng1 Ng8 9. Nf3 *';

    expect(() => game.loadPgn(pgn)).toThrow(IllegalMoveError);
    expect({ fen: game.fen, history: game.history }).toEqual(before);
  });

  test('records product-driven endings without making clocks a rules concern', () => {
    const game = createGame();
    game.move('e4');

    expect(game.finish('resignation', 'white')).toMatchObject({
      outcome: 'resignation',
      winner: 'white',
      over: true,
    });
    expect(() => game.move('e5')).toThrow(IllegalMoveError);
    expect(game.toPgn()).toEndWith('1-0');

    game.reset();
    expect(game.finish('draw-agreement')).toMatchObject({
      outcome: 'draw-agreement',
      winner: null,
    });
    expect(() => game.finish('timeout')).toThrow(IllegalMoveError);
    expect(() => game.finish('timeout', null)).toThrow(IllegalMoveError);
  });

  test('restores history-dependent state from a serializable snapshot', () => {
    const game = createGame();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) {
      game.move(move);
    }
    game.claimDraw('threefold-repetition');

    const restored = createGame({ snapshot: JSON.parse(JSON.stringify(game.snapshot)) });

    expect(restored.fen).toBe(game.fen);
    expect(restored.history.map((move) => move.san)).toEqual(game.history.map((move) => move.san));
    expect(restored.status.outcome).toBe('threefold-repetition');
    expect(restored.snapshot).toEqual(game.snapshot);
  });

  test('loads a declared PGN result even when the final position is not terminal', () => {
    const game = createGame();

    game.loadPgn('1. e4 e5 1-0');

    expect(game.status).toMatchObject({ outcome: 'declared-result', winner: 'white', over: true });
    expect(game.toPgn()).toEndWith('1-0');
  });

  test('does not change the current game when snapshot restoration fails', () => {
    const game = createGame();
    game.move('e4');
    const before = game.snapshot;

    expect(() =>
      game.restore({ version: 1, startFen: before.startFen, moves: ['e2e5'], termination: null }),
    ).toThrow(IllegalMoveError);
    expect(game.snapshot).toEqual(before);
  });

  test('restores a draw claimed by declaring the intended move', () => {
    const game = createGame();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) game.move(move);
    game.claimDraw('threefold-repetition', 'Ng8');

    const restored = createGame({ snapshot: JSON.parse(JSON.stringify(game.snapshot)) });

    expect(restored.status.outcome).toBe('threefold-repetition');
    expect(restored.fen).toBe(game.fen);
    expect(restored.snapshot.termination).toMatchObject({ intendedMove: 'f6g8' });
  });

  test('round-trips an intended-move draw claim through PGN', () => {
    const game = createGame();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) game.move(move);
    game.claimDraw('threefold-repetition', 'Ng8');

    const pgn = game.toPgn();
    const restored = createGame();
    restored.loadPgn(pgn);

    expect(pgn).toContain('[IntendedMove "f6g8"]');
    expect(restored.snapshot.termination).toEqual(game.snapshot.termination);
  });

  test('does not allow a draw claim to replace a completed game', () => {
    const game = createGame();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) game.move(move);
    game.finish('resignation', 'white');

    expect(() => game.claimDraw('threefold-repetition', 'Ng8')).toThrow(IllegalMoveError);
    expect(game.status).toMatchObject({ outcome: 'resignation', winner: 'white' });
  });

  test('adjudicates resignation and timeout as draws when the winner has no mating material', () => {
    for (const outcome of ['resignation', 'timeout'] as const) {
      const game = createGame({ fen: '7k/8/8/8/8/8/6Q1/7K w - - 0 1' });

      expect(game.finish(outcome, 'black')).toMatchObject({ outcome, winner: null, over: true });
      expect(game.toPgn()).toEndWith('1/2-1/2');
      expect(createGame({ snapshot: game.snapshot }).status).toMatchObject({
        outcome,
        winner: null,
      });
    }
  });

  test('rejects PGN results that contradict a terminal board position', () => {
    for (const result of ['1-0', '1/2-1/2', '*']) {
      const game = createGame();

      expect(() => game.loadPgn(`1. f3 e5 2. g4 Qh4# ${result}`)).toThrow(PgnError);
      expect(game.history).toEqual([]);
    }
  });

  test('round-trips external termination through PGN', () => {
    const game = createGame();
    game.move('e4');
    game.finish('resignation', 'white');

    const pgn = game.toPgn();
    const restored = createGame();
    restored.loadPgn(pgn);

    expect(pgn).toContain('[Termination "resignation"]');
    expect(restored.status).toMatchObject({ outcome: 'resignation', winner: 'white' });
  });

  test('strictly validates snapshots received across an untyped boundary', () => {
    expect(() => createGame({ snapshot: null as never })).toThrow(TypeError);
    expect(() =>
      createGame({
        snapshot: { version: 1, startFen: INITIAL_FEN, moves: ['e4'], termination: null },
      }),
    ).toThrow(TypeError);
    expect(() =>
      createGame({
        snapshot: {
          version: 1,
          startFen: INITIAL_FEN,
          moves: [],
          termination: { outcome: 'timeout', winner: 'purple' },
        } as never,
      }),
    ).toThrow(TypeError);
  });

  test('rejects snapshot terminations that bypass normal ending invariants', () => {
    const bareKing = '7k/8/8/8/8/8/6Q1/7K w - - 0 1';
    expect(() =>
      createGame({
        snapshot: {
          version: 1,
          startFen: bareKing,
          moves: [],
          termination: { outcome: 'timeout', winner: 'black' },
        },
      }),
    ).toThrow(TypeError);

    for (const termination of [
      { outcome: 'draw-agreement', winner: 'white' },
      { outcome: 'aborted', winner: 'black' },
      { outcome: 'abandonment', winner: null },
    ] as const) {
      expect(() =>
        createGame({
          snapshot: {
            version: 1,
            startFen: INITIAL_FEN,
            moves: [],
            termination: termination as never,
          },
        }),
      ).toThrow(TypeError);
    }

    expect(() =>
      createGame({
        snapshot: {
          version: 1,
          startFen: INITIAL_FEN,
          moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'],
          termination: { outcome: 'resignation', winner: 'white' },
        },
      }),
    ).toThrow(TypeError);
  });

  test('requires timeout winner to be the side that is not on move', () => {
    const game = createGame();

    expect(() => game.finish('timeout', 'white')).toThrow(IllegalMoveError);
    expect(game.finish('timeout', 'black')).toMatchObject({ winner: 'black', over: true });
  });

  test('requires PGN termination tags and results to describe the same ending', () => {
    for (const pgn of [
      '[Termination "draw agreement"]\n\n*',
      '[Termination "aborted"]\n\n1/2-1/2',
      '[Termination "time forfeit"]\n\n*',
      '[Termination "resignation"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
      '[IntendedMove "e2e4"]\n\n*',
    ]) {
      const game = createGame();
      expect(() => game.loadPgn(pgn)).toThrow(PgnError);
      expect(game.history).toEqual([]);
    }
  });

  test('derives chess-owned PGN tags instead of trusting caller overrides', () => {
    const game = createGame();
    game.move('e4');

    const pgn = game.toPgn({
      SetUp: '1',
      FEN: '7k/8/8/8/8/8/8/K7 w - - 0 1',
      Result: '1-0',
      Termination: 'resignation',
      IntendedMove: 'e7e5',
    });
    const restored = createGame();
    restored.loadPgn(pgn);

    expect(pgn).not.toContain('[SetUp ');
    expect(pgn).not.toContain('[FEN ');
    expect(pgn).not.toContain('[Termination ');
    expect(pgn).not.toContain('[IntendedMove ');
    expect(pgn).toContain('[Result "*"]');
    expect(restored.history.map((move) => move.san)).toEqual(['e4']);
  });
});
