import type { Square } from '../shared.js';

export interface SquareState {
  readonly lastMove: readonly [Square, Square] | null;
  readonly checkedKing: Square | null;
  readonly legalDestinations: readonly Square[];
  readonly heldPiece: Square | null;
  readonly dropTarget: Square | null;
  readonly annotationFrom: Square | null;
  readonly annotationTo: Square | null;
}

export function describeSquareState(square: Square, state: SquareState): string {
  const descriptions: string[] = [];
  if (state.lastMove?.includes(square)) descriptions.push('last move');
  if (state.checkedKing === square) descriptions.push('check');
  if (state.legalDestinations.includes(square)) descriptions.push('legal destination');
  if (state.heldPiece === square) descriptions.push('held piece');
  if (state.dropTarget === square) descriptions.push('drop target');
  const { annotationFrom: from, annotationTo: to } = state;
  if (from && to) {
    if (from === square && to === square) descriptions.push('highlight preview');
    else if (from === square) descriptions.push(`arrow preview to ${to}`);
    else if (to === square) descriptions.push(`arrow preview from ${from}`);
  }
  return descriptions.join(', ');
}
