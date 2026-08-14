import { describe, expect, test } from 'bun:test';
import { FenError, INITIAL_FEN, isThreefoldRepetition, Position, type Square } from './index.js';

test('threefold repetition asks whether the current position occurred three times', () => {
  expect(isThreefoldRepetition(['initial', 'other', 'initial', 'initial', 'current'])).toBe(false);
  expect(isThreefoldRepetition(['initial', 'other', 'initial', 'initial'])).toBe(true);
  expect(isThreefoldRepetition([])).toBe(false);
});

describe('Position', () => {
  test('starts with all twenty legal moves and never mutates a played position', () => {
    const before = Position.initial();
    const after = before.play({ from: 'e2', to: 'e4' });

    expect(before.fen).toBe(INITIAL_FEN);
    expect(before.legalMoves()).toHaveLength(20);
    expect(after.turn).toBe('black');
    expect(after.pieceAt('e4')).toEqual({ color: 'white', type: 'pawn' });
  });

  test('rejects malformed positions with a useful typed error', () => {
    expect(() => Position.fromFen('not a position')).toThrow(FenError);
  });

  test('resolves a minimal input to its complete legal move', () => {
    const position = Position.initial();

    expect(position.resolve({ from: 'e2', to: 'e4' })).toEqual({
      from: 'e2',
      to: 'e4',
      piece: 'pawn',
      capture: false,
      castle: false,
      enPassant: false,
    });
    expect(position.resolve({ from: 'e2', to: 'e5' })).toBeNull();
    expect(position.resolve({ from: 'z9' as Square, to: 'e4' })).toBeNull();
    expect(position.isLegal({ from: 'e2', to: 'nope' as Square })).toBe(false);
  });

  test('does not let callers corrupt cached legal moves', () => {
    const position = Position.initial();
    const move = position.legalMoves()[0];
    if (!move) throw new Error('initial position has no legal move');

    expect(() => Object.assign(move, { from: 'a1' })).toThrow(TypeError);
    expect(position.legalMoves()[0]?.from).not.toBe('a1');
  });

  test('groups legal destinations without losing promotion choices', () => {
    const initial = Position.initial().destinations();
    expect(initial.get('e2')).toEqual(['e3', 'e4']);
    expect(initial.has('e7')).toBe(false);

    const promotion = Position.fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(promotion.destinations().get('a7')).toEqual(['a8']);
    expect(promotion.resolve({ from: 'a7', to: 'a8' })).toBeNull();
    expect(promotion.resolve({ from: 'a7', to: 'a8', promotion: 'rook' })?.promotion).toBe('rook');
  });

  test('identifies the checked king square without exposing board internals', () => {
    expect(Position.initial().checkedKingSquare()).toBeNull();
    expect(Position.fromFen('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1').checkedKingSquare()).toBe('e8');
  });

  test('matches standard perft counts through castling and en passant positions', () => {
    expect(countLeaves(Position.initial(), 4)).toBe(197_281);
    expect(
      countLeaves(
        Position.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'),
        3,
      ),
    ).toBe(97_862);
  });

  test('handles castling, en passant, and explicit promotion', () => {
    const castles = Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(castles.play({ from: 'e1', to: 'g1' }).pieceAt('f1')?.type).toBe('rook');

    const enPassant = Position.fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const captured = enPassant.play({ from: 'e5', to: 'd6' });
    expect(captured.pieceAt('d5')).toBeNull();

    const promotion = Position.fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(() => promotion.play({ from: 'a7', to: 'a8' })).toThrow();
    expect(promotion.play({ from: 'a7', to: 'a8', promotion: 'knight' }).pieceAt('a8')?.type).toBe(
      'knight',
    );
  });

  test('reports every standard position-only ending', () => {
    expect(Position.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').outcome()).toBe('stalemate');
    expect(Position.fromFen('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1').outcome()).toBe('checkmate');
    expect(Position.fromFen('7k/8/8/8/8/8/8/K7 w - - 0 1').outcome()).toBe('insufficient-material');
    const fiftyMoves = Position.fromFen('7k/8/8/8/8/8/P7/K7 w - - 100 1');
    expect(fiftyMoves.isFiftyMoveDraw()).toBe(true);
    expect(fiftyMoves.outcome()).toBe('in-progress');
    expect(Position.fromFen('7k/8/8/8/8/8/P7/K7 w - - 150 1').outcome()).toBe('seventy-five-move');
  });

  test('reports whether either side has recognized mating material', () => {
    const loneBlackKing = Position.fromFen('7k/8/8/8/8/8/6Q1/7K w - - 0 1');
    expect(loneBlackKing.hasMatingMaterial('black')).toBe(false);
    expect(loneBlackKing.hasMatingMaterial('white')).toBe(true);

    const bareKings = Position.fromFen('7k/8/8/8/8/8/8/K7 w - - 0 1');
    expect(bareKings.hasMatingMaterial('white')).toBe(false);
    expect(bareKings.hasMatingMaterial('black')).toBe(false);
  });
});

function countLeaves(position: Position, depth: number): number {
  if (depth === 0) return 1;
  return position
    .legalMoves()
    .reduce((nodes, move) => nodes + countLeaves(position.play(move), depth - 1), 0);
}
