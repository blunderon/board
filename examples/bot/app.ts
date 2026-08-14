import {
  createGame,
  createGameBoard,
  type GameBoardController,
  type GameSnapshot,
  type GameStatus,
  type Move,
  type MoveRequest,
  type PlayedMove,
  type Position,
  toUci,
} from '@blunderon/board';
import { initMancha } from 'mancha/browser';

interface MoveView {
  readonly id: number;
  readonly number: number;
  readonly san: string;
  readonly side: 'white' | 'black';
}

interface BotState {
  error: string;
  moves: MoveView[];
  status: string;
  thinking: boolean;
  newGame(): void;
}

const boardTheme = {
  lightSquare: '#e6dac4',
  darkSquare: '#8b654f',
  selected: '#e6aa48',
  lastMove: '#c59f53',
  legalMove: '#6d4639',
};

await initMancha<BotState>({
  cloak: { duration: 120 },
  state: {
    error: '',
    moves: [],
    status: 'Your move',
    thinking: false,
  },
  callback: async (renderer) => {
    const $ = renderer.$;
    let controller: GameBoardController;
    let pendingReply: number | null = null;
    let gameNumber = 0;

    // Turn the controller snapshot into a request for an external opponent.
    const requestReply = (snapshot: GameSnapshot): void => {
      $.thinking = true;
      $.status = 'Bot is thinking…';
      controller.board.update({ disabled: true });
      const currentGame = gameNumber;

      pendingReply = window.setTimeout(() => {
        if (currentGame !== gameNumber) return;

        try {
          controller.move(chooseBotMove(snapshot));
          $.error = '';
        } catch (cause) {
          $.thinking = false;
          $.error = 'The bot could not choose a move. Start a new game to retry.';
          console.error('bot move failed', { cause, snapshot });
        }
      }, 360);
    };

    // React to moves from either the player or the bot through one legal path.
    const recordMove = (move: PlayedMove): void => {
      const id = $.moves.length;
      $.moves = [
        ...$.moves,
        {
          id,
          number: Math.floor(id / 2) + 1,
          san: move.san,
          side: id % 2 === 0 ? 'white' : 'black',
        },
      ];

      const game = createGame({ snapshot: controller.snapshot() });
      if (!game.status.over && game.turn === 'black') {
        requestReply(game.snapshot);
      } else {
        pendingReply = null;
        $.thinking = false;
        $.status = describeStatus(game.status, false);
      }
    };

    controller = createGameBoard(required('board'), {
      onMove: recordMove,
      onStatus: (status) => {
        $.status = describeStatus(status, $.thinking);
      },
      theme: boardTheme,
    });

    $.newGame = () => {
      gameNumber += 1;
      if (pendingReply !== null) window.clearTimeout(pendingReply);
      pendingReply = null;
      $.moves = [];
      $.thinking = false;
      $.error = '';
      controller.reset();
      controller.board.update({ disabled: false });
    };

    await renderer.mount(required('app'));
  },
});

function chooseBotMove(snapshot: GameSnapshot): MoveRequest {
  const game = createGame({ snapshot });
  const move = [...game.legalMoves()].sort((left, right) => {
    const difference = moveScore(game.position, right) - moveScore(game.position, left);
    return difference || toUci(left).localeCompare(toUci(right));
  })[0];
  if (!move) throw new Error('cannot choose a move in a terminal position');
  return move;
}

function moveScore(position: Position, move: Move): number {
  const captured = position.pieceAt(move.to);
  const captureValue = captured ? pieceValue[captured.type] : 0;
  const center = ['c5', 'd5', 'e5', 'f5'].includes(move.to) ? 2 : 0;
  return captureValue * 10 + Number(move.castle) * 4 + center;
}

const pieceValue = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
} as const;

function describeStatus(status: GameStatus, thinking: boolean): string {
  if (status.outcome === 'checkmate') return status.winner === 'white' ? 'You won!' : 'The bot won';
  if (status.over) return 'Game drawn';
  if (thinking || status.turn === 'black') return 'Bot is thinking…';
  return status.check ? 'Your move — check' : 'Your move';
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}
