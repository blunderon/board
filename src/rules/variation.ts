import type { BoardArrow, Color, SquareHighlight } from '../shared.js';
import { INITIAL_FEN } from './fen.js';
import type { MoveRequest } from './line.js';
import { replayLine, resolveMove, sameMove, toUci } from './line.js';
import { type PgnResult, type PgnVariation, parsePgn } from './pgn.js';
import type { Move } from './position.js';
import { Position } from './position.js';
import { toSan } from './san.js';

export interface EngineEvaluation {
  readonly type: 'centipawn' | 'mate';
  /** The side for whom a positive value is favorable. */
  readonly pov: Color;
  /** Centipawns, or signed full moves until mate when `type` is `mate`. */
  readonly value: number;
  readonly depth?: number;
  readonly bound?: 'exact' | 'lower' | 'upper';
  readonly multipv?: number;
  /** Win/draw/loss permille from `pov`, when supplied by the engine. */
  readonly wdl?: readonly [number, number, number];
}

export interface AnalysisAnnotations {
  readonly comment?: string;
  readonly nags?: readonly number[];
  readonly evaluation?: EngineEvaluation;
  readonly highlights?: readonly SquareHighlight[];
  readonly arrows?: readonly BoardArrow[];
}

export interface VariationMove extends Move {
  readonly san: string;
  readonly uci: string;
}

export interface VariationNodeSnapshot {
  readonly move?: string;
  readonly annotations: AnalysisAnnotations;
  readonly children: readonly VariationNodeSnapshot[];
}

export interface VariationTreeSnapshot {
  readonly version: 1;
  readonly startFen: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly result: PgnResult;
  readonly root: VariationNodeSnapshot;
  readonly current: readonly number[];
}

interface VariationNodeState {
  continuations: VariationNode[];
  analysis: AnalysisAnnotations;
}

const NODE_TOKEN = Symbol('VariationNode');
const NODE_STATE = new WeakMap<VariationNode, VariationNodeState>();

/** One immutable position and its mutable collection of alternative continuations. */
export class VariationNode {
  readonly position: Position;
  readonly move: VariationMove | null;
  readonly parent: VariationNode | null;

  /** Construct nodes through VariationTree so every edge is legal and belongs to one tree. */
  constructor(
    position: Position,
    move: VariationMove | null,
    parent: VariationNode | null,
    token: symbol,
  ) {
    if (token !== NODE_TOKEN)
      throw new TypeError('construct variation nodes through VariationTree');
    this.position = position;
    this.move = move;
    this.parent = parent;
    NODE_STATE.set(this, { continuations: [], analysis: Object.freeze({}) });
  }

  get children(): readonly VariationNode[] {
    return nodeState(this).continuations.slice();
  }

  get annotations(): AnalysisAnnotations {
    return nodeState(this).analysis;
  }
}

/** An editable legal-move tree for analysis, studies, and branching puzzle solutions. */
export class VariationTree {
  readonly root: VariationNode;
  private cursor: VariationNode;
  private pgnTags: Readonly<Record<string, string>> = Object.freeze({});
  private pgnResult: PgnResult = '*';
  private readonly active = new WeakSet<VariationNode>();

  constructor(start = Position.initial()) {
    this.root = new VariationNode(start, null, null, NODE_TOKEN);
    this.cursor = this.root;
    this.active.add(this.root);
  }

  static fromPgn(text: string): VariationTree {
    const parsed = parsePgn(text);
    const tree = new VariationTree(Position.fromFen(parsed.startFen));
    tree.pgnTags = Object.freeze({ ...parsed.tags });
    tree.pgnResult = parsed.result;
    if (parsed.line.comments.length > 0) {
      tree.annotate(tree.root, { comment: parsed.line.comments.join('\n\n') });
    }
    appendPgnLine(tree, tree.root, parsed.line, false);
    return tree;
  }

  static fromSnapshot(input: VariationTreeSnapshot): VariationTree {
    const snapshot = validateTreeSnapshot(input);
    const tree = new VariationTree(Position.fromFen(snapshot.startFen));
    tree.pgnTags = Object.freeze({ ...snapshot.tags });
    tree.pgnResult = snapshot.result;
    tree.annotate(tree.root, snapshot.root.annotations);
    appendSnapshotChildren(tree, tree.root, snapshot.root.children);

    let current = tree.root;
    for (const index of snapshot.current) {
      const next = current.children[index];
      if (!next) throw new TypeError('analysis snapshot current path does not exist');
      current = next;
    }
    tree.select(current);
    return tree;
  }

  get current(): VariationNode {
    return this.cursor;
  }

  get position(): Position {
    return this.cursor.position;
  }

  get tags(): Readonly<Record<string, string>> {
    return this.pgnTags;
  }

  get result(): PgnResult {
    return this.pgnResult;
  }

  get snapshot(): VariationTreeSnapshot {
    return Object.freeze({
      version: 1,
      startFen: this.root.position.fen,
      tags: Object.freeze({ ...this.tags }),
      result: this.result,
      root: snapshotNode(this.root, false),
      current: Object.freeze(pathTo(this.current)),
    });
  }

  get mainline(): readonly VariationNode[] {
    const nodes: VariationNode[] = [];
    let node = this.root.children[0];
    while (node) {
      nodes.push(node);
      node = node.children[0];
    }
    return nodes;
  }

  play(request: MoveRequest): VariationNode {
    const move = resolveMove(this.position, request);
    const existing = this.cursor.children.find(
      (candidate) => candidate.move !== null && sameMove(candidate.move, move),
    );
    if (existing) {
      this.cursor = existing;
      return existing;
    }

    const played = Object.freeze({ ...move, san: toSan(this.position, move), uci: toUci(move) });
    const node = new VariationNode(this.position.play(move), played, this.cursor, NODE_TOKEN);
    nodeState(this.cursor).continuations.push(node);
    this.active.add(node);
    this.cursor = node;
    return node;
  }

  /** Validates a complete line first, then adds or follows it without partial updates. */
  addLine(requests: readonly MoveRequest[]): readonly VariationNode[] {
    const line = replayLine(this.position, requests);
    const start = this.cursor;
    const nodes = line.moves.map((move) => this.play(move));
    this.cursor = start;
    return nodes;
  }

  /** Adds a space-delimited engine principal variation at the current node. */
  addUci(principalVariation: string): readonly VariationNode[] {
    const requests = principalVariation.trim() === '' ? [] : principalVariation.trim().split(/\s+/);
    return this.addLine(requests);
  }

  select(node: VariationNode): VariationNode {
    if (!this.active.has(node)) throw new TypeError('variation node does not belong to this tree');
    this.cursor = node;
    return node;
  }

  back(): VariationNode {
    if (this.cursor.parent) this.cursor = this.cursor.parent;
    return this.cursor;
  }

  forward(index = 0): VariationNode {
    const next = this.cursor.children[index];
    if (next) this.cursor = next;
    return this.cursor;
  }

  promote(node: VariationNode): boolean {
    if (!this.active.has(node) || !node.parent) return false;
    const siblings = nodeState(node.parent).continuations;
    const index = siblings.indexOf(node);
    if (index < 0) return false;
    siblings.splice(index, 1);
    siblings.unshift(node);
    return true;
  }

  remove(node: VariationNode): boolean {
    if (!this.active.has(node) || !node.parent) return false;
    if (isDescendantOf(this.cursor, node)) this.cursor = node.parent;
    const siblings = nodeState(node.parent).continuations;
    const index = siblings.indexOf(node);
    if (index < 0) return false;
    siblings.splice(index, 1);
    deactivate(node, this.active);
    return true;
  }

  annotate(node: VariationNode, update: AnalysisAnnotations): void {
    if (!this.active.has(node)) throw new TypeError('variation node does not belong to this tree');
    const state = nodeState(node);
    state.analysis = validateAnnotations({ ...state.analysis, ...update });
  }

  /** Serializes the complete move tree, retaining comments, NAGs, and recursive variations. */
  toPgn(
    tags: Readonly<Record<string, string>> = this.tags,
    result: PgnResult = this.result,
  ): string {
    const allTags = { ...tags };
    if (this.root.position.fen !== INITIAL_FEN) {
      allTags.SetUp = '1';
      allTags.FEN = this.root.position.fen;
    }
    if (allTags.Result !== undefined) allTags.Result = result;

    const tagLines = Object.entries(allTags).map(
      ([name, value]) => `[${name} "${escapeTagValue(value)}"]`,
    );
    const tokens: string[] = [];
    if (this.root.annotations.comment) tokens.push(formatComment(this.root.annotations.comment));
    const first = this.root.children[0];
    if (first) tokens.push(formatNode(first, true));
    tokens.push(result);
    const body = tokens.join(' ');
    return tagLines.length > 0 ? `${tagLines.join('\n')}\n\n${body}` : body;
  }
}

function nodeState(node: VariationNode): VariationNodeState {
  const state = NODE_STATE.get(node);
  if (!state) throw new TypeError('invalid variation node');
  return state;
}

function isDescendantOf(node: VariationNode, ancestor: VariationNode): boolean {
  let candidate: VariationNode | null = node;
  while (candidate) {
    if (candidate === ancestor) return true;
    candidate = candidate.parent;
  }
  return false;
}

function deactivate(node: VariationNode, active: WeakSet<VariationNode>): void {
  active.delete(node);
  for (const child of node.children) deactivate(child, active);
}

function appendPgnLine(
  tree: VariationTree,
  parent: VariationNode,
  line: PgnVariation,
  includeLineComments = true,
): void {
  let previous = parent;
  const nodes: VariationNode[] = [];
  const parents: VariationNode[] = [];

  for (const [index, source] of line.moves.entries()) {
    parents.push(previous);
    tree.select(previous);
    const node = tree.play(source.move);
    tree.annotate(
      node,
      mergeImportedAnnotations(
        node.annotations,
        [...(includeLineComments && index === 0 ? line.comments : []), ...source.comments],
        source.nags,
      ),
    );
    nodes.push(node);
    previous = node;
  }

  for (const [index, source] of line.moves.entries()) {
    const branchParent = parents[index];
    if (!branchParent) continue;
    for (const variation of source.variations) appendPgnLine(tree, branchParent, variation);
  }

  tree.select(previous);
}

function formatNode(node: VariationNode, includeSiblings: boolean): string {
  const parent = node.parent;
  if (!parent || !node.move) return '';

  const before = parent.position;
  const number = `${before.fullmoveNumber}.${before.turn === 'black' ? '..' : ''}`;
  const tokens = [number, node.move.san];
  for (const nag of node.annotations.nags ?? []) tokens.push(`$${nag}`);
  const comment = formatAnnotations(node.annotations);
  if (comment) tokens.push(formatComment(comment));

  if (includeSiblings) {
    for (const sibling of parent.children) {
      if (sibling !== node) tokens.push(`(${formatNode(sibling, false)})`);
    }
  }

  const continuation = node.children[0];
  if (continuation) tokens.push(formatNode(continuation, true));
  return tokens.join(' ');
}

function mergeImportedAnnotations(
  current: AnalysisAnnotations,
  comments: readonly string[],
  nags: readonly number[],
): AnalysisAnnotations {
  const parsed = parseCommentAnnotations(comments);
  const comment = [current.comment, parsed.comment].filter(Boolean).join('\n\n');
  const mergedNags = [...new Set([...(current.nags ?? []), ...nags])];
  return {
    ...(comment ? { comment } : {}),
    ...(mergedNags.length > 0 ? { nags: mergedNags } : {}),
    ...(parsed.evaluation
      ? { evaluation: parsed.evaluation }
      : current.evaluation
        ? { evaluation: current.evaluation }
        : {}),
  };
}

function parseCommentAnnotations(comments: readonly string[]): AnalysisAnnotations {
  let evaluation: EngineEvaluation | undefined;
  const remaining: string[] = [];

  for (const source of comments) {
    const evalMatch = /\[%eval\s+(#)?([+-]?\d+(?:\.\d+)?)(?:,(\d+))?\]/.exec(source);
    const depthMatch = /\[%depth\s+(\d+)\]/.exec(source);
    if (evalMatch) {
      const mate = evalMatch[1] === '#';
      evaluation = {
        type: mate ? 'mate' : 'centipawn',
        value: mate ? Number(evalMatch[2]) : Math.round(Number(evalMatch[2]) * 100),
        pov: 'white',
        ...(evalMatch[3] || depthMatch?.[1]
          ? { depth: Number(evalMatch[3] ?? depthMatch?.[1]) }
          : {}),
      };
    }
    let text = source;
    if (evalMatch) text = text.replace(evalMatch[0], '');
    if (evalMatch && depthMatch) text = text.replace(depthMatch[0], '');
    text = text.trim();
    if (text) remaining.push(text);
  }

  return {
    ...(remaining.length > 0 ? { comment: remaining.join('\n\n') } : {}),
    ...(evaluation ? { evaluation } : {}),
  };
}

function formatAnnotations(annotations: AnalysisAnnotations): string {
  const parts = annotations.comment ? [annotations.comment] : [];
  const evaluation = annotations.evaluation;
  if (evaluation) {
    const sign = evaluation.pov === 'white' ? 1 : -1;
    const value =
      evaluation.type === 'mate'
        ? `#${evaluation.value * sign}`
        : ((evaluation.value * sign) / 100).toFixed(2);
    parts.push(`[%eval ${value}${evaluation.depth === undefined ? '' : `,${evaluation.depth}`}]`);
  }
  return parts.join(' ');
}

function freezeAnnotations(annotations: AnalysisAnnotations): AnalysisAnnotations {
  return Object.freeze({
    ...annotations,
    ...(annotations.nags ? { nags: Object.freeze([...annotations.nags]) } : {}),
    ...(annotations.evaluation
      ? {
          evaluation: Object.freeze({
            ...annotations.evaluation,
            ...(annotations.evaluation.wdl
              ? {
                  wdl: Object.freeze([...annotations.evaluation.wdl]) as readonly [
                    number,
                    number,
                    number,
                  ],
                }
              : {}),
          }),
        }
      : {}),
    ...(annotations.highlights
      ? {
          highlights: Object.freeze(
            annotations.highlights.map((mark) => Object.freeze({ ...mark })),
          ),
        }
      : {}),
    ...(annotations.arrows
      ? { arrows: Object.freeze(annotations.arrows.map((arrow) => Object.freeze({ ...arrow }))) }
      : {}),
  });
}

function snapshotNode(node: VariationNode, includeMove = true): VariationNodeSnapshot {
  return Object.freeze({
    ...(includeMove && node.move ? { move: node.move.uci } : {}),
    annotations: freezeAnnotations(node.annotations),
    children: Object.freeze(node.children.map((child) => snapshotNode(child))),
  });
}

function pathTo(node: VariationNode): number[] {
  const path: number[] = [];
  let current = node;
  while (current.parent) {
    path.unshift(current.parent.children.indexOf(current));
    current = current.parent;
  }
  return path;
}

function appendSnapshotChildren(
  tree: VariationTree,
  parent: VariationNode,
  children: readonly VariationNodeSnapshot[],
): void {
  for (const source of children) {
    if (!source.move) throw new TypeError('analysis snapshot child is missing its move');
    tree.select(parent);
    const node = tree.play(source.move);
    tree.annotate(node, source.annotations);
    appendSnapshotChildren(tree, node, source.children);
  }
}

function validateTreeSnapshot(input: unknown): VariationTreeSnapshot {
  if (!input || typeof input !== 'object')
    throw new TypeError('analysis snapshot must be an object');
  const snapshot = input as Record<string, unknown>;
  if (snapshot.version !== 1 || typeof snapshot.startFen !== 'string') {
    throw new TypeError('unsupported analysis snapshot');
  }
  if (!snapshot.tags || typeof snapshot.tags !== 'object' || Array.isArray(snapshot.tags)) {
    throw new TypeError('analysis snapshot tags must be an object');
  }
  const tags = Object.fromEntries(
    Object.entries(snapshot.tags).map(([name, value]) => {
      if (typeof value !== 'string')
        throw new TypeError('analysis snapshot tag values must be strings');
      return [name, value];
    }),
  );
  if (!['1-0', '0-1', '1/2-1/2', '*'].includes(snapshot.result as string)) {
    throw new TypeError('analysis snapshot has an invalid result');
  }
  const root = validateSnapshotNode(snapshot.root, false);
  if (!Array.isArray(snapshot.current) || !snapshot.current.every(Number.isSafeInteger)) {
    throw new TypeError('analysis snapshot current path must contain integer indexes');
  }
  return {
    version: 1,
    startFen: snapshot.startFen,
    tags,
    result: snapshot.result as PgnResult,
    root,
    current: snapshot.current as number[],
  };
}

function validateSnapshotNode(input: unknown, requireMove: boolean): VariationNodeSnapshot {
  if (!input || typeof input !== 'object')
    throw new TypeError('analysis snapshot node must be an object');
  const node = input as Record<string, unknown>;
  if (
    requireMove &&
    (typeof node.move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(node.move))
  ) {
    throw new TypeError('analysis snapshot node has an invalid move');
  }
  if (!requireMove && node.move !== undefined) {
    throw new TypeError('analysis snapshot root cannot have a move');
  }
  if (!Array.isArray(node.children))
    throw new TypeError('analysis snapshot node children must be an array');
  const children = node.children.map((child) => validateSnapshotNode(child, true));
  const moves = children.map((child) => child.move as string);
  if (new Set(moves).size !== moves.length) {
    throw new TypeError('analysis snapshot node has duplicate moves');
  }
  return {
    ...(typeof node.move === 'string' ? { move: node.move } : {}),
    annotations: validateAnnotations(node.annotations),
    children,
  };
}

function validateAnnotations(input: unknown): AnalysisAnnotations {
  if (!input || typeof input !== 'object')
    throw new TypeError('analysis annotations must be an object');
  const annotations = input as Record<string, unknown>;
  if (annotations.comment !== undefined && typeof annotations.comment !== 'string') {
    throw new TypeError('analysis comment must be a string');
  }
  if (
    annotations.nags !== undefined &&
    (!Array.isArray(annotations.nags) ||
      !annotations.nags.every((nag) => Number.isSafeInteger(nag) && nag >= 0))
  ) {
    throw new TypeError('analysis NAGs must be non-negative integers');
  }
  const evaluation =
    annotations.evaluation === undefined ? undefined : validateEvaluation(annotations.evaluation);
  const highlights = validateHighlights(annotations.highlights);
  const arrows = validateArrows(annotations.arrows);
  return freezeAnnotations({
    ...(annotations.comment ? { comment: annotations.comment } : {}),
    ...(annotations.nags ? { nags: annotations.nags as number[] } : {}),
    ...(evaluation ? { evaluation } : {}),
    ...(highlights ? { highlights } : {}),
    ...(arrows ? { arrows } : {}),
  });
}

function validateHighlights(input: unknown): readonly SquareHighlight[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new TypeError('analysis highlights must be an array');
  return input.map((value) => {
    if (!value || typeof value !== 'object')
      throw new TypeError('analysis highlight must be an object');
    const mark = value as Record<string, unknown>;
    if (typeof mark.square !== 'string' || !/^[a-h][1-8]$/.test(mark.square)) {
      throw new TypeError('analysis highlight has an invalid square');
    }
    if (mark.color !== undefined && typeof mark.color !== 'string')
      throw new TypeError('analysis highlight color must be a string');
    if (mark.label !== undefined && typeof mark.label !== 'string')
      throw new TypeError('analysis highlight label must be a string');
    return mark as unknown as SquareHighlight;
  });
}

function validateArrows(input: unknown): readonly BoardArrow[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new TypeError('analysis arrows must be an array');
  return input.map((value) => {
    if (!value || typeof value !== 'object')
      throw new TypeError('analysis arrow must be an object');
    const arrow = value as Record<string, unknown>;
    if (
      typeof arrow.from !== 'string' ||
      !/^[a-h][1-8]$/.test(arrow.from) ||
      typeof arrow.to !== 'string' ||
      !/^[a-h][1-8]$/.test(arrow.to)
    ) {
      throw new TypeError('analysis arrow has an invalid square');
    }
    if (arrow.color !== undefined && typeof arrow.color !== 'string')
      throw new TypeError('analysis arrow color must be a string');
    if (arrow.label !== undefined && typeof arrow.label !== 'string')
      throw new TypeError('analysis arrow label must be a string');
    return arrow as unknown as BoardArrow;
  });
}

function validateEvaluation(input: unknown): EngineEvaluation {
  if (!input || typeof input !== 'object')
    throw new TypeError('engine evaluation must be an object');
  const evaluation = input as Record<string, unknown>;
  if (
    (evaluation.type !== 'centipawn' && evaluation.type !== 'mate') ||
    (evaluation.pov !== 'white' && evaluation.pov !== 'black') ||
    typeof evaluation.value !== 'number' ||
    !Number.isFinite(evaluation.value) ||
    (evaluation.type === 'mate' && !Number.isSafeInteger(evaluation.value))
  ) {
    throw new TypeError('engine evaluation has invalid score data');
  }
  if (
    evaluation.depth !== undefined &&
    (!Number.isSafeInteger(evaluation.depth) || (evaluation.depth as number) < 0)
  ) {
    throw new TypeError('engine evaluation depth must be a non-negative integer');
  }
  if (
    evaluation.bound !== undefined &&
    !['exact', 'lower', 'upper'].includes(evaluation.bound as string)
  ) {
    throw new TypeError('engine evaluation has an invalid bound');
  }
  if (
    evaluation.multipv !== undefined &&
    (!Number.isSafeInteger(evaluation.multipv) || (evaluation.multipv as number) < 1)
  ) {
    throw new TypeError('engine evaluation multipv must be a positive integer');
  }
  if (
    evaluation.wdl !== undefined &&
    (!Array.isArray(evaluation.wdl) ||
      evaluation.wdl.length !== 3 ||
      !evaluation.wdl.every((value) => Number.isSafeInteger(value) && value >= 0) ||
      evaluation.wdl.reduce((total, value) => total + value, 0) !== 1000)
  ) {
    throw new TypeError('engine evaluation WDL must contain three permille values');
  }
  return evaluation as unknown as EngineEvaluation;
}

function formatComment(comment: string): string {
  return `{${comment.replaceAll('}', ']')}}`;
}

function escapeTagValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
