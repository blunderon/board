import { type BoardState, boardState } from './board-state.js';
import { type BoardController, type BoardOptions, createBoard } from './dom/index.js';
import {
  createGame,
  type DrawClaim,
  type ExternalOutcome,
  type GameSnapshot,
  type GameStatus,
  type MoveRequest,
  type PlayedMove,
} from './rules/index.js';
import type { Color } from './shared.js';

export { type BoardState, boardState };

export interface GameBoardOptions
  extends Omit<
    BoardOptions,
    'fen' | 'legalMoves' | 'lastMove' | 'checkedKing' | 'disabled' | 'onMove'
  > {
  readonly fen?: string;
  readonly onMove?: (move: PlayedMove) => void;
  readonly onStatus?: (status: GameStatus) => void;
}

export interface GameBoardController {
  readonly board: BoardController;
  move(request: MoveRequest): PlayedMove;
  claimDraw(reason: DrawClaim, intendedMove?: MoveRequest): GameStatus;
  finish(outcome: ExternalOutcome, winner?: Color | null): GameStatus;
  snapshot(): GameSnapshot;
  restore(snapshot: GameSnapshot): void;
  undo(): PlayedMove | null;
  reset(fen?: string): void;
  loadPgn(pgn: string): void;
  destroy(): void;
}

/** Creates a board already connected to a local standard-chess game. */
export function createGameBoard(
  element: HTMLElement,
  options: GameBoardOptions = {},
): GameBoardController {
  const game = createGame(options.fen ? { fen: options.fen } : {});
  let board: BoardController;

  const sync = (): void => {
    const last = game.history.at(-1);
    board.update({
      ...boardState(game.position),
      lastMove: last ? [last.from, last.to] : null,
      disabled: game.status.over,
    });
    options.onStatus?.(game.status);
  };

  const move = (request: MoveRequest): PlayedMove => {
    const played = game.move(request);
    sync();
    board.announce(`${played.san}. ${game.status.over ? describeEnding(game.status) : ''}`.trim());
    options.onMove?.(played);
    return played;
  };

  board = createBoard(element, {
    ...options,
    ...boardState(game.position),
    disabled: game.status.over,
    onMove: (from, to, promotion) => move({ from, to, ...(promotion ? { promotion } : {}) }),
  });
  options.onStatus?.(game.status);

  return {
    board,
    move,
    claimDraw: (reason, intendedMove) => {
      const status = game.claimDraw(reason, intendedMove);
      sync();
      board.announce(describeEnding(status));
      return status;
    },
    finish: (outcome, winner) => {
      const status = game.finish(outcome, winner);
      sync();
      board.announce(describeEnding(status));
      return status;
    },
    snapshot: () => game.snapshot,
    restore: (snapshot) => {
      game.restore(snapshot);
      sync();
    },
    undo: () => {
      const undone = game.undo();
      sync();
      return undone;
    },
    reset: (fen) => {
      game.reset(fen);
      sync();
    },
    loadPgn: (pgn) => {
      game.loadPgn(pgn);
      sync();
    },
    destroy: () => board.destroy(),
  };
}

function describeEnding(status: GameStatus): string {
  if (status.outcome === 'checkmate') return `Checkmate. ${status.winner} wins.`;
  if (status.outcome === 'stalemate') return 'Draw by stalemate.';
  if (status.outcome === 'threefold-repetition') return 'Draw by threefold repetition.';
  if (status.outcome === 'fifty-move') return 'Draw by the fifty-move rule.';
  if (status.outcome === 'fivefold-repetition') return 'Draw by fivefold repetition.';
  if (status.outcome === 'seventy-five-move') return 'Draw by the seventy-five-move rule.';
  if (status.outcome === 'insufficient-material') return 'Draw by insufficient material.';
  if (status.outcome === 'draw-agreement') return 'Draw by agreement.';
  if (!status.winner && (status.outcome === 'resignation' || status.outcome === 'timeout')) {
    return 'Draw because the opponent has no mating material.';
  }
  if (status.outcome === 'aborted') return 'Game aborted.';
  if (status.outcome === 'declared-result') return 'Game ended by declared result.';
  if (status.outcome === 'resignation') return `${status.winner} wins by resignation.`;
  if (status.outcome === 'timeout') return `${status.winner} wins on time.`;
  if (status.outcome === 'abandonment') return `${status.winner} wins by abandonment.`;
  return '';
}

export {
  type AnalysisBoardController,
  type AnalysisBoardOptions,
  createAnalysisBoard,
} from './analysis-board.js';
export type {
  BoardAnnotationIntent,
  BoardArrow,
  BoardTheme,
  PieceTheme,
  SquareHighlight,
  ThemeOptions,
} from './dom/index.js';
export {
  createPuzzleBoard,
  type PuzzleBoardController,
  type PuzzleBoardOptions,
} from './puzzle-board.js';
export * from './rules/index.js';
