/**
 * PGN parsing. Reads one game: tag pairs, movetext, and the termination marker.
 *
 * Move rules are never reimplemented here. Every SAN token is resolved by filtering
 * `Position.legalMoves()`, so a token that names no legal move, or more than one, is a
 * PgnError rather than a guess. That also means the parser inherits castling, en passant
 * and promotion legality from the one implementation covered by perft tests.
 *
 * Deliberate choices, all of them so malformed input fails loudly:
 * - Recursive variations, comments, and numeric annotation glyphs are retained in a
 *   structured move tree while the flat mainline remains available for simple consumers.
 * - Move numbers are accepted and ignored; the move sequence is defined by the SAN tokens.
 *   A wrong number is not an error, because no position depends on it.
 * - Check and mate suffixes (+ #) are accepted but not verified against the position:
 *   real-world PGN routinely omits or misplaces them, and the move itself is already
 *   pinned by legality.
 * - Exactly one game per input. Anything after the termination marker is an error, so a
 *   multi-game file cannot be silently read as its first game.
 * - A `FEN` tag sets the starting position. A malformed one is reported as a PgnError, so
 *   callers of this module have a single error type to catch.
 */
import { FenError } from './fen.js';
import { IllegalMoveError, type Move, Position, pieceTypeFromChar } from './position.js';

/** Thrown for any input that is not a well-formed PGN. */
export class PgnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PgnError';
  }
}

/** The game termination marker. `*` means unfinished or unknown. */
export type PgnResult = '1-0' | '0-1' | '1/2-1/2' | '*';

const RESULTS: readonly string[] = ['1-0', '0-1', '1/2-1/2', '*'];
const SYMBOLIC_NAGS: Readonly<Record<string, number>> = {
  '!': 1,
  '?': 2,
  '!!': 3,
  '??': 4,
  '!?': 5,
  '?!': 6,
};

/** One parsed game: its tags, its mainline, and where it ended up. */
export interface PgnGame {
  readonly tags: Readonly<Record<string, string>>;
  /** The mainline in the coordinate form the rest of the app exchanges. */
  readonly moves: readonly Move[];
  /** The mainline as written, one SAN token per move. */
  readonly san: readonly string[];
  readonly result: PgnResult;
  readonly startFen: string;
  readonly finalFen: string;
  /** The complete annotated movetext, including recursive alternative lines. */
  readonly line: PgnVariation;
}

export interface PgnVariation {
  readonly comments: readonly string[];
  readonly moves: readonly PgnMove[];
}

export interface PgnMove {
  readonly move: Move;
  readonly san: string;
  readonly before: string;
  readonly after: string;
  readonly comments: readonly string[];
  readonly nags: readonly number[];
  /** Alternatives to this move, each beginning from its `before` position. */
  readonly variations: readonly PgnVariation[];
}

/**
 * A SAN move: an optional piece letter, optional disambiguation, an optional capture
 * marker, the destination, an optional promotion, and optional check and annotation
 * suffixes. Symbolic annotations (`!`, `?`, `!?`) are normalized to their numeric NAGs while
 * the original SAN token remains available.
 */
const SAN_PATTERN = /^([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([NBRQ]))?[+#]?[!?]*$/;

/** Castling, in both the letter form the standard prescribes and the digit form seen in the wild. */
const CASTLE_PATTERN = /^([O0])-\1(-\1)?[+#]?[!?]*$/;

/** A move number, with any number of periods: `1.`, `1...`, or a bare `1`. */
const MOVE_NUMBER_PATTERN = /^\d+\.*$/;

/** Parses a PGN into one game. Throws PgnError for anything malformed. */
export function parsePgn(text: string): PgnGame {
  if (typeof text !== 'string') throw new PgnError('PGN must be a string');

  const { tags, movetext } = splitTags(text);
  const start = startPosition(tags);
  const { line, result, position } = readMovetext(movetext, start);
  validateResultTag(tags.Result, result);
  const san = line.moves.map((node) => node.san);
  const moves = line.moves.map((node) => node.move);

  return {
    tags,
    moves,
    san,
    result,
    startFen: start.fen,
    finalFen: position.fen,
    line,
  };
}

/**
 * Splits the tag pair section from the movetext. Tags must precede the movetext, as the
 * standard requires; a tag pair after the first move token is an error rather than a
 * silently relocated header.
 */
function splitTags(text: string): { tags: Record<string, string>; movetext: string } {
  const tags: Record<string, string> = {};
  let rest = text.trimStart();

  while (rest.startsWith('[')) {
    const end = tagEnd(rest);
    if (end < 0) throw new PgnError('unterminated tag pair');

    const [name, value] = parseTagPair(rest.slice(1, end));
    tags[name] = value;
    rest = rest.slice(end + 1).trimStart();
  }

  return { tags, movetext: rest };
}

/** Finds the closing bracket without mistaking one inside the quoted value for it. */
function tagEnd(text: string): number {
  let quoted = false;
  let escaped = false;

  for (let index = 1; index < text.length; index++) {
    const character = text[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === '\\') {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ']' && !quoted) {
      return index;
    }
  }

  return -1;
}

/** Reads the inside of one tag pair: a name and a quoted value. */
function parseTagPair(body: string): [string, string] {
  const match = /^\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\["\\])*)"\s*$/.exec(body);
  if (!match) throw new PgnError(`malformed tag pair: ${JSON.stringify(body)}`);
  return [match[1], match[2].replace(/\\(["\\])/g, '$1')];
}

/** The starting position: the FEN tag when present, otherwise the initial position. */
function startPosition(tags: Readonly<Record<string, string>>): Position {
  const fen = tags.FEN;
  const setup = tags.SetUp;
  if (setup !== undefined && setup !== '0' && setup !== '1') {
    throw new PgnError(`invalid SetUp tag: ${JSON.stringify(setup)}`);
  }
  if (setup === '1' && fen === undefined) throw new PgnError('SetUp "1" requires a FEN tag');
  if (fen !== undefined && setup !== '1') throw new PgnError('a FEN tag requires SetUp "1"');
  if (fen === undefined) return Position.initial();

  try {
    return Position.fromFen(fen);
  } catch (error) {
    if (error instanceof FenError) throw new PgnError(`invalid FEN tag: ${error.message}`);
    throw error;
  }
}

function validateResultTag(tag: string | undefined, result: PgnResult): void {
  if (tag === undefined) return;
  if (!RESULTS.includes(tag)) throw new PgnError(`invalid Result tag: ${JSON.stringify(tag)}`);
  if (tag !== result)
    throw new PgnError(`Result tag ${tag} does not match movetext result ${result}`);
}

type MovetextToken =
  | { readonly type: 'move' | 'comment'; readonly value: string }
  | { readonly type: 'nag'; readonly value: number }
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'result'; readonly value: PgnResult };

interface MutablePgnMove {
  move: Move;
  san: string;
  before: string;
  after: string;
  comments: string[];
  nags: number[];
  variations: PgnVariation[];
}

interface TokenCursor {
  index: number;
  ordinal: number;
}

/** Parses and validates the complete annotated movetext in one recursive pass. */
function readMovetext(
  movetext: string,
  start: Position,
): { line: PgnVariation; result: PgnResult; position: Position } {
  const tokens = tokenizeMovetext(movetext);
  const cursor: TokenCursor = { index: 0, ordinal: 0 };
  const parsed = readVariation(tokens, cursor, start, false);

  while (tokens[cursor.index]?.type === 'comment') cursor.index++;

  if (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    throw new PgnError(`content after the result: ${JSON.stringify(tokenValue(token))}`);
  }

  return { line: parsed.line, result: parsed.result ?? '*', position: parsed.position };
}

function readVariation(
  tokens: readonly MovetextToken[],
  cursor: TokenCursor,
  start: Position,
  nested: boolean,
): { line: PgnVariation; result: PgnResult | null; position: Position } {
  const comments: string[] = [];
  const moves: MutablePgnMove[] = [];
  let position = start;

  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (!token) break;

    if (token.type === 'close') {
      if (!nested) throw new PgnError('unexpected ")" in the movetext');
      cursor.index++;
      return { line: freezeVariation(comments, moves), result: null, position };
    }
    if (token.type === 'result') {
      if (nested) throw new PgnError('a variation cannot contain a game result');
      cursor.index++;
      return { line: freezeVariation(comments, moves), result: token.value, position };
    }
    if (token.type === 'comment') {
      const target = moves.at(-1)?.comments ?? comments;
      target.push(token.value);
      cursor.index++;
      continue;
    }
    if (token.type === 'nag') {
      const previous = moves.at(-1);
      if (!previous) throw new PgnError('annotation glyph is not attached to a move');
      previous.nags.push(token.value);
      cursor.index++;
      continue;
    }
    if (token.type === 'open') {
      const previous = moves.at(-1);
      if (!previous) throw new PgnError('variation is not attached to a move');
      cursor.index++;
      const branch = readVariation(tokens, cursor, Position.fromFen(previous.before), true);
      previous.variations.push(branch.line);
      continue;
    }

    cursor.ordinal++;
    const move = resolveSan(position, token.value, cursor.ordinal);
    const after = position.play(move);
    moves.push({
      move,
      san: token.value,
      before: position.fen,
      after: after.fen,
      comments: [],
      nags: symbolicNags(token.value),
      variations: [],
    });
    position = after;
    cursor.index++;
  }

  if (nested) throw new PgnError('unterminated variation');
  return { line: freezeVariation(comments, moves), result: null, position };
}

function symbolicNags(san: string): number[] {
  const suffix = /(!\?|\?!|!!|\?\?|!|\?)$/.exec(san)?.[1];
  return suffix ? [SYMBOLIC_NAGS[suffix] as number] : [];
}

function freezeVariation(comments: string[], moves: MutablePgnMove[]): PgnVariation {
  return Object.freeze({
    comments: Object.freeze(comments),
    moves: Object.freeze(
      moves.map((node) =>
        Object.freeze({
          ...node,
          comments: Object.freeze(node.comments),
          nags: Object.freeze(node.nags),
          variations: Object.freeze(node.variations),
        }),
      ),
    ),
  });
}

function tokenizeMovetext(movetext: string): MovetextToken[] {
  const tokens: MovetextToken[] = [];
  let index = 0;

  while (index < movetext.length) {
    const char = movetext[index];
    if (/\s/.test(char)) {
      index++;
    } else if (char === '{') {
      const end = movetext.indexOf('}', index);
      if (end < 0) throw new PgnError('unterminated comment');
      tokens.push({ type: 'comment', value: movetext.slice(index + 1, end).trim() });
      index = end + 1;
    } else if (char === ';') {
      const end = movetext.indexOf('\n', index);
      const stop = end < 0 ? movetext.length : end;
      tokens.push({ type: 'comment', value: movetext.slice(index + 1, stop).trim() });
      index = end < 0 ? movetext.length : end + 1;
    } else if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'open' : 'close' });
      index++;
    } else if (char === '}' || char === '[') {
      throw new PgnError(
        char === '[' ? 'tag pair after the movetext' : 'unexpected "}" in the movetext',
      );
    } else {
      const raw = readToken(movetext, index);
      index += raw.length;
      const value = stripMoveNumber(raw);
      if (value === '') continue;
      if (RESULTS.includes(value)) tokens.push({ type: 'result', value: value as PgnResult });
      else if (isNagToken(value)) tokens.push({ type: 'nag', value: Number(value.slice(1)) });
      else if (SYMBOLIC_NAGS[value]) tokens.push({ type: 'nag', value: SYMBOLIC_NAGS[value] });
      else tokens.push({ type: 'move', value });
    }
  }

  return tokens;
}

function tokenValue(token: MovetextToken | undefined): string {
  if (!token) return '';
  if ('value' in token) return String(token.value);
  return token.type === 'open' ? '(' : ')';
}

/**
 * Drops a leading move number, which PGN often writes glued to the move (`1.e4`). Returns
 * the empty string for a bare move number, which carries no move at all.
 */
function stripMoveNumber(token: string): string {
  return MOVE_NUMBER_PATTERN.test(token) ? '' : token.replace(/^\d+\.+/, '');
}

function isNagToken(token: string): boolean {
  return /^\$\d+$/.test(token);
}

/** Reads one whitespace-delimited token, stopping before any structural character. */
function readToken(movetext: string, start: number): string {
  let end = start;
  while (end < movetext.length && !/[\s{};()]/.test(movetext[end])) end++;
  return movetext.slice(start, end);
}

/**
 * Resolves one SAN token against the legal moves of a position. Exported so a caller can
 * resolve a single move without a whole game, and so the resolution rules are unit-testable
 * in isolation.
 */
export function resolveSan(position: Position, token: string, ordinal = 1): Move {
  const candidates = matchSan(position, token, ordinal);
  if (candidates.length === 0) {
    throw new PgnError(`illegal move ${JSON.stringify(token)} at token ${ordinal}`);
  }
  if (candidates.length > 1) {
    throw new PgnError(`ambiguous move ${JSON.stringify(token)} at token ${ordinal}`);
  }

  return candidates[0];
}

/** Every legal move the token could name. */
function matchSan(position: Position, token: string, ordinal: number): Move[] {
  const legal = position.legalMoves();
  const castle = CASTLE_PATTERN.exec(token);
  if (castle) {
    // The side is irrelevant: only one king can castle, and the destination file
    // distinguishes the two sides of the board.
    const file = castle[2] ? 'c' : 'g';
    return legal.filter((move) => move.castle && move.to[0] === file);
  }

  const match = SAN_PATTERN.exec(token);
  if (!match) throw new PgnError(`unreadable move ${JSON.stringify(token)} at token ${ordinal}`);

  const [, letter, fromFile, fromRank, capture, to, promotion] = match;
  const piece = pieceTypeFromChar((letter ?? 'P').toLowerCase());
  if (piece === null) throw new PgnError(`unknown piece in ${JSON.stringify(token)}`);
  const isCapture = capture !== undefined;
  if (piece === 'pawn' && (isCapture !== (fromFile !== undefined) || fromRank !== undefined)) {
    return [];
  }

  return legal.filter(
    (move) =>
      move.piece === piece &&
      move.to === to &&
      move.capture === isCapture &&
      (fromFile === undefined || move.from[0] === fromFile) &&
      (fromRank === undefined || move.from[1] === fromRank) &&
      move.promotion === (promotion === undefined ? undefined : pieceTypeFromChar(promotion)),
  );
}

/**
 * Replays a parsed game, returning the position after every mainline move. Useful to any
 * caller that needs the whole position sequence, such as a replay or analysis view.
 */
export function replay(game: PgnGame): Position[] {
  const positions = [Position.fromFen(game.startFen)];

  for (const move of game.moves) {
    try {
      positions.push(positions[positions.length - 1].play(move));
    } catch (error) {
      // Only reachable if a caller hand-built a PgnGame; parsePgn already played every move.
      if (error instanceof IllegalMoveError) throw new PgnError(error.message);
      throw error;
    }
  }

  return positions;
}
