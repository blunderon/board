/**
 * The immutable public rules API.
 *
 * Everything outside src/core/ talks to chess through Position: a frozen snapshot whose
 * `play` returns a new snapshot. The mutable engine in board.ts stays private to the
 * core so no caller can corrupt a shared board. Pure data logic — no I/O.
 */

import type { Color, MoveInput, Piece, PieceType, Promotion, Square } from '../shared.js';
import {
  BISHOP,
  type Board,
  COLOR_MASK,
  cloneBoard,
  EMPTY,
  FLAG_CASTLE,
  FLAG_EP,
  FLAG_PROMO,
  generateLegalMoves,
  isKingAttacked,
  KING,
  KNIGHT,
  makeMove,
  moveFrom,
  movePromotion,
  moveTo,
  newUndo,
  PAWN,
  QUEEN,
  ROOK,
  TYPE_MASK,
  WHITE,
} from './board.js';
import {
  algebraicFromSquare,
  INITIAL_FEN,
  parseFen,
  serializeFen,
  squareFromAlgebraic,
} from './fen.js';

export type { Color, MoveInput, Piece, PieceType, Promotion, Square } from '../shared.js';

/** A legal move in the coordinate form the UI and the server exchange. */
export interface Move {
  readonly from: Square;
  readonly to: Square;
  /** Present only for pawn promotions. */
  readonly promotion?: Promotion;
  readonly piece: PieceType;
  readonly capture: boolean;
  readonly castle: boolean;
  readonly enPassant: boolean;
}

/** Why a game is over, or that it is not. */
export type Outcome =
  | 'in-progress'
  | 'checkmate'
  | 'stalemate'
  | 'seventy-five-move'
  | 'insufficient-material';

/** Thrown when a caller submits a move that is not legal in this position. */
export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

const TYPE_BY_NAME: Record<PieceType, number> = {
  pawn: PAWN,
  knight: KNIGHT,
  bishop: BISHOP,
  rook: ROOK,
  queen: QUEEN,
  king: KING,
};
const NAME_BY_TYPE: readonly PieceType[] = [
  'pawn',
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];
const NAME_BY_CHAR: Readonly<Record<string, PieceType>> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/**
 * Narrows a piece letter to a PieceType, or null when it names no piece. Exported so the
 * PGN parser can validate SAN letters against the same table this module already keys its
 * moves by, rather than declaring a fourth piece-character table in the core.
 */
export function pieceTypeFromChar(char: string): PieceType | null {
  return NAME_BY_CHAR[char.toLowerCase()] ?? null;
}

/** An immutable chess position. Construct with `fromFen` or `initial`. */
export class Position {
  private readonly board: Board;
  private cachedMoves: Move[] | null = null;

  private constructor(board: Board) {
    this.board = board;
  }

  static fromFen(fen: string): Position {
    return new Position(parseFen(fen));
  }

  static initial(): Position {
    return Position.fromFen(INITIAL_FEN);
  }

  get fen(): string {
    return serializeFen(this.board);
  }

  get turn(): Color {
    return this.board.turn === WHITE ? 'white' : 'black';
  }

  get halfmoveClock(): number {
    return this.board.halfmove;
  }

  get fullmoveNumber(): number {
    return this.board.fullmove;
  }

  /** The piece on a square, or null when it is empty. */
  pieceAt(square: Square): Piece | null {
    const piece = this.board.squares[squareFromAlgebraic(square)];
    if (piece === EMPTY) return null;
    return {
      color: (piece & COLOR_MASK) === WHITE ? 'white' : 'black',
      type: NAME_BY_TYPE[piece & TYPE_MASK],
    };
  }

  /** Every legal move for the side to move. Computed once and cached per position. */
  legalMoves(): Move[] {
    if (!this.cachedMoves) {
      this.cachedMoves = generateLegalMoves(this.board).map((move) =>
        describeMove(this.board, move),
      );
    }

    return this.cachedMoves.slice();
  }

  /** Resolves a minimal input to its complete legal move, or null when it is illegal. */
  resolve(input: MoveInput): Move | null {
    const encoded = this.findMove(input);
    return encoded === null ? null : describeMove(this.board, encoded);
  }

  /** Legal destination squares grouped by origin for board renderers and input controls. */
  destinations(): ReadonlyMap<Square, readonly Square[]> {
    const destinations = new Map<Square, Square[]>();

    for (const move of this.legalMoves()) {
      const targets = destinations.get(move.from) ?? [];
      if (!targets.includes(move.to)) targets.push(move.to);
      destinations.set(move.from, targets);
    }

    return destinations;
  }

  /** Applies a move, returning the resulting position. Never mutates this one. */
  play(input: MoveInput): Position {
    const encoded = this.findMove(input);
    if (encoded === null) {
      const promotion = input.promotion ? `=${input.promotion}` : '';
      throw new IllegalMoveError(
        `illegal move ${input.from}${input.to}${promotion} in ${this.fen}`,
      );
    }

    const next = cloneBoard(this.board);
    makeMove(next, encoded, newUndo());
    return new Position(next);
  }

  /** True when the submitted move is legal here. */
  isLegal(input: MoveInput): boolean {
    return this.findMove(input) !== null;
  }

  isCheck(): boolean {
    return isKingAttacked(this.board, this.board.turn);
  }

  /** The side-to-move king's square when it is in check, otherwise null. */
  checkedKingSquare(): Square | null {
    if (!this.isCheck()) return null;

    const king = this.board.kings[this.board.turn >> 3];
    return king < 0 ? null : (algebraicFromSquare(king) as Square);
  }

  isCheckmate(): boolean {
    return this.isCheck() && this.legalMoves().length === 0;
  }

  isStalemate(): boolean {
    return !this.isCheck() && this.legalMoves().length === 0;
  }

  /** The fifty-move rule: 100 half-moves without a capture or a pawn move. */
  isFiftyMoveDraw(): boolean {
    return this.board.halfmove >= 100;
  }

  /** The automatic draw after 75 moves without a capture or pawn move. */
  isSeventyFiveMoveDraw(): boolean {
    return this.board.halfmove >= 150;
  }

  /** True when neither side can possibly deliver mate with the remaining material. */
  isInsufficientMaterial(): boolean {
    return hasInsufficientMaterial(this.board);
  }

  /** Conservative material-only test used for common timeout and resignation adjudication. */
  hasMatingMaterial(color: Color): boolean {
    const encodedColor = color === 'white' ? WHITE : WHITE ^ COLOR_MASK;
    let nonKingPiece = false;

    for (let rank = 0; rank < 8 && !nonKingPiece; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = this.board.squares[(rank << 4) | file];
        if (
          piece !== EMPTY &&
          (piece & COLOR_MASK) === encodedColor &&
          (piece & TYPE_MASK) !== KING
        ) {
          nonKingPiece = true;
          break;
        }
      }
    }

    return nonKingPiece && !this.isInsufficientMaterial();
  }

  /**
   * Terminal state of this position alone. Threefold repetition needs history, so it is
   * not decidable here; see repetitionKey and countRepetitions.
   */
  outcome(): Outcome {
    if (this.legalMoves().length === 0) return this.isCheck() ? 'checkmate' : 'stalemate';
    if (this.isInsufficientMaterial()) return 'insufficient-material';
    if (this.isSeventyFiveMoveDraw()) return 'seventy-five-move';
    return 'in-progress';
  }

  /**
   * Identity of a position for repetition purposes: placement, side to move, castling
   * rights and en passant target, with the clocks omitted.
   *
   * The FEN field cannot be copied across as it stands: standard FEN names a target after
   * any double pawn push, while FIDE compares positions by the moves available to each
   * side. A target no pawn can legally capture on changes nothing about the moves, so it
   * must not distinguish two otherwise identical positions — it keys as `-` instead, or
   * repetitions reached through a double push go undetected.
   */
  get repetitionKey(): string {
    const fields = this.fen.split(' ').slice(0, 4);
    if (!this.legalMoves().some((move) => move.enPassant)) fields[3] = '-';
    return fields.join(' ');
  }

  /** Resolves a caller's move onto one of the generated legal moves. */
  private findMove(input: MoveInput): number | null {
    if (!/^[a-h][1-8]$/.test(input.from) || !/^[a-h][1-8]$/.test(input.to)) return null;

    const from = squareFromAlgebraic(input.from);
    const to = squareFromAlgebraic(input.to);
    const promotion = input.promotion ? TYPE_BY_NAME[input.promotion] : 0;
    if (input.promotion !== undefined && !promotion) return null;

    for (const move of generateLegalMoves(this.board)) {
      if (moveFrom(move) !== from || moveTo(move) !== to) continue;
      // A promotion move only matches when the requested piece matches; an omitted
      // promotion is rejected rather than guessed, so the caller stays explicit.
      if (movePromotion(move) === promotion) return move;
    }

    return null;
  }
}

/** Expands an encoded move into the public shape, reading the pre-move board. */
function describeMove(board: Board, move: number): Move {
  const from = moveFrom(move);
  const promotion = movePromotion(move);

  return Object.freeze({
    from: algebraicFromSquare(from) as Square,
    to: algebraicFromSquare(moveTo(move)) as Square,
    ...(move & FLAG_PROMO ? { promotion: NAME_BY_TYPE[promotion] as Promotion } : {}),
    piece: NAME_BY_TYPE[board.squares[from] & TYPE_MASK],
    capture: board.squares[moveTo(move)] !== EMPTY || Boolean(move & FLAG_EP),
    castle: Boolean(move & FLAG_CASTLE),
    enPassant: Boolean(move & FLAG_EP),
  });
}

/**
 * Insufficient material: king versus king, king and one minor piece, and any number of
 * bishops that all stand on one square color.
 */
function hasInsufficientMaterial(board: Board): boolean {
  let pieces = 0;
  let bishops = 0;
  let knights = 0;
  let lightBishops = 0;
  let darkBishops = 0;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square = (rank << 4) | file;
      const piece = board.squares[square];
      if (piece === EMPTY) continue;

      pieces++;
      const type = piece & TYPE_MASK;
      if (type === PAWN || type === ROOK || type === QUEEN) return false;
      if (type === KNIGHT) knights++;
      if (type === BISHOP) {
        bishops++;
        if ((rank + file) % 2 === 0) darkBishops++;
        else lightBishops++;
      }
    }
  }

  if (pieces === 2) return true;
  if (pieces === 3 && (bishops === 1 || knights === 1)) return true;
  return pieces === bishops + 2 && (lightBishops === 0 || darkBishops === 0);
}

/** How many times the given repetition key occurs in a game's position history. */
export function countRepetitions(keys: readonly string[], key: string): number {
  return keys.filter((candidate) => candidate === key).length;
}

/**
 * Threefold repetition. `keys` is every position of the game in order, including the
 * current one, as Position.repetitionKey values.
 */
export function isThreefoldRepetition(keys: readonly string[]): boolean {
  const current = keys.at(-1);
  return current !== undefined && countRepetitions(keys, current) >= 3;
}
