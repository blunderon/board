import { boardState } from './board-state.js';
import { type BoardController, type BoardOptions, createBoard } from './dom/index.js';
import {
  type MoveRequest,
  type Position,
  type PuzzleAttempt,
  PuzzleSession,
  type PuzzleSessionSnapshot,
  type VariationMove,
  type VariationNode,
  type VariationTree,
} from './rules/index.js';
import type { Color } from './shared.js';

export interface PuzzleBoardOptions
  extends Omit<
    BoardOptions,
    | 'fen'
    | 'legalMoves'
    | 'lastMove'
    | 'checkedKing'
    | 'disabled'
    | 'onMove'
    | 'highlights'
    | 'arrows'
  > {
  readonly solution: VariationTree;
  readonly player?: Color;
  readonly autoReply?: boolean;
  readonly onAttempt?: (attempt: PuzzleAttempt) => void;
}

export interface PuzzleBoardController {
  readonly board: BoardController;
  readonly current: VariationNode;
  readonly position: Position;
  readonly complete: boolean;
  readonly expectedMoves: readonly VariationMove[];
  attempt(request: MoveRequest): PuzzleAttempt;
  reply(index?: number): PuzzleAttempt;
  snapshot(): PuzzleSessionSnapshot;
  restore(snapshot: PuzzleSessionSnapshot): void;
  reset(): void;
  destroy(): void;
}

/** Creates a board connected to a read-only authored puzzle solution. */
export function createPuzzleBoard(
  element: HTMLElement,
  options: PuzzleBoardOptions,
): PuzzleBoardController {
  const { solution, player, autoReply, onAttempt, ...boardOptions } = options;
  let session = new PuzzleSession(solution, {
    ...(player ? { player } : {}),
    ...(autoReply !== undefined ? { autoReply } : {}),
  });
  let board: BoardController;
  let lastMove = session.current.move;

  const sync = (attempt?: PuzzleAttempt): void => {
    if (attempt?.status === 'accepted' || attempt?.status === 'complete') {
      lastMove = attempt.replies.at(-1) ?? attempt.move ?? lastMove;
    }
    board.update({
      ...boardState(session.position),
      lastMove: lastMove ? [lastMove.from, lastMove.to] : null,
      disabled: session.complete || session.position.turn !== session.player,
    });
  };

  const attempt = (request: MoveRequest): PuzzleAttempt => {
    const result = session.attempt(request);
    sync(result);
    board.announce(describeAttempt(result));
    onAttempt?.(result);
    return result;
  };

  board = createBoard(element, {
    ...boardOptions,
    ...boardState(session.position),
    lastMove: lastMove ? [lastMove.from, lastMove.to] : null,
    disabled: session.complete || session.position.turn !== session.player,
    onMove: (from, to, promotion) => attempt({ from, to, ...(promotion ? { promotion } : {}) }),
  });

  return {
    board,
    get current() {
      return session.current;
    },
    get position() {
      return session.position;
    },
    get complete() {
      return session.complete;
    },
    get expectedMoves() {
      return session.expectedMoves;
    },
    attempt,
    reply: (index) => {
      const result = session.reply(index);
      sync(result);
      board.announce(describeReply(result));
      onAttempt?.(result);
      return result;
    },
    snapshot: () => session.snapshot,
    restore: (snapshot) => {
      session = PuzzleSession.fromSnapshot(snapshot);
      lastMove = session.current.move;
      sync();
    },
    reset: () => {
      session.reset();
      lastMove = session.current.move;
      sync();
    },
    destroy: () => board.destroy(),
  };
}

function describeReply(attempt: PuzzleAttempt): string {
  if (!attempt.move) return describeAttempt(attempt);
  return `${attempt.move.san}.${attempt.status === 'complete' ? ' Puzzle complete.' : ''}`;
}

function describeAttempt(attempt: PuzzleAttempt): string {
  if (attempt.status === 'illegal') return 'That move is not legal.';
  if (attempt.status === 'incorrect') return 'Try again.';
  if (attempt.status === 'complete') return 'Puzzle complete.';
  const replies = attempt.replies.map((move) => move.san).join(', ');
  return replies ? `Correct. ${replies}.` : 'Correct.';
}
