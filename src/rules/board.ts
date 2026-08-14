/**
 * Mutable board representation and move generation.
 *
 * This is the performance-critical layer: a 0x88 mailbox in an Int8Array, moves encoded
 * as plain integers, and make/undo instead of copying. Perft needs hundreds of millions
 * of nodes, which rules out allocating an object per move. position.ts wraps this in
 * the immutable API the rest of the app uses.
 *
 * Pure data logic only — no I/O, no environment access.
 */

/** Piece types. Stored in the low three bits of a square. */
export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** Colors. Stored in bit three, so `piece & COLOR_MASK` is the color. */
export const WHITE = 0;
export const BLACK = 8;

export const TYPE_MASK = 7;
export const COLOR_MASK = 8;

/** Castling rights bits. */
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

/**
 * 0x88 square indices: `rank * 16 + file`, a1 = 0x00, h8 = 0x77. A square is off the
 * board exactly when `square & 0x88` is non-zero, which also catches negatives.
 */
export const OFF_BOARD = 0x88;

const A1 = 0x00;
const C1 = 0x02;
const D1 = 0x03;
const E1 = 0x04;
const F1 = 0x05;
const G1 = 0x06;
const H1 = 0x07;
const A8 = 0x70;
const C8 = 0x72;
const D8 = 0x73;
const E8 = 0x74;
const F8 = 0x75;
const G8 = 0x76;
const H8 = 0x77;

/** Complete game state. `ep` is -1 when no en passant target exists. */
export interface Board {
  squares: Int8Array;
  turn: number;
  castling: number;
  ep: number;
  halfmove: number;
  fullmove: number;
  /** King square per color, indexed by `color >> 3`. -1 when the color has no king. */
  kings: Int16Array;
}

/** Move flag bits, packed above the from/to/promotion fields. */
export const FLAG_CAPTURE = 1 << 19;
export const FLAG_EP = 1 << 20;
export const FLAG_DOUBLE = 1 << 21;
export const FLAG_CASTLE = 1 << 22;
export const FLAG_PROMO = 1 << 23;

/** Packs a move into one integer: from | to << 8 | promotion << 16 | flags. */
export function encodeMove(from: number, to: number, promotion = 0, flags = 0): number {
  return from | (to << 8) | (promotion << 16) | flags;
}

export function moveFrom(move: number): number {
  return move & 0xff;
}

export function moveTo(move: number): number {
  return (move >> 8) & 0xff;
}

/** Promotion piece type, or 0 when the move is not a promotion. */
export function movePromotion(move: number): number {
  return (move >> 16) & TYPE_MASK;
}

const KNIGHT_OFFSETS = [33, 31, 18, 14, -14, -18, -31, -33];
const BISHOP_OFFSETS = [17, 15, -15, -17];
const ROOK_OFFSETS = [16, 1, -1, -16];
const KING_OFFSETS = [17, 16, 15, 1, -1, -15, -16, -17];
/** A queen slides along the king's eight directions, so the two tables are identical. */
const QUEEN_OFFSETS = KING_OFFSETS;

/** Per-color pawn geometry, indexed by `color >> 3`. */
const PAWN_PUSH = [16, -16];
const PAWN_START_RANK = [1, 6];
const PAWN_PROMO_RANK = [6, 1];
const PAWN_CAPTURES = [
  [17, 15],
  [-17, -15],
];
/** Offsets from a square to the squares a pawn of the given color attacks it from. */
const PAWN_ATTACK_FROM = [
  [-17, -15],
  [17, 15],
];
const PROMOTION_TYPES = [QUEEN, ROOK, BISHOP, KNIGHT];

/**
 * Castling rights surviving a move touching each square. Applied to both the from and
 * the to square, so a rook that moves *or* is captured loses the matching right.
 */
const CASTLE_RIGHTS_MASK = (() => {
  const mask = new Uint8Array(128).fill(0b1111);
  mask[E1] = 0b1111 & ~(CASTLE_WK | CASTLE_WQ);
  mask[H1] = 0b1111 & ~CASTLE_WK;
  mask[A1] = 0b1111 & ~CASTLE_WQ;
  mask[E8] = 0b1111 & ~(CASTLE_BK | CASTLE_BQ);
  mask[H8] = 0b1111 & ~CASTLE_BK;
  mask[A8] = 0b1111 & ~CASTLE_BQ;
  return mask;
})();

/** Rook origin/destination for a castling move, keyed by the king's destination. */
const CASTLE_ROOK_FROM = new Int16Array(128);
const CASTLE_ROOK_TO = new Int16Array(128);
CASTLE_ROOK_FROM[G1] = H1;
CASTLE_ROOK_TO[G1] = F1;
CASTLE_ROOK_FROM[C1] = A1;
CASTLE_ROOK_TO[C1] = D1;
CASTLE_ROOK_FROM[G8] = H8;
CASTLE_ROOK_TO[G8] = F8;
CASTLE_ROOK_FROM[C8] = A8;
CASTLE_ROOK_TO[C8] = D8;

/** An empty board with white to move and no rights. Callers fill in the pieces. */
export function emptyBoard(): Board {
  return {
    squares: new Int8Array(128),
    turn: WHITE,
    castling: 0,
    ep: -1,
    halfmove: 0,
    fullmove: 1,
    kings: new Int16Array([-1, -1]),
  };
}

export function cloneBoard(board: Board): Board {
  return {
    squares: board.squares.slice(),
    turn: board.turn,
    castling: board.castling,
    ep: board.ep,
    halfmove: board.halfmove,
    fullmove: board.fullmove,
    kings: board.kings.slice(),
  };
}

/** True when `square` is attacked by any piece of `byColor`. */
export function isAttacked(board: Board, square: number, byColor: number): boolean {
  const squares = board.squares;

  // Pawns attack diagonally, so look back along the attacker's capture directions.
  for (const delta of PAWN_ATTACK_FROM[byColor >> 3]) {
    const from = square + delta;
    if (!(from & OFF_BOARD) && squares[from] === (PAWN | byColor)) return true;
  }

  for (const delta of KNIGHT_OFFSETS) {
    const from = square + delta;
    if (!(from & OFF_BOARD) && squares[from] === (KNIGHT | byColor)) return true;
  }

  for (const delta of KING_OFFSETS) {
    const from = square + delta;
    if (!(from & OFF_BOARD) && squares[from] === (KING | byColor)) return true;
  }

  // Sliding attacks: walk each ray until it leaves the board or hits a piece.
  if (isAttackedBySlider(squares, square, byColor, BISHOP_OFFSETS, BISHOP)) return true;
  return isAttackedBySlider(squares, square, byColor, ROOK_OFFSETS, ROOK);
}

/** Ray scan shared by bishop-like and rook-like attacks; queens match both. */
function isAttackedBySlider(
  squares: Int8Array,
  square: number,
  byColor: number,
  offsets: readonly number[],
  slider: number,
): boolean {
  for (const delta of offsets) {
    for (let to = square + delta; !(to & OFF_BOARD); to += delta) {
      const piece = squares[to];
      if (piece === EMPTY) continue;
      if (piece === (slider | byColor) || piece === (QUEEN | byColor)) return true;
      break;
    }
  }

  return false;
}

/** True when the king of `color` stands in check. */
export function isKingAttacked(board: Board, color: number): boolean {
  const king = board.kings[color >> 3];
  return king >= 0 && isAttacked(board, king, color ^ COLOR_MASK);
}

/**
 * Appends every pseudo-legal move for the side to move to `out`. Pseudo-legal means
 * castling is fully validated but other moves may still leave the king in check;
 * generateLegalMoves filters those out.
 */
export function generateMoves(board: Board, out: number[]): void {
  const squares = board.squares;
  const turn = board.turn;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const from = (rank << 4) | file;
      const piece = squares[from];
      if (piece === EMPTY || (piece & COLOR_MASK) !== turn) continue;

      switch (piece & TYPE_MASK) {
        case PAWN:
          generatePawnMoves(board, from, out);
          break;
        case KNIGHT:
          generateHops(squares, from, turn, KNIGHT_OFFSETS, out);
          break;
        case BISHOP:
          generateSlides(squares, from, turn, BISHOP_OFFSETS, out);
          break;
        case ROOK:
          generateSlides(squares, from, turn, ROOK_OFFSETS, out);
          break;
        case QUEEN:
          generateSlides(squares, from, turn, QUEEN_OFFSETS, out);
          break;
        case KING:
          generateHops(squares, from, turn, KING_OFFSETS, out);
          generateCastles(board, out);
          break;
      }
    }
  }
}

/** Pushes, double pushes, captures, en passant and all four promotion choices. */
function generatePawnMoves(board: Board, from: number, out: number[]): void {
  const squares = board.squares;
  const color = squares[from] & COLOR_MASK;
  const index = color >> 3;
  const promoting = from >> 4 === PAWN_PROMO_RANK[index];
  const one = from + PAWN_PUSH[index];

  if (!(one & OFF_BOARD) && squares[one] === EMPTY) {
    if (promoting) addPromotions(from, one, 0, out);
    else out.push(encodeMove(from, one));

    // The double push is only available from the pawn's home rank, over an empty square.
    if (from >> 4 === PAWN_START_RANK[index]) {
      const two = one + PAWN_PUSH[index];
      if (squares[two] === EMPTY) out.push(encodeMove(from, two, 0, FLAG_DOUBLE));
    }
  }

  for (const delta of PAWN_CAPTURES[index]) {
    const to = from + delta;
    if (to & OFF_BOARD) continue;

    const target = squares[to];
    if (target !== EMPTY) {
      if ((target & COLOR_MASK) === color) continue;
      if (promoting) addPromotions(from, to, FLAG_CAPTURE, out);
      else out.push(encodeMove(from, to, 0, FLAG_CAPTURE));
    } else if (to === board.ep) {
      out.push(encodeMove(from, to, 0, FLAG_CAPTURE | FLAG_EP));
    }
  }
}

function addPromotions(from: number, to: number, flags: number, out: number[]): void {
  for (const type of PROMOTION_TYPES) {
    out.push(encodeMove(from, to, type, flags | FLAG_PROMO));
  }
}

/** Single-step moves for knights and kings. */
function generateHops(
  squares: Int8Array,
  from: number,
  color: number,
  offsets: readonly number[],
  out: number[],
): void {
  for (const delta of offsets) {
    const to = from + delta;
    if (to & OFF_BOARD) continue;

    const target = squares[to];
    if (target === EMPTY) out.push(encodeMove(from, to));
    else if ((target & COLOR_MASK) !== color) out.push(encodeMove(from, to, 0, FLAG_CAPTURE));
  }
}

/** Ray moves for bishops, rooks and queens. */
function generateSlides(
  squares: Int8Array,
  from: number,
  color: number,
  offsets: readonly number[],
  out: number[],
): void {
  for (const delta of offsets) {
    for (let to = from + delta; !(to & OFF_BOARD); to += delta) {
      const target = squares[to];
      if (target === EMPTY) {
        out.push(encodeMove(from, to));
        continue;
      }

      if ((target & COLOR_MASK) !== color) out.push(encodeMove(from, to, 0, FLAG_CAPTURE));
      break;
    }
  }
}

/**
 * Castling. Rights alone are not enough: the king and rook must actually be home, the
 * squares between them empty, and the king must neither start in check nor pass through
 * an attacked square. The destination square is checked by the normal legality filter.
 */
function generateCastles(board: Board, out: number[]): void {
  const squares = board.squares;
  const color = board.turn;
  const enemy = color ^ COLOR_MASK;
  const home = color === WHITE ? E1 : E8;
  if (squares[home] !== (KING | color)) return;

  const kingSide = color === WHITE ? CASTLE_WK : CASTLE_BK;
  const queenSide = color === WHITE ? CASTLE_WQ : CASTLE_BQ;

  if (
    board.castling & kingSide &&
    squares[home + 3] === (ROOK | color) &&
    squares[home + 1] === EMPTY &&
    squares[home + 2] === EMPTY &&
    !isAttacked(board, home, enemy) &&
    !isAttacked(board, home + 1, enemy)
  ) {
    out.push(encodeMove(home, home + 2, 0, FLAG_CASTLE));
  }

  if (
    board.castling & queenSide &&
    squares[home - 4] === (ROOK | color) &&
    squares[home - 1] === EMPTY &&
    squares[home - 2] === EMPTY &&
    squares[home - 3] === EMPTY &&
    !isAttacked(board, home, enemy) &&
    !isAttacked(board, home - 1, enemy)
  ) {
    out.push(encodeMove(home, home - 2, 0, FLAG_CASTLE));
  }
}

/** State needed to reverse a single make; one instance is reused per search ply. */
export interface Undo {
  captured: number;
  capturedSquare: number;
  ep: number;
  castling: number;
  halfmove: number;
}

export function newUndo(): Undo {
  return { captured: EMPTY, capturedSquare: -1, ep: -1, castling: 0, halfmove: 0 };
}

/** Applies `move` in place, recording everything undoMove needs into `undo`. */
export function makeMove(board: Board, move: number, undo: Undo): void {
  const squares = board.squares;
  const from = moveFrom(move);
  const to = moveTo(move);
  const piece = squares[from];
  const color = piece & COLOR_MASK;
  const type = piece & TYPE_MASK;

  undo.ep = board.ep;
  undo.castling = board.castling;
  undo.halfmove = board.halfmove;

  // En passant removes a pawn that is not on the destination square.
  const capturedSquare = move & FLAG_EP ? to - PAWN_PUSH[color >> 3] : to;
  undo.capturedSquare = capturedSquare;
  undo.captured = squares[capturedSquare];
  squares[capturedSquare] = EMPTY;

  squares[from] = EMPTY;
  squares[to] = move & FLAG_PROMO ? movePromotion(move) | color : piece;

  if (move & FLAG_CASTLE) {
    squares[CASTLE_ROOK_TO[to]] = ROOK | color;
    squares[CASTLE_ROOK_FROM[to]] = EMPTY;
  }

  if (type === KING) board.kings[color >> 3] = to;

  board.castling &= CASTLE_RIGHTS_MASK[from] & CASTLE_RIGHTS_MASK[to];
  board.ep = move & FLAG_DOUBLE ? from + PAWN_PUSH[color >> 3] : -1;
  board.halfmove = type === PAWN || undo.captured !== EMPTY ? 0 : board.halfmove + 1;
  if (color === BLACK) board.fullmove++;
  board.turn = color ^ COLOR_MASK;
}

/** Reverses the most recent makeMove. `undo` must be the record that make filled in. */
export function undoMove(board: Board, move: number, undo: Undo): void {
  const squares = board.squares;
  const from = moveFrom(move);
  const to = moveTo(move);
  const piece = squares[to];
  const color = piece & COLOR_MASK;

  squares[from] = move & FLAG_PROMO ? PAWN | color : piece;
  squares[to] = EMPTY;
  // Restoring the capture last is what makes a same-square capture come back correctly.
  squares[undo.capturedSquare] = undo.captured;

  if (move & FLAG_CASTLE) {
    squares[CASTLE_ROOK_FROM[to]] = ROOK | color;
    squares[CASTLE_ROOK_TO[to]] = EMPTY;
  }

  if ((piece & TYPE_MASK) === KING) board.kings[color >> 3] = from;

  board.ep = undo.ep;
  board.castling = undo.castling;
  board.halfmove = undo.halfmove;
  if (color === BLACK) board.fullmove--;
  board.turn = color;
}

/** Every move for the side to move that does not leave its own king in check. */
export function generateLegalMoves(board: Board): number[] {
  const pseudo: number[] = [];
  generateMoves(board, pseudo);

  const legal: number[] = [];
  const undo = newUndo();
  const mover = board.turn;
  for (const move of pseudo) {
    makeMove(board, move, undo);
    if (!isKingAttacked(board, mover)) legal.push(move);
    undoMove(board, move, undo);
  }

  return legal;
}
