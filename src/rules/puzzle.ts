import type { Color } from '../shared.js';
import type { MoveRequest } from './line.js';
import { resolveMove, sameMove, toUci } from './line.js';
import { IllegalMoveError, type Move, type Position } from './position.js';
import { toSan } from './san.js';
import {
  type VariationMove,
  type VariationNode,
  VariationTree,
  type VariationTreeSnapshot,
} from './variation.js';

export type PuzzleAttemptStatus = 'illegal' | 'incorrect' | 'accepted' | 'complete';

export interface PuzzleSessionOptions {
  readonly player?: Color;
  readonly autoReply?: boolean;
}

export interface PuzzleAttempt {
  readonly status: PuzzleAttemptStatus;
  readonly move: VariationMove | null;
  readonly replies: readonly VariationMove[];
  readonly position: Position;
}

export interface PuzzleSessionSnapshot {
  readonly version: 1;
  readonly solution: VariationTreeSnapshot;
  readonly player: Color;
  readonly autoReply: boolean;
}

/** A non-mutating cursor over an authored solution tree. */
export class PuzzleSession {
  readonly player: Color;
  readonly autoReply: boolean;
  private readonly solution: VariationTree;
  private readonly initial: VariationNode;
  private cursor: VariationNode;

  constructor(solution: VariationTree, options: PuzzleSessionOptions = {}) {
    this.solution = VariationTree.fromSnapshot(solution.snapshot);
    this.player = options.player ?? solution.root.position.turn;
    this.autoReply = options.autoReply ?? true;
    this.cursor = this.solution.root;
    this.solution.select(this.cursor);
    if (this.autoReply) this.applyMainReply();
    this.initial = this.cursor;
  }

  static fromSnapshot(input: PuzzleSessionSnapshot): PuzzleSession {
    const snapshot = validateSnapshot(input);
    const solution = VariationTree.fromSnapshot(snapshot.solution);
    const session = new PuzzleSession(solution, {
      player: snapshot.player,
      autoReply: snapshot.autoReply,
    });
    session.select(nodeAt(session.solution.root, snapshot.solution.current));
    if (session.autoReply && !session.complete && session.position.turn !== session.player) {
      throw new TypeError('puzzle snapshot is waiting for an automatic reply');
    }
    return session;
  }

  get current(): VariationNode {
    return this.cursor;
  }

  get position(): Position {
    return this.cursor.position;
  }

  get complete(): boolean {
    return this.cursor.children.length === 0;
  }

  get expectedMoves(): readonly VariationMove[] {
    return this.cursor.children.flatMap((node) => (node.move ? [node.move] : []));
  }

  get snapshot(): PuzzleSessionSnapshot {
    return Object.freeze({
      version: 1,
      solution: this.solution.snapshot,
      player: this.player,
      autoReply: this.autoReply,
    });
  }

  attempt(request: MoveRequest): PuzzleAttempt {
    if (this.position.turn !== this.player || this.complete) {
      return this.result(this.complete ? 'complete' : 'incorrect', null, []);
    }

    let move: Move;
    try {
      move = resolveMove(this.position, request);
    } catch (error) {
      if (error instanceof IllegalMoveError) return this.result('illegal', null, []);
      throw error;
    }

    const accepted = this.cursor.children.find(
      (node) => node.move !== null && sameMove(node.move, move),
    );
    if (!accepted) return this.result('incorrect', describeMove(this.position, move), []);

    this.select(accepted);
    const played = accepted.move;
    const replies = this.autoReply ? this.applyMainReply() : [];
    return this.result(this.complete ? 'complete' : 'accepted', played, replies);
  }

  /** Applies one authored opponent reply, allowing a product to choose among alternatives. */
  reply(index = 0): PuzzleAttempt {
    if (this.position.turn === this.player || this.complete) {
      return this.result(this.complete ? 'complete' : 'incorrect', null, []);
    }

    const next = this.cursor.children[index];
    if (!next?.move) return this.result('incorrect', null, []);
    this.select(next);
    return this.result(this.complete ? 'complete' : 'accepted', next.move, []);
  }

  reset(): void {
    this.select(this.initial);
  }

  private applyMainReply(): VariationMove[] {
    if (this.position.turn === this.player || this.complete) return [];
    const reply = this.cursor.children[0];
    if (!reply?.move) return [];
    this.select(reply);
    return [reply.move];
  }

  private select(node: VariationNode): void {
    this.solution.select(node);
    this.cursor = node;
  }

  private result(
    status: PuzzleAttemptStatus,
    move: VariationMove | null,
    replies: readonly VariationMove[],
  ): PuzzleAttempt {
    return Object.freeze({
      status,
      move,
      replies: Object.freeze([...replies]),
      position: this.position,
    });
  }
}

function describeMove(position: Position, move: Move): VariationMove {
  return Object.freeze({ ...move, san: toSan(position, move), uci: toUci(move) });
}

function nodeAt(root: VariationNode, path: readonly number[]): VariationNode {
  let node = root;
  for (const index of path) {
    const next = node.children[index];
    if (!next) throw new TypeError('puzzle snapshot current path does not exist');
    node = next;
  }
  return node;
}

function validateSnapshot(input: unknown): PuzzleSessionSnapshot {
  if (!input || typeof input !== 'object') throw new TypeError('puzzle snapshot must be an object');
  const snapshot = input as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    (snapshot.player !== 'white' && snapshot.player !== 'black') ||
    typeof snapshot.autoReply !== 'boolean'
  ) {
    throw new TypeError('unsupported puzzle snapshot');
  }
  return {
    version: 1,
    solution: snapshot.solution as VariationTreeSnapshot,
    player: snapshot.player,
    autoReply: snapshot.autoReply,
  };
}
