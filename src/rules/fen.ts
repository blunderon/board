/**
 * FEN parsing and serialization. Round-trips a canonical FEN byte for byte.
 *
 * Malformed input always produces a FenError, never a corrupted board.
 */
import {
  BISHOP,
  BLACK,
  type Board,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  COLOR_MASK,
  EMPTY,
  emptyBoard,
  isKingAttacked,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  TYPE_MASK,
  WHITE,
} from './board.js';

/** Thrown for any input that is not a well-formed FEN. */
export class FenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FenError';
  }
}

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_BY_CHAR: Record<string, number> = {
  p: PAWN | BLACK,
  n: KNIGHT | BLACK,
  b: BISHOP | BLACK,
  r: ROOK | BLACK,
  q: QUEEN | BLACK,
  k: KING | BLACK,
  P: PAWN | WHITE,
  N: KNIGHT | WHITE,
  B: BISHOP | WHITE,
  R: ROOK | WHITE,
  Q: QUEEN | WHITE,
  K: KING | WHITE,
};

const CHAR_BY_TYPE = ['', 'p', 'n', 'b', 'r', 'q', 'k'];

const CASTLE_BY_CHAR: Record<string, number> = {
  K: CASTLE_WK,
  Q: CASTLE_WQ,
  k: CASTLE_BK,
  q: CASTLE_BQ,
};

/** Converts algebraic notation such as `e4` to a 0x88 square index. */
export function squareFromAlgebraic(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) throw new FenError(`invalid square: ${JSON.stringify(name)}`);
  return ((name.charCodeAt(1) - 49) << 4) | (name.charCodeAt(0) - 97);
}

/** Converts a 0x88 square index to algebraic notation. */
export function algebraicFromSquare(square: number): string {
  return String.fromCharCode(97 + (square & 15), 49 + (square >> 4));
}

/** Parses a FEN into a board. Accepts the 4-field short form, defaulting the clocks. */
export function parseFen(fen: string): Board {
  if (typeof fen !== 'string') throw new FenError('FEN must be a string');

  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4 || fields.length > 6) {
    throw new FenError(`FEN must have 4 to 6 fields, got ${fields.length}`);
  }

  const board = emptyBoard();
  placePieces(board, fields[0]);
  board.turn = parseTurn(fields[1]);
  board.castling = parseCastling(fields[2]);
  board.ep = fields[3] === '-' ? -1 : squareFromAlgebraic(fields[3]);
  board.halfmove = parseCounter(fields[4] ?? '0', 'halfmove clock');
  board.fullmove = parseCounter(fields[5] ?? '1', 'fullmove number');
  validatePosition(board);

  return board;
}

/** Fills the board from the piece placement field, rank 8 first. */
function placePieces(board: Board, placement: string): void {
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new FenError(`placement must have 8 ranks, got ${ranks.length}`);

  for (const [index, rank] of ranks.entries()) {
    let file = 0;
    for (const char of rank) {
      if (char >= '1' && char <= '8') {
        file += char.charCodeAt(0) - 48;
        continue;
      }

      const piece = PIECE_BY_CHAR[char];
      if (piece === undefined) throw new FenError(`invalid piece: ${JSON.stringify(char)}`);
      if (file > 7) throw new FenError(`rank ${8 - index} overflows the board`);

      const square = ((7 - index) << 4) | file;
      board.squares[square] = piece;
      if ((piece & TYPE_MASK) === KING) board.kings[(piece & COLOR_MASK) >> 3] = square;
      file++;
    }

    if (file !== 8) throw new FenError(`rank ${8 - index} covers ${file} files, expected 8`);
  }
}

function parseTurn(field: string): number {
  if (field === 'w') return WHITE;
  if (field === 'b') return BLACK;
  throw new FenError(`invalid side to move: ${JSON.stringify(field)}`);
}

function parseCastling(field: string): number {
  if (field === '-') return 0;

  let rights = 0;
  for (const char of field) {
    const bit = CASTLE_BY_CHAR[char];
    if (bit === undefined) throw new FenError(`invalid castling rights: ${JSON.stringify(field)}`);
    if (rights & bit) throw new FenError(`duplicate castling right: ${JSON.stringify(char)}`);
    rights |= bit;
  }

  return rights;
}

function parseCounter(field: string, label: string): number {
  if (!/^\d+$/.test(field)) throw new FenError(`invalid ${label}: ${JSON.stringify(field)}`);

  // A counter beyond the safe integer range serializes in exponential form, which is not FEN.
  const value = Number(field);
  if (!Number.isSafeInteger(value) || value === Number.MAX_SAFE_INTEGER) {
    throw new FenError(`${label} is too large: ${field}`);
  }
  return value;
}

/** Rejects structurally impossible standard-chess state that move generation cannot repair. */
function validatePosition(board: Board): void {
  const kingCounts = [0, 0];

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board.squares[(rank << 4) | file];
      const type = piece & TYPE_MASK;
      if (type === KING) kingCounts[(piece & COLOR_MASK) >> 3]++;
      if (type === PAWN && (rank === 0 || rank === 7)) {
        throw new FenError('pawns cannot occupy rank 1 or rank 8');
      }
    }
  }

  if (kingCounts[0] !== 1) throw new FenError('position must contain exactly one white king');
  if (kingCounts[1] !== 1) throw new FenError('position must contain exactly one black king');
  if (board.fullmove < 1) throw new FenError('fullmove number must be at least 1');

  validateCastling(board);
  validateEnPassant(board);
  if (isKingAttacked(board, board.turn ^ COLOR_MASK)) {
    throw new FenError('the side that just moved cannot leave its king in check');
  }
}

/** A right is meaningful only while its king and rook remain on their home squares. */
function validateCastling(board: Board): void {
  const requirements = [
    [CASTLE_WK, 0x04, 0x07, WHITE],
    [CASTLE_WQ, 0x04, 0x00, WHITE],
    [CASTLE_BK, 0x74, 0x77, BLACK],
    [CASTLE_BQ, 0x74, 0x70, BLACK],
  ] as const;

  for (const [right, king, rook, color] of requirements) {
    if (!(board.castling & right)) continue;
    if (board.squares[king] !== (KING | color) || board.squares[rook] !== (ROOK | color)) {
      throw new FenError('castling rights require the king and rook on their home squares');
    }
  }
}

/** A target records the immediately preceding double pawn push, capturable or not. */
function validateEnPassant(board: Board): void {
  if (board.ep < 0) return;

  const expectedRank = board.turn === WHITE ? 5 : 2;
  if (board.ep >> 4 !== expectedRank) {
    throw new FenError('en passant target is inconsistent with the side to move');
  }

  const pawnColor = board.turn === WHITE ? BLACK : WHITE;
  const pawnOffset = board.turn === WHITE ? -16 : 16;
  if (
    board.squares[board.ep] !== EMPTY ||
    board.squares[board.ep + pawnOffset] !== (PAWN | pawnColor) ||
    board.squares[board.ep - pawnOffset] !== EMPTY
  ) {
    throw new FenError('en passant target does not follow a double pawn push');
  }
}

/** Serializes a board back to FEN. */
export function serializeFen(board: Board): string {
  return [
    serializePlacement(board),
    board.turn === WHITE ? 'w' : 'b',
    serializeCastling(board.castling),
    board.ep < 0 ? '-' : algebraicFromSquare(board.ep),
    String(board.halfmove),
    String(board.fullmove),
  ].join(' ');
}

/** Writes the piece placement field, collapsing empty squares into run lengths. */
function serializePlacement(board: Board): string {
  const ranks: string[] = [];

  for (let rank = 7; rank >= 0; rank--) {
    let text = '';
    let empty = 0;

    for (let file = 0; file < 8; file++) {
      const piece = board.squares[(rank << 4) | file];
      if (piece === EMPTY) {
        empty++;
        continue;
      }

      if (empty > 0) text += String(empty);
      empty = 0;
      const char = CHAR_BY_TYPE[piece & TYPE_MASK];
      text += (piece & COLOR_MASK) === WHITE ? char.toUpperCase() : char;
    }

    if (empty > 0) text += String(empty);
    ranks.push(text);
  }

  return ranks.join('/');
}

function serializeCastling(rights: number): string {
  const text =
    (rights & CASTLE_WK ? 'K' : '') +
    (rights & CASTLE_WQ ? 'Q' : '') +
    (rights & CASTLE_BK ? 'k' : '') +
    (rights & CASTLE_BQ ? 'q' : '');
  return text === '' ? '-' : text;
}
