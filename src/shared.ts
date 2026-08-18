export type Color = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type Promotion = 'queen' | 'rook' | 'bishop' | 'knight';
export type Square = `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'}`;

export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

export interface MoveInput {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: Promotion;
}

export interface SquareHighlight {
  readonly square: Square;
  readonly color?: string;
  readonly label?: string;
}

export interface BoardArrow {
  readonly from: Square;
  readonly to: Square;
  readonly color?: string;
  readonly opacity?: number;
  readonly label?: string;
}
