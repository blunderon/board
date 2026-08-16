import {
  type BoardBox,
  DRAG_THRESHOLD_PX,
  DragSession,
  ghostTransform,
  type Point,
  pointerMoved,
} from './drag.js';
import { parsePieces } from './fen.js';
import { nextSquare } from './navigate.js';
import { type Destinations, Selection, type SelectionResult } from './selection.js';
import {
  BOARD_ROWS,
  type BoardRow,
  boardRows,
  describeSquare,
  pieceLabel,
  pieceTypeLabel,
  SQUARES,
  squareShade,
} from './squares.js';

export type {
  BoardArrow,
  Color,
  Piece,
  PieceType,
  Promotion,
  Square,
  SquareHighlight,
} from '../shared.js';
export {
  BOARD_ROWS,
  type BoardBox,
  type BoardRow,
  boardRows,
  DRAG_THRESHOLD_PX,
  DragSession,
  type Destinations,
  describeSquare,
  ghostTransform,
  nextSquare,
  parsePieces,
  pieceLabel,
  pieceTypeLabel,
  type Point,
  pointerMoved,
  SQUARES,
  Selection,
  type SelectionResult,
  squareShade,
};
