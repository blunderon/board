import type { Square } from '../shared.js';
import type { Position } from './position.js';

const FILES = 'abcdefgh';
const MATERIAL_TYPES = ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
export type MaterialPieceType = (typeof MATERIAL_TYPES)[number];
const MATERIAL_VALUES: Readonly<Record<(typeof MATERIAL_TYPES)[number], number>> = {
  bishop: 3,
  knight: 3,
  pawn: 1,
  queen: 9,
  rook: 5,
};

export interface MaterialBalance {
  readonly blackExtra: readonly MaterialPieceType[];
  /** Conventional display points, positive when White is ahead and negative when Black is ahead. */
  readonly pointDifference: number;
  readonly whiteExtra: readonly MaterialPieceType[];
}

/** Compares the pieces currently on the board; it does not reconstruct capture history. */
export function materialBalance(position: Position): MaterialBalance {
  const counts = { black: emptyCounts(), white: emptyCounts() };

  // Count every non-king piece in the immutable position.
  for (let rank = 1; rank <= 8; rank++) {
    for (const file of FILES) {
      const piece = position.pieceAt(`${file}${rank}` as Square);
      if (piece && piece.type !== 'king') counts[piece.color][piece.type] += 1;
    }
  }

  const blackExtra: MaterialPieceType[] = [];
  const whiteExtra: MaterialPieceType[] = [];

  // Preserve conventional display order while retaining both sides of an exchange.
  for (const type of MATERIAL_TYPES) {
    const difference = counts.white[type] - counts.black[type];
    const recipient = difference > 0 ? whiteExtra : blackExtra;
    for (let index = 0; index < Math.abs(difference); index++) recipient.push(type);
  }

  return Object.freeze({
    blackExtra: Object.freeze(blackExtra),
    pointDifference: materialPoints(counts.white) - materialPoints(counts.black),
    whiteExtra: Object.freeze(whiteExtra),
  });
}

type MaterialCounts = Record<(typeof MATERIAL_TYPES)[number], number>;

function emptyCounts(): MaterialCounts {
  return { bishop: 0, knight: 0, pawn: 0, queen: 0, rook: 0 };
}

function materialPoints(counts: MaterialCounts): number {
  return MATERIAL_TYPES.reduce((total, type) => total + counts[type] * MATERIAL_VALUES[type], 0);
}
