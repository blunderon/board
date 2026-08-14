# Blunder On Board

A small, dependency-free standard-chess library with three independently usable layers:

- `@blunderon/board/rules` — legal moves, FEN, SAN, annotated PGN, outcomes, game snapshots,
  engine lines, and variation trees.
- `@blunderon/board/core` — board geometry, FEN piece placement, keyboard navigation, and drag state.
- `@blunderon/board/dom` — an accessible, themeable browser board with no chess rules inside it.
- `@blunderon/board` — the convenient rules-and-board controller.

There are no runtime dependencies, remote assets, clocks, opponents, or engines. The library owns
the chess state around those systems, while applications own scheduling, networking, engine
processes, and product policy. The bundled SVG pieces work offline.

## Examples

Three independent, Mancha-powered browser examples exercise the main product integrations:

- [`examples/analysis`](./examples/analysis) loads an annotated game, edits variations, and accepts
  a UCI principal variation from a sample engine adapter.
- [`examples/bot`](./examples/bot) plays a complete game while the application owns bot scheduling
  and the library owns legal state and outcomes.
- [`examples/puzzles`](./examples/puzzles) authors branching solutions and handles hints, incorrect
  attempts, automatic replies, and completion.

Each entry point imports `@blunderon/board` exactly as an external application would. Run all three
locally with `bun run examples`, then open `http://127.0.0.1:4173/examples/analysis/` (or `bot/` and
`puzzles/`). The source is intentionally small enough to read alongside the relevant section below.

Pushes to `main` build and deploy the same static site through GitHub Pages. In the repository's
Pages settings, select **GitHub Actions** as the source; the deployment workflow publishes `dist`
without requiring a server or custom base-path configuration.

The `/dom` and top-level entries expect an asset-aware browser bundler that supports static SVG
imports (Bun is verified in CI). This keeps the piece set as separate, cacheable files. The
`/rules` and `/core` entries are plain ESM and need no asset loader. Raw, unbundled browser or Node
imports of `/dom` are not supported.

## A complete local board

```ts
import { createGameBoard } from '@blunderon/board';

const element = document.querySelector<HTMLElement>('#board');
if (!element) throw new Error('missing board element');

const chess = createGameBoard(element, {
  onMove(move) {
    console.log(move.san, move.after);
  },
});

chess.move('e4');
chess.move({ from: 'e7', to: 'e5' });
chess.undo();
chess.reset();
chess.destroy();
```

The same person can move both colors. Click/tap, drag, keyboard input, castling, en passant, and a
built-in promotion picker all go through the same legal-move path.

## Rules without a board

```ts
import { createGame, Position } from '@blunderon/board/rules';

const game = createGame();
game.move('e4');             // SAN
game.move('e7e5');           // UCI
game.move({ from: 'g1', to: 'f3' });

console.log(game.fen);
console.log(game.status);
console.log(game.legalMoves('b8'));
console.log(game.toPgn({ Event: 'Local game' }));

if (game.status.drawClaims.includes('fifty-move')) {
  game.claimDraw('fifty-move');
}

// Or declare the legal move that would make a draw claim available.
game.claimDraw('threefold-repetition', 'Ng8');

const snapshot = Position.initial();
console.log(snapshot.resolve({ from: 'e2', to: 'e4' }));
console.log(snapshot.destinations().get('e2')); // ['e3', 'e4']
console.log(snapshot.checkedKingSquare());      // null

const next = snapshot.play({ from: 'e2', to: 'e4' });
// `snapshot` remains unchanged.
```

`Game` is the obvious mutable driver. `Position` is the immutable building block for applications
that want snapshots and explicit state transitions.

## A board without rules

```ts
import { createBoard } from '@blunderon/board/dom';

const element = document.querySelector<HTMLElement>('#board');
if (!element) throw new Error('missing board element');

const board = createBoard(element, {
  fen: '8/8/8/8/8/8/4P3/4K2k w - - 0 1',
  legalMoves: new Map([['e2', ['e3', 'e4']]]),
  onMove(from, to, promotion) {
    sendMoveSomewhere({ from, to, promotion });
  },
});

board.update({ fen, legalMoves, lastMove: ['e2', 'e4'] });
board.destroy();
```

The renderer accepts position data and reports intent. It never imports or runs the rules engine,
so it can sit on top of a server, another chess library, or an analysis tool.

## Puzzles

Author one or more legal solution lines, then let `createPuzzleBoard` handle move matching, branching,
opponent replies, completion, board state, and feedback:

```ts
import { createPuzzleBoard, Position, VariationTree } from '@blunderon/board';

const solution = new VariationTree(Position.fromFen(puzzle.fen));
solution.addLine(['Rxe8+', 'Rxe8', 'Qxe8#']);
solution.addLine(['Qxe8+', 'Rxe8', 'Rxe8#']);

const session = createPuzzleBoard(element, {
  solution,
  player: 'white',
  orientation: 'white',
  onAttempt(attempt) {
    if (attempt.status === 'incorrect') recordFailedAttempt();
    if (attempt.status === 'complete') awardPuzzle();
  },
});

session.reset();
await save(session.snapshot());
session.restore(await load());
session.destroy();
```

An illegal or legal-but-incorrect attempt never changes the authored solution. By default, the first
authored opponent continuation is applied automatically, including a setup move before the solver's
first turn. Set `autoReply: false` and call
`session.reply(index)` when the product needs to choose or animate a reply itself. Hints, scoring,
attempt limits, and animation timing remain product decisions.

For rules-only use, `PuzzleSession` exposes the same non-mutating workflow without a DOM board.
Its versioned snapshot preserves the isolated authored tree and current progress. `replayLine`
remains available for consumers that only need a validated flat sequence of immutable positions.

## Server-authoritative games

`Game.snapshot` contains the starting position, full UCI move history, and non-board termination.
Unlike FEN alone, it preserves the history required for repetition decisions and can safely cross a
JSON or persistence boundary:

```ts
const game = createGame();
game.move(serverMove);
await save(game.snapshot);

const restored = createGame({ snapshot: await load() });
restored.finish('resignation', 'black');
// For a clock adjudication, the winner is the side not on move.
restored.finish('timeout', restored.turn === 'white' ? 'black' : 'white');
```

Supported external endings are resignation, draw agreement, timeout, abandonment, abort, and a
declared result imported from PGN. The library validates draw claims, rejects moves and claims after
termination, preserves intended-move claims, and adjudicates timeout or resignation as a draw when
the nominal winner has no recognized mating material. PGN imports reject results that contradict
either the final board position or termination metadata.

Mating-material adjudication intentionally uses the standard inexpensive material cases. It does
not search every legal continuation to prove unusual blocked positions dead; applications requiring
that rare, exhaustive ruling should make it before recording the external ending.

Clock counting intentionally remains outside the library because authoritative time, latency
compensation, and disconnect policy belong on the server. Once that authority decides a flag fell,
call `finish('timeout', winner)` and the library applies the chess adjudication.

For a server-authoritative browser board, keep the renderer controlled and restore the complete
snapshot returned by the server:

```ts
import { boardState } from '@blunderon/board';
import { createBoard } from '@blunderon/board/dom';
import { createGame, type MoveInput } from '@blunderon/board/rules';

const game = createGame({ snapshot: initialSnapshot });
let pending = false;

const board = createBoard(element, {
  ...boardState(game.position),
  disabled: game.status.over || game.turn !== player,
  onMove(from, to, promotion) {
    void submit({ from, to, ...(promotion ? { promotion } : {}) });
  },
});

async function submit(move: MoveInput) {
  pending = true;
  sync();
  try {
    game.restore(await sendMove(move, game.snapshot));
  } finally {
    pending = false;
    sync();
  }
}

function sync() {
  board.update({
    ...boardState(game.position),
    disabled: pending || game.status.over || game.turn !== player,
  });
}
```

Authentication, player identity, request revisions, reconnect policy, and transport remain product
logic. The board never assumes that a locally legal move was accepted by the server.

## Analysis and engines

`createAnalysisBoard` keeps an editable legal variation tree synchronized with the board. It owns
branch navigation, legal move entry, node annotations, principal-variation insertion, and complete
JSON-safe persistence:

```ts
import { createAnalysisBoard, VariationTree } from '@blunderon/board';

const analysis = createAnalysisBoard(element, {
  tree: VariationTree.fromPgn(pgn),
});

const candidate = analysis.play('c5');
analysis.annotate({
  comment: 'The Sicilian Defence',
  nags: [1],
  evaluation: {
    type: 'centipawn',
    value: 24,
    pov: 'white',
    depth: 20,
    bound: 'exact',
  },
  highlights: [{ square: 'd5', label: 'Weak square' }],
  arrows: [{ from: 'g1', to: 'f3', label: 'Develop the knight' }],
});
analysis.back();
analysis.forward();

// Validates the whole PV before adding it and keeps the current node selected.
analysis.addUci(enginePrincipalVariation);

const annotatedPgn = analysis.toPgn();
await save(JSON.stringify(analysis.snapshot()));
analysis.restore(JSON.parse(await load()));
```

Pointer users can right-drag to toggle arrows and right-click to toggle square highlights.
Programmatic arrows and highlights accept labels that are included in square accessibility text;
unlabelled highlights are announced as highlighted.

For rules-only analysis, use `VariationTree` directly. `replayUci` translates a principal variation
into complete legal moves, SAN, and positions. Annotated PGN preserves move comments, NAGs, unknown
comment directives, and portable white-relative `[%eval]` scores. PGN does not preserve the exact
placement of leading variation or post-result comments. Use `VariationTree.snapshot` for lossless
persistence of the cursor, all branches, markings, score bounds, WDL, and MultiPV metadata.

Starting, stopping, and communicating with an engine remains application logic. The library validates
and presents the chess content the engine returns. The application extracts the UCI PV and score
fields, converts side-to-move scores to the evaluation's explicit `pov`, and supplies mate distances
in signed full moves.

## Themes

Themes are plain options. Override only what you need:

```ts
createGameBoard(element, {
  theme: {
    lightSquare: '#e8dcc4',
    darkSquare: '#66806a',
    selected: '#f0bf4c',
    pieces: (piece) => `/pieces/${piece.color}-${piece.type}.svg`,
  },
});
```

The available color keys are `lightSquare`, `darkSquare`, `selected`, `legalMove`, `lastMove`,
`check`, and `focus`. A piece theme is one function receiving `{ color, type }` and returning an
image URL. A data URL keeps a custom set fully self-contained.

## Accessibility

The DOM board provides:

- A semantic 8×8 grid with coordinate-and-piece labels.
- One keyboard tab stop with arrow, Home, and End navigation.
- Enter or Space to select and move.
- Visible focus, selection, destination, last-move, and check states.
- An accessible promotion dialog and move announcements.
- Click/tap and drag alternatives using the same callback.

## Development

```sh
bun install
bun test
bun run test:e2e
bun run ci
```

Unit tests live beside their source files. The browser examples are generated into `dist/examples`
by `bun run build` and make no non-local requests.

The library code is MIT licensed. The bundled Cburnett pieces are CC BY-SA 3.0; their attribution
is shipped at `dist/pieces/ATTRIBUTION.md` and embedded in every SVG so it survives consumer asset
bundling. Applications using the default pieces must preserve that attribution and license notice.
