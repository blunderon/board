import blackBishop from '../pieces/bB.svg';
import blackKing from '../pieces/bK.svg';
import blackKnight from '../pieces/bN.svg';
import blackPawn from '../pieces/bP.svg';
import blackQueen from '../pieces/bQ.svg';
import blackRook from '../pieces/bR.svg';
import whiteBishop from '../pieces/wB.svg';
import whiteKing from '../pieces/wK.svg';
import whiteKnight from '../pieces/wN.svg';
import whitePawn from '../pieces/wP.svg';
import whiteQueen from '../pieces/wQ.svg';
import whiteRook from '../pieces/wR.svg';
import type { Piece } from '../shared.js';

export type PieceTheme = (piece: Piece) => string;

export interface BoardTheme {
  readonly lightSquare: string;
  readonly darkSquare: string;
  readonly selected: string;
  readonly legalMove: string;
  readonly lastMove: string;
  readonly check: string;
  readonly focus: string;
  readonly annotation: string;
  readonly pieces: PieceTheme;
}

export type ThemeOptions = Partial<BoardTheme>;

const PIECE_URLS = {
  white: {
    pawn: whitePawn,
    knight: whiteKnight,
    bishop: whiteBishop,
    rook: whiteRook,
    queen: whiteQueen,
    king: whiteKing,
  },
  black: {
    pawn: blackPawn,
    knight: blackKnight,
    bishop: blackBishop,
    rook: blackRook,
    queen: blackQueen,
    king: blackKing,
  },
} as const;

/** The bundled piece set, resolved from the package instead of the consuming site. */
export const defaultPieces: PieceTheme = (piece) => PIECE_URLS[piece.color][piece.type];

/** Warm walnut colors with high-contrast interaction states. */
export const DEFAULT_THEME: BoardTheme = Object.freeze({
  lightSquare: '#f0d9b5',
  darkSquare: '#9f6847',
  selected: '#f6c344',
  legalMove: '#26734d',
  lastMove: '#d7bd43',
  check: '#c23b3b',
  focus: '#1261a0',
  annotation: '#d68b18',
  pieces: defaultPieces,
});

export function mergeTheme(theme: ThemeOptions = {}): BoardTheme {
  return { ...DEFAULT_THEME, ...theme };
}
