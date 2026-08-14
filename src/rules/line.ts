import type { MoveInput, Promotion } from '../shared.js';
import { PgnError, resolveSan } from './pgn.js';
import { IllegalMoveError, type Move, type Position } from './position.js';
import { toSan } from './san.js';

export type MoveRequest = MoveInput | string;

export interface LineMove extends Move {
  readonly san: string;
  readonly uci: string;
  readonly before: string;
  readonly after: string;
}

export interface LineReplay {
  readonly moves: readonly LineMove[];
  readonly positions: readonly Position[];
  readonly final: Position;
}

const PROMOTION_LETTER: Readonly<Record<Promotion, string>> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

/** Compares the complete coordinate identity used by chess protocols and solution lines. */
export function sameMove(left: MoveInput, right: MoveInput): boolean {
  return left.from === right.from && left.to === right.to && left.promotion === right.promotion;
}

/** Returns the canonical UCI identity of a move. */
export function moveKey(move: MoveInput): string {
  return `${move.from}${move.to}${move.promotion ? PROMOTION_LETTER[move.promotion] : ''}`;
}

export function toUci(move: MoveInput): string {
  return moveKey(move);
}

/** Resolves coordinate, UCI, or SAN input through the position's one legal-move path. */
export function resolveMove(position: Position, request: MoveRequest): Move {
  if (typeof request !== 'string') return requireLegal(position, request, moveKey(request));

  const text = request.trim();
  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(text);
  if (uci) {
    const promotions = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const;
    const promotion = uci[3]
      ? promotions[uci[3].toLowerCase() as keyof typeof promotions]
      : undefined;
    return requireLegal(
      position,
      {
        from: uci[1].toLowerCase() as MoveInput['from'],
        to: uci[2].toLowerCase() as MoveInput['to'],
        ...(promotion ? { promotion } : {}),
      },
      text,
    );
  }

  try {
    return resolveSan(position, text);
  } catch (error) {
    if (error instanceof PgnError)
      throw new IllegalMoveError(`illegal move ${JSON.stringify(text)}`);
    throw error;
  }
}

/** Validates and replays a line while retaining every immutable position snapshot. */
export function replayLine(start: Position, requests: readonly MoveRequest[]): LineReplay {
  const moves: LineMove[] = [];
  const positions: Position[] = [start];
  let position = start;

  for (const [index, request] of requests.entries()) {
    let move: Move;
    try {
      move = resolveMove(position, request);
    } catch (error) {
      if (error instanceof IllegalMoveError) {
        const name = typeof request === 'string' ? request.trim() : moveKey(request);
        throw new IllegalMoveError(`illegal move ${JSON.stringify(name)} at ply ${index + 1}`);
      }
      throw error;
    }

    const after = position.play(move);
    moves.push(
      Object.freeze({
        ...move,
        san: toSan(position, move),
        uci: toUci(move),
        before: position.fen,
        after: after.fen,
      }),
    );
    positions.push(after);
    position = after;
  }

  return Object.freeze({
    moves: Object.freeze(moves),
    positions: Object.freeze(positions),
    final: position,
  });
}

/** Replays the space-delimited UCI principal variation emitted by chess engines. */
export function replayUci(start: Position, principalVariation: string): LineReplay {
  const requests = principalVariation.trim() === '' ? [] : principalVariation.trim().split(/\s+/);
  return replayLine(start, requests);
}

function requireLegal(position: Position, input: MoveInput, label: string): Move {
  const move = position.resolve(input);
  if (!move) throw new IllegalMoveError(`illegal move ${JSON.stringify(label)}`);
  return move;
}
