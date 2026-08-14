import {
  createAnalysisBoard,
  createGameBoard,
  createPuzzleBoard,
  type GameStatus,
  type PlayedMove,
  VariationTree,
} from '../src/index.js';

const boardElement = required<HTMLElement>('board');
const statusElement = required<HTMLElement>('status');
const moveList = required<HTMLOListElement>('moves');
const form = required<HTMLFormElement>('move-form');
const input = required<HTMLInputElement>('move');
const error = required<HTMLElement>('error');

const theme = {
  lightSquare: '#e8dcc4',
  darkSquare: '#66806a',
  selected: '#f0bf4c',
  lastMove: '#c8a94e',
  legalMove: '#22543d',
};

const gameBoard = createGameBoard(boardElement, {
  theme,
  onMove: appendMove,
  onStatus: showStatus,
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    gameBoard.move(input.value);
    error.textContent = '';
    input.value = '';
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : 'That move could not be played.';
  }
});

required<HTMLButtonElement>('undo').addEventListener('click', () => {
  if (gameBoard.undo()) moveList.lastElementChild?.remove();
});

required<HTMLButtonElement>('new-game').addEventListener('click', () => {
  gameBoard.reset();
  moveList.replaceChildren();
  error.textContent = '';
});

Object.assign(window, {
  gameBoard,
  blunderon: { createAnalysisBoard, createPuzzleBoard, VariationTree },
});

function appendMove(move: PlayedMove): void {
  const item = document.createElement('li');
  item.textContent = move.san;
  moveList.append(item);
}

function showStatus(status: GameStatus): void {
  if (status.outcome === 'checkmate') {
    statusElement.textContent = `Checkmate — ${status.winner} wins`;
  } else if (status.winner) {
    statusElement.textContent = `${capitalize(status.winner)} wins — ${status.outcome.replaceAll('-', ' ')}`;
  } else if (status.over) {
    statusElement.textContent = `Draw — ${status.outcome.replaceAll('-', ' ')}`;
  } else {
    statusElement.textContent = `${capitalize(status.turn)} to move${status.check ? ' — check' : ''}`;
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
