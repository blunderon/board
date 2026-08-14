import {
  type AnalysisBoardController,
  createAnalysisBoard,
  type Move,
  type Position,
  toUci,
  type VariationNode,
  VariationTree,
} from '@blunderon/board';
import { initMancha } from 'mancha/browser';

interface MoveView {
  readonly id: number;
  readonly san: string;
}

interface VariationView {
  readonly id: number;
  readonly san: string;
}

interface AnalysisState {
  analyzing: boolean;
  canBack: boolean;
  canForward: boolean;
  error: string;
  evaluation: string;
  moveInput: string;
  moves: MoveView[];
  status: string;
  variations: VariationView[];
  addEngineLine(): Promise<void>;
  back(): void;
  forward(index?: number): void;
  playMove(): void;
  reset(): void;
}

const pgn = `[Event "Instructional analysis"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 *`;
const initialTree = VariationTree.fromPgn(pgn);
const initialSnapshot = initialTree.snapshot;
const boardTheme = {
  lightSquare: '#f1e8d5',
  darkSquare: '#6f8070',
  selected: '#e4aa46',
  lastMove: '#d6bb67',
  legalMove: '#345b48',
};

await initMancha<AnalysisState>({
  cloak: { duration: 120 },
  state: {
    analyzing: false,
    canBack: false,
    canForward: true,
    error: '',
    evaluation: 'Not evaluated',
    moveInput: '',
    moves: [],
    status: 'Starting position',
    variations: [],
  },
  callback: async (renderer) => {
    const $ = renderer.$;
    let analysis: AnalysisBoardController;

    // Keep the surrounding interface derived from the controller's current node.
    const sync = (): void => {
      const path = pathTo(analysis.current);
      $.moves = path.map((node, index) => ({ id: index, san: node.move?.san ?? '' }));
      $.variations = analysis.current.children.map((node, index) => ({
        id: index,
        san: node.move?.san ?? '',
      }));
      $.canBack = analysis.current.parent !== null;
      $.canForward = analysis.current.children.length > 0;
      $.evaluation = describeEvaluation(analysis.current);
      $.status = analysis.current.move ? `After ${analysis.current.move.san}` : 'Starting position';
    };

    // Wire the high-level analysis controller to the board and the reactive chrome.
    analysis = createAnalysisBoard(required('board'), {
      tree: initialTree,
      onChange: sync,
      theme: boardTheme,
    });

    $.back = () => analysis.back();
    $.forward = (index = 0) => analysis.forward(index);
    $.playMove = () => {
      try {
        analysis.play($.moveInput);
        $.moveInput = '';
        $.error = '';
      } catch (cause) {
        $.error = cause instanceof Error ? cause.message : 'That move could not be played.';
      }
    };
    $.reset = () => {
      analysis.restore(initialSnapshot);
      $.error = '';
    };
    $.addEngineLine = async () => {
      $.analyzing = true;
      $.error = '';

      // Replace this deterministic adapter with a UCI engine or analysis API.
      await delay(280);
      const principalVariation = buildSamplePrincipalVariation(analysis.position);
      const nodes = analysis.addUci(principalVariation);
      const best = nodes[0]?.move;
      analysis.annotate({
        comment: 'Sample engine line. Production apps can persist this node as PGN or JSON.',
        evaluation: { type: 'centipawn', value: 34, pov: 'white', depth: 12 },
        arrows: best
          ? [{ from: best.from, to: best.to, color: '#dc8f2b', label: 'Sample engine choice' }]
          : [],
      });
      $.analyzing = false;
    };

    await renderer.mount(required('app'));
    sync();
  },
});

function pathTo(node: VariationNode): VariationNode[] {
  const path: VariationNode[] = [];
  let current: VariationNode | null = node;
  while (current?.move) {
    path.unshift(current);
    current = current.parent;
  }
  return path;
}

function describeEvaluation(node: VariationNode): string {
  const evaluation = node.annotations.evaluation;
  if (!evaluation) return 'Not evaluated';
  if (evaluation.type === 'mate') return `Mate in ${evaluation.value}`;
  return `${evaluation.value >= 0 ? '+' : ''}${(evaluation.value / 100).toFixed(2)}`;
}

function buildSamplePrincipalVariation(start: Position): string {
  const moves: string[] = [];
  let position = start;

  for (let ply = 0; ply < 3; ply += 1) {
    const move = chooseMove(position.legalMoves());
    if (!move) break;
    moves.push(toUci(move));
    position = position.play(move);
  }
  return moves.join(' ');
}

function chooseMove(moves: readonly Move[]): Move | undefined {
  return [...moves].sort((left, right) => {
    const difference = moveScore(right) - moveScore(left);
    return difference || toUci(left).localeCompare(toUci(right));
  })[0];
}

function moveScore(move: Move): number {
  const center = ['d4', 'd5', 'e4', 'e5'].includes(move.to) ? 2 : 0;
  return Number(move.capture) * 8 + Number(move.castle) * 3 + center;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
