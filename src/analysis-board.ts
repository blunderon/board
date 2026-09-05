import { boardState } from './board-state.js';
import {
  type BoardAnnotationIntent,
  type BoardController,
  type BoardOptions,
  createBoard,
} from './dom/index.js';
import {
  type AnalysisAnnotations,
  type MoveRequest,
  type PgnResult,
  Position,
  type VariationNode,
  VariationTree,
  type VariationTreeSnapshot,
} from './rules/index.js';

export interface AnalysisBoardOptions
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
    | 'onAnnotate'
  > {
  readonly tree?: VariationTree;
  readonly fen?: string;
  readonly onChange?: (node: VariationNode) => void;
}

export interface AnalysisBoardController {
  readonly board: BoardController;
  readonly root: VariationNode;
  readonly current: VariationNode;
  readonly position: Position;
  readonly tags: Readonly<Record<string, string>>;
  readonly result: PgnResult;
  play(request: MoveRequest): VariationNode;
  select(node: VariationNode): VariationNode;
  back(): VariationNode;
  forward(index?: number): VariationNode;
  promote(node: VariationNode): boolean;
  remove(node: VariationNode): boolean;
  addUci(principalVariation: string): readonly VariationNode[];
  annotate(update: AnalysisAnnotations, node?: VariationNode): void;
  toPgn(tags?: Readonly<Record<string, string>>, result?: PgnResult): string;
  snapshot(): VariationTreeSnapshot;
  restore(snapshot: VariationTreeSnapshot): void;
  destroy(): void;
}

/** Creates a board connected to an editable legal variation tree. */
export function createAnalysisBoard(
  element: HTMLElement,
  options: AnalysisBoardOptions = {},
): AnalysisBoardController {
  const { tree: initialTree, fen, onChange, ...boardOptions } = options;
  if (initialTree && fen) throw new TypeError('tree and fen cannot be combined');
  let tree = initialTree
    ? VariationTree.fromSnapshot(initialTree.snapshot)
    : new VariationTree(fen ? Position.fromFen(fen) : undefined);
  let board: BoardController;

  const sync = (): VariationNode => {
    const node = tree.current;
    board.update({
      ...boardState(node.position),
      lastMove: node.move ? [node.move.from, node.move.to] : null,
      highlights: node.annotations.highlights ?? [],
      arrows: node.annotations.arrows ?? [],
    });
    onChange?.(node);
    return node;
  };

  const play = (request: MoveRequest): VariationNode => {
    const node = tree.play(request);
    sync();
    board.announce(node.move?.san ?? '');
    return node;
  };

  const annotateFromBoard = (intent: BoardAnnotationIntent): void => {
    const annotations = tree.current.annotations;
    if (intent.type === 'clear') {
      tree.annotate(tree.current, { arrows: [], highlights: [] });
      sync();
      return;
    }
    if (intent.type === 'highlight') {
      const highlights = toggle(
        annotations.highlights ?? [],
        (mark) => mark.square === intent.square,
        { square: intent.square },
      );
      tree.annotate(tree.current, { highlights });
    } else {
      const arrows = toggle(
        annotations.arrows ?? [],
        (arrow) => arrow.from === intent.from && arrow.to === intent.to,
        { from: intent.from, to: intent.to },
      );
      tree.annotate(tree.current, { arrows });
    }
    sync();
  };

  board = createBoard(element, {
    ...boardOptions,
    ...boardState(tree.position),
    highlights: tree.current.annotations.highlights ?? [],
    arrows: tree.current.annotations.arrows ?? [],
    onMove: (from, to, promotion) => play({ from, to, ...(promotion ? { promotion } : {}) }),
    onAnnotate: annotateFromBoard,
  });

  return {
    board,
    get root() {
      return tree.root;
    },
    get current() {
      return tree.current;
    },
    get position() {
      return tree.position;
    },
    get tags() {
      return tree.tags;
    },
    get result() {
      return tree.result;
    },
    play,
    select: (node) => {
      tree.select(node);
      return sync();
    },
    back: () => {
      tree.back();
      return sync();
    },
    forward: (index) => {
      tree.forward(index);
      return sync();
    },
    promote: (node) => {
      const changed = tree.promote(node);
      if (changed) sync();
      return changed;
    },
    remove: (node) => {
      const changed = tree.remove(node);
      if (changed) sync();
      return changed;
    },
    addUci: (principalVariation) => {
      const nodes = tree.addUci(principalVariation);
      sync();
      return nodes;
    },
    annotate: (update, node = tree.current) => {
      tree.annotate(node, update);
      sync();
    },
    toPgn: (tags, result) => tree.toPgn(tags, result),
    snapshot: () => tree.snapshot,
    restore: (snapshot) => {
      tree = VariationTree.fromSnapshot(snapshot);
      sync();
    },
    destroy: () => board.destroy(),
  };
}

function toggle<T>(values: readonly T[], matches: (value: T) => boolean, next: T): T[] {
  return values.some(matches) ? values.filter((value) => !matches(value)) : [...values, next];
}
