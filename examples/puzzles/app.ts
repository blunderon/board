import {
  createPuzzleBoard,
  Position,
  type PuzzleAttempt,
  type PuzzleBoardController,
  VariationTree,
} from '@blunderon/board';
import { initMancha } from 'mancha/browser';

interface MoveView {
  readonly id: number;
  readonly san: string;
}

interface PuzzleState {
  attempts: number;
  complete: boolean;
  feedback: string;
  moves: MoveView[];
  tone: 'neutral' | 'good' | 'bad';
  hint(): void;
  reset(): void;
}

const puzzleFen = 'r3r1k1/5ppp/8/1Q6/8/8/5PPP/4R1K1 w - - 0 1';
const solution = new VariationTree(Position.fromFen(puzzleFen));
solution.addLine(['Rxe8+', 'Rxe8', 'Qxe8#']);
solution.addLine(['Qxe8+', 'Rxe8', 'Rxe8#']);

const boardTheme = {
  lightSquare: '#f2eddf',
  darkSquare: '#66818a',
  selected: '#efad54',
  lastMove: '#d2b45d',
  legalMove: '#315a66',
};

await initMancha<PuzzleState>({
  cloak: { duration: 120 },
  state: {
    attempts: 0,
    complete: false,
    feedback: 'White to move. Find the forcing sequence.',
    moves: [],
    tone: 'neutral',
  },
  callback: async (renderer) => {
    const $ = renderer.$;
    let puzzle: PuzzleBoardController;

    // Translate the domain result into the small amount of product UI state.
    const showAttempt = (attempt: PuzzleAttempt): void => {
      if (attempt.status === 'illegal') {
        $.attempts += 1;
        $.tone = 'bad';
        $.feedback = 'That move is not legal in this position.';
        return;
      }
      if (attempt.status === 'incorrect') {
        $.attempts += 1;
        $.tone = 'bad';
        $.feedback = 'That is legal, but it misses the tactic. Try again.';
        return;
      }

      puzzle.board.update({ arrows: [] });
      const played = [attempt.move, ...attempt.replies].filter((move) => move !== null);
      $.moves = [
        ...$.moves,
        ...played.map((move, offset) => ({ id: $.moves.length + offset, san: move.san })),
      ];
      $.complete = attempt.status === 'complete';
      $.tone = 'good';
      $.feedback = $.complete ? 'Solved — checkmate.' : 'Correct. Now finish the combination.';
    };

    puzzle = createPuzzleBoard(required('board'), {
      solution,
      player: 'white',
      onAttempt: showAttempt,
      theme: boardTheme,
    });

    $.hint = () => {
      const move = puzzle.expectedMoves[0];
      if (!move) return;
      puzzle.board.update({
        arrows: [{ from: move.from, to: move.to, color: '#e28b36', label: 'One solution' }],
      });
      $.tone = 'neutral';
      $.feedback = `Look for a forcing move from ${move.from}.`;
    };
    $.reset = () => {
      puzzle.reset();
      puzzle.board.update({ arrows: [] });
      $.attempts = 0;
      $.complete = false;
      $.feedback = 'White to move. Find the forcing sequence.';
      $.moves = [];
      $.tone = 'neutral';
    };

    await renderer.mount(required('app'));
  },
});

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}
