import type { Move, Position } from './position.js';

const LETTERS = {
  pawn: '',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
} as const;

/** Writes one legal move in Standard Algebraic Notation. */
export function toSan(position: Position, move: Move): string {
  const legal = position.legalMoves().find((candidate) => sameMove(candidate, move));
  if (!legal) throw new Error(`cannot write an illegal move: ${move.from}${move.to}`);

  if (legal.castle) return finish(position, legal, legal.to[0] === 'g' ? 'O-O' : 'O-O-O');

  const peers = position
    .legalMoves()
    .filter(
      (candidate) =>
        candidate.piece === legal.piece &&
        candidate.to === legal.to &&
        candidate.from !== legal.from,
    );
  const disambiguation = disambiguate(legal, peers);
  const capture = legal.capture ? 'x' : '';
  const pawnFile = legal.piece === 'pawn' && legal.capture ? legal.from[0] : '';
  const promotion = legal.promotion ? `=${LETTERS[legal.promotion]}` : '';

  return finish(
    position,
    legal,
    `${LETTERS[legal.piece]}${pawnFile}${disambiguation}${capture}${legal.to}${promotion}`,
  );
}

function sameMove(left: Move, right: Move): boolean {
  return left.from === right.from && left.to === right.to && left.promotion === right.promotion;
}

function disambiguate(move: Move, peers: readonly Move[]): string {
  if (peers.length === 0 || move.piece === 'pawn') return '';
  const sameFile = peers.some((candidate) => candidate.from[0] === move.from[0]);
  const sameRank = peers.some((candidate) => candidate.from[1] === move.from[1]);
  if (!sameFile) return move.from[0] ?? '';
  if (!sameRank) return move.from[1] ?? '';
  return move.from;
}

function finish(position: Position, move: Move, san: string): string {
  const after = position.play(move);
  if (after.isCheckmate()) return `${san}#`;
  if (after.isCheck()) return `${san}+`;
  return san;
}
