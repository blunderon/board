import type { Position } from './rules/index.js';
import type { Square } from './shared.js';

export interface BoardState {
  readonly fen: string;
  readonly legalMoves: ReadonlyMap<Square, readonly Square[]>;
  readonly checkedKing: Square | null;
}

/** Projects a rules position into the state expected by the independent DOM board. */
export function boardState(position: Position): BoardState {
  return {
    fen: position.fen,
    legalMoves: position.destinations(),
    checkedKing: position.checkedKingSquare(),
  };
}
