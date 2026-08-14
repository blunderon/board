import type { Color } from '../shared.js';
import { INITIAL_FEN } from './fen.js';
import { type MoveRequest, moveKey, resolveMove } from './line.js';
import { PgnError, parsePgn } from './pgn.js';
import {
  countRepetitions,
  IllegalMoveError,
  type Move,
  type Outcome,
  Position,
  type Square,
} from './position.js';
import { toSan } from './san.js';

export type DrawClaim = 'threefold-repetition' | 'fifty-move';
export type ExternalOutcome =
  | 'resignation'
  | 'draw-agreement'
  | 'timeout'
  | 'abandonment'
  | 'aborted'
  | 'declared-result';
const EXTERNAL_OUTCOMES: readonly ExternalOutcome[] = [
  'resignation',
  'draw-agreement',
  'timeout',
  'abandonment',
  'aborted',
  'declared-result',
];
const PGN_STATE_TAGS = new Set(['Result', 'Termination', 'IntendedMove', 'SetUp', 'FEN']);
export type GameOutcome = Outcome | DrawClaim | 'fivefold-repetition' | ExternalOutcome;

export type GameTermination =
  | { readonly outcome: DrawClaim; readonly winner: null; readonly intendedMove?: string }
  | { readonly outcome: 'resignation' | 'timeout'; readonly winner: Color | null }
  | { readonly outcome: 'draw-agreement' | 'aborted'; readonly winner: null }
  | { readonly outcome: 'abandonment'; readonly winner: Color }
  | { readonly outcome: 'declared-result'; readonly winner: Color | null };

export interface GameSnapshot {
  readonly version: 1;
  readonly startFen: string;
  readonly moves: readonly string[];
  readonly termination: GameTermination | null;
}

export interface GameStatus {
  readonly outcome: GameOutcome;
  readonly winner: Color | null;
  readonly turn: Color;
  readonly check: boolean;
  readonly over: boolean;
  readonly drawClaims: readonly DrawClaim[];
}

export interface PlayedMove extends Move {
  readonly san: string;
  readonly before: string;
  readonly after: string;
}

export interface GameOptions {
  readonly fen?: string;
  readonly snapshot?: GameSnapshot;
}

export type { MoveRequest } from './line.js';

/** A mutable game driver built from immutable Position snapshots. */
export class Game {
  private start: Position;
  private positions: Position[];
  private played: PlayedMove[] = [];
  private termination: GameTermination | null = null;

  constructor(options: GameOptions = {}) {
    if (options.fen && options.snapshot) throw new TypeError('fen and snapshot cannot be combined');
    this.start = options.fen ? Position.fromFen(options.fen) : Position.initial();
    this.positions = [this.start];
    if (options.snapshot !== undefined) this.restoreSnapshot(options.snapshot);
  }

  get position(): Position {
    return this.positions[this.positions.length - 1] as Position;
  }

  get fen(): string {
    return this.position.fen;
  }

  get turn(): Color {
    return this.position.turn;
  }

  get history(): readonly PlayedMove[] {
    return this.played.slice();
  }

  /** Complete serializable state, including history needed for repetition decisions. */
  get snapshot(): GameSnapshot {
    return Object.freeze({
      version: 1,
      startFen: this.start.fen,
      moves: Object.freeze(this.played.map((move) => moveKey(move))),
      termination: this.termination ? Object.freeze({ ...this.termination }) : null,
    });
  }

  get status(): GameStatus {
    const positionOutcome = this.position.outcome();
    const keys = this.positions.map((position) => position.repetitionKey);
    const repetitions = countRepetitions(keys, this.position.repetitionKey);
    const outcome = this.termination
      ? this.termination.outcome
      : repetitions >= 5
        ? 'fivefold-repetition'
        : positionOutcome;
    const over = outcome !== 'in-progress';
    const winner = this.termination
      ? this.termination.winner
      : outcome === 'checkmate'
        ? opposite(this.turn)
        : null;
    const drawClaims: DrawClaim[] = [];
    if (!over && repetitions >= 3) drawClaims.push('threefold-repetition');
    if (!over && this.position.isFiftyMoveDraw()) drawClaims.push('fifty-move');

    return { outcome, winner, turn: this.turn, check: this.position.isCheck(), over, drawClaims };
  }

  legalMoves(from?: Square): readonly Move[] {
    const moves = this.position.legalMoves();
    return from ? moves.filter((move) => move.from === from) : moves;
  }

  destinations(): ReadonlyMap<Square, readonly Square[]> {
    return this.position.destinations();
  }

  move(request: MoveRequest): PlayedMove {
    if (this.status.over) throw new IllegalMoveError(`the game is over: ${this.status.outcome}`);

    const move = resolveMove(this.position, request);
    const before = this.position;
    const san = toSan(before, move);
    const after = before.play(move);
    const played = Object.freeze({ ...move, san, before: before.fen, after: after.fen });

    this.played.push(played);
    this.positions.push(after);
    return played;
  }

  /** Claims an available draw, optionally by declaring the legal move that would create it. */
  claimDraw(reason: DrawClaim, intendedMove?: MoveRequest): GameStatus {
    if (this.status.over) throw new IllegalMoveError(`the game is over: ${this.status.outcome}`);

    const intended = intendedMove ? resolveMove(this.position, intendedMove) : null;
    const available = intended
      ? this.drawClaimsAfter(this.position.play(intended)).includes(reason)
      : this.status.drawClaims.includes(reason);
    if (!available) {
      throw new IllegalMoveError(`draw cannot be claimed by ${reason}`);
    }

    this.termination = Object.freeze({
      outcome: reason,
      winner: null,
      ...(intended ? { intendedMove: moveKey(intended) } : {}),
    });
    return this.status;
  }

  /** Records an ending decided by the surrounding product rather than the board position. */
  finish(outcome: ExternalOutcome, winner?: Color | null): GameStatus {
    if (this.status.over) throw new IllegalMoveError(`the game is over: ${this.status.outcome}`);
    this.termination = externalTermination(this.position, outcome, winner);
    return this.status;
  }

  private drawClaimsAfter(position: Position): DrawClaim[] {
    const claims: DrawClaim[] = [];
    const keys = [
      ...this.positions.map((candidate) => candidate.repetitionKey),
      position.repetitionKey,
    ];
    if (countRepetitions(keys, position.repetitionKey) >= 3) claims.push('threefold-repetition');
    if (position.isFiftyMoveDraw()) claims.push('fifty-move');
    return claims;
  }

  undo(): PlayedMove | null {
    if (this.played.length === 0) return null;
    this.termination = null;
    this.positions.pop();
    return this.played.pop() ?? null;
  }

  reset(fen = INITIAL_FEN): void {
    this.start = Position.fromFen(fen);
    this.positions = [this.start];
    this.played = [];
    this.termination = null;
  }

  /** Atomically replaces this game with a validated serialized snapshot. */
  restore(snapshot: GameSnapshot): void {
    this.restoreSnapshot(snapshot);
  }

  loadPgn(text: string): void {
    const parsed = parsePgn(text);
    const loaded = new Game({ fen: parsed.startFen });
    for (const move of parsed.moves) loaded.move(move);

    const termination = terminationFromPgn(parsed.tags.Termination);
    const intendedMove = parsed.tags.IntendedMove;
    if (intendedMove !== undefined && !isUciMove(intendedMove)) {
      throw new PgnError('IntendedMove must be a canonical UCI move');
    }
    if (
      intendedMove !== undefined &&
      termination !== 'threefold-repetition' &&
      termination !== 'fifty-move'
    ) {
      throw new PgnError('IntendedMove requires a draw-claim Termination tag');
    }
    if (loaded.status.over && termination) {
      throw new PgnError('Termination tag contradicts the final board position');
    }
    if (loaded.status.over && resultToken(loaded.status) !== parsed.result) {
      throw new PgnError(
        `result ${parsed.result} contradicts the final position (${resultToken(loaded.status)})`,
      );
    }
    if (!loaded.status.over) {
      const winner = winnerFromResult(parsed.result);
      try {
        if (termination === 'threefold-repetition' || termination === 'fifty-move') {
          loaded.claimDraw(termination, intendedMove);
        } else if (termination) {
          loaded.termination = externalTermination(loaded.position, termination, winner, true);
        } else if (parsed.result !== '*') {
          loaded.finish('declared-result', winner);
        }
      } catch (error) {
        if (error instanceof PgnError) throw error;
        throw new PgnError(error instanceof Error ? error.message : 'invalid PGN termination');
      }
    }
    if (resultToken(loaded.status) !== parsed.result) {
      throw new PgnError(`result ${parsed.result} contradicts the Termination tag`);
    }

    this.start = loaded.start;
    this.positions = loaded.positions;
    this.played = loaded.played;
    this.termination = loaded.termination;
  }

  toPgn(tags: Readonly<Record<string, string>> = {}): string {
    const includeResultTag = Object.hasOwn(tags, 'Result');
    const allTags = Object.fromEntries(
      Object.entries(tags).filter(([name]) => !PGN_STATE_TAGS.has(name)),
    );
    if (this.start.fen !== INITIAL_FEN) {
      allTags.SetUp = '1';
      allTags.FEN = this.start.fen;
    }

    const result = resultToken(this.status);
    if (this.termination) {
      allTags.Termination = terminationToPgn(this.termination.outcome);
      if ('intendedMove' in this.termination && this.termination.intendedMove) {
        allTags.IntendedMove = this.termination.intendedMove;
      }
    }
    if (includeResultTag) allTags.Result = result;
    const tagLines = Object.entries(allTags).map(
      ([name, value]) => `[${name} "${escapeTagValue(value)}"]`,
    );
    const moves = formatMoves(
      this.played.map((move) => move.san),
      this.start.turn,
      this.start.fullmoveNumber,
    );
    const body = `${moves}${moves ? ' ' : ''}${result}`;
    return tagLines.length > 0 ? `${tagLines.join('\n')}\n\n${body}` : body;
  }

  private restoreSnapshot(input: GameSnapshot): void {
    const snapshot = validateSnapshot(input);

    const loaded = new Game({ fen: snapshot.startFen });
    for (const move of snapshot.moves) loaded.move(move);
    if (snapshot.termination) {
      try {
        loaded.restoreTermination(snapshot.termination);
      } catch {
        throw new TypeError('game snapshot has an invalid termination');
      }
    }

    this.start = loaded.start;
    this.positions = loaded.positions;
    this.played = loaded.played;
    this.termination = loaded.termination;
  }

  private restoreTermination(termination: GameTermination): void {
    if (this.status.over) throw new IllegalMoveError('termination contradicts the final position');
    if (termination.outcome === 'threefold-repetition' || termination.outcome === 'fifty-move') {
      this.claimDraw(termination.outcome, termination.intendedMove);
      return;
    }

    const restored = externalTermination(
      this.position,
      termination.outcome,
      termination.winner,
      true,
    );
    if (restored.winner !== termination.winner) {
      throw new IllegalMoveError(`${termination.outcome} has an impossible winner`);
    }
    this.termination = restored;
  }
}

const SNAPSHOT_TERMINATIONS: readonly GameTermination['outcome'][] = [
  'threefold-repetition',
  'fifty-move',
  ...EXTERNAL_OUTCOMES,
];

function validateSnapshot(input: unknown): GameSnapshot {
  if (!input || typeof input !== 'object') throw new TypeError('game snapshot must be an object');
  const snapshot = input as Record<string, unknown>;
  if (snapshot.version !== 1 || typeof snapshot.startFen !== 'string') {
    throw new TypeError('unsupported game snapshot');
  }
  if (!Array.isArray(snapshot.moves) || !snapshot.moves.every(isUciMove)) {
    throw new TypeError('game snapshot moves must be canonical UCI strings');
  }

  const termination = validateTermination(snapshot.termination);
  return Object.freeze({
    version: 1,
    startFen: snapshot.startFen,
    moves: Object.freeze([...snapshot.moves] as string[]),
    termination,
  });
}

function validateTermination(input: unknown): GameTermination | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') {
    throw new TypeError('game snapshot termination must be an object or null');
  }

  const termination = input as Record<string, unknown>;
  if (!SNAPSHOT_TERMINATIONS.includes(termination.outcome as GameTermination['outcome'])) {
    throw new TypeError('game snapshot has an unknown termination');
  }
  if (
    termination.winner !== null &&
    termination.winner !== 'white' &&
    termination.winner !== 'black'
  ) {
    throw new TypeError('game snapshot has an invalid winner');
  }
  if (termination.intendedMove !== undefined && !isUciMove(termination.intendedMove)) {
    throw new TypeError('game snapshot has an invalid intended move');
  }

  const outcome = termination.outcome as GameTermination['outcome'];
  const intendedMove = termination.intendedMove as string | undefined;
  if (intendedMove && outcome !== 'threefold-repetition' && outcome !== 'fifty-move') {
    throw new TypeError('only a draw claim can have an intended move');
  }
  if (
    (outcome === 'threefold-repetition' || outcome === 'fifty-move') &&
    termination.winner !== null
  ) {
    throw new TypeError('a draw claim cannot have a winner');
  }

  return Object.freeze({
    outcome,
    winner: termination.winner as Color | null,
    ...(intendedMove ? { intendedMove } : {}),
  }) as GameTermination;
}

function isUciMove(value: unknown): value is string {
  return typeof value === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value);
}

function winnerFromResult(result: '1-0' | '0-1' | '1/2-1/2' | '*'): Color | null {
  if (result === '1-0') return 'white';
  if (result === '0-1') return 'black';
  return null;
}

function externalTermination(
  position: Position,
  outcome: ExternalOutcome,
  winner: Color | null | undefined,
  allowAdjudicatedDraw = false,
): GameTermination {
  if (!EXTERNAL_OUTCOMES.includes(outcome)) {
    throw new IllegalMoveError(`unknown game ending: ${String(outcome)}`);
  }
  if (winner !== undefined && winner !== null && winner !== 'white' && winner !== 'black') {
    throw new IllegalMoveError(`${outcome} has an invalid winner`);
  }
  if (outcome === 'draw-agreement' || outcome === 'aborted') {
    if (winner != null) throw new IllegalMoveError(`${outcome} cannot have a winner`);
    return Object.freeze({ outcome, winner: null });
  }
  if (outcome === 'declared-result') {
    return Object.freeze({ outcome, winner: winner ?? null });
  }
  if (outcome === 'abandonment') {
    if (!winner) throw new IllegalMoveError('abandonment requires a winner');
    return Object.freeze({ outcome, winner });
  }
  if (outcome === 'timeout' && winner && winner === position.turn) {
    throw new IllegalMoveError('timeout winner must be the side that is not on move');
  }
  if (!winner) {
    const drawIsPossible =
      outcome === 'timeout'
        ? !position.hasMatingMaterial(opposite(position.turn))
        : !position.hasMatingMaterial('white') || !position.hasMatingMaterial('black');
    if (!allowAdjudicatedDraw || !drawIsPossible) {
      throw new IllegalMoveError(`${outcome} requires a winner`);
    }
    return Object.freeze({ outcome, winner: null });
  }

  return Object.freeze({
    outcome,
    winner: position.hasMatingMaterial(winner) ? winner : null,
  });
}

function terminationToPgn(outcome: GameTermination['outcome']): string {
  const names: Readonly<Record<GameTermination['outcome'], string>> = {
    resignation: 'resignation',
    'draw-agreement': 'draw agreement',
    timeout: 'time forfeit',
    abandonment: 'abandoned',
    aborted: 'aborted',
    'declared-result': 'normal',
    'threefold-repetition': 'threefold repetition',
    'fifty-move': 'fifty-move rule',
  };
  return names[outcome];
}

function terminationFromPgn(value: string | undefined): GameTermination['outcome'] | null {
  if (value === undefined || value === 'normal') return null;
  const outcomes: Readonly<Record<string, GameTermination['outcome']>> = {
    resignation: 'resignation',
    'draw agreement': 'draw-agreement',
    'time forfeit': 'timeout',
    abandoned: 'abandonment',
    aborted: 'aborted',
    'threefold repetition': 'threefold-repetition',
    'fifty-move rule': 'fifty-move',
  };
  const outcome = outcomes[value];
  if (!outcome) throw new PgnError(`unsupported Termination tag: ${JSON.stringify(value)}`);
  return outcome;
}

export function createGame(options: GameOptions = {}): Game {
  return new Game(options);
}

function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function resultToken(status: GameStatus): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (!status.over) return '*';
  if (status.winner === 'white') return '1-0';
  if (status.winner === 'black') return '0-1';
  if (status.outcome === 'aborted') return '*';
  return '1/2-1/2';
}

function formatMoves(san: readonly string[], startTurn: Color, startNumber: number): string {
  const tokens: string[] = [];
  for (const [index, move] of san.entries()) {
    const color = index % 2 === 0 ? startTurn : opposite(startTurn);
    const number = startNumber + Math.floor((index + (startTurn === 'black' ? 1 : 0)) / 2);
    if (color === 'white') tokens.push(`${number}.`);
    else if (index === 0) tokens.push(`${number}...`);
    tokens.push(move);
  }
  return tokens.join(' ');
}

/** Escapes the two characters PGN reserves inside a tag string. */
function escapeTagValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
