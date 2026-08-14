const rules = await import('@blunderon/board/rules');
const game = rules.createGame();
game.move('e4');
if (game.turn !== 'black') throw new Error('the packaged rules entry did not play e4');
if (game.position.destinations().get('e7')?.length !== 2) {
  throw new Error('the packaged position entry did not expose board destinations');
}
if (game.position.resolve({ from: 'e7', to: 'e5' })?.piece !== 'pawn') {
  throw new Error('the packaged position entry did not resolve a legal move');
}
const solution = new rules.VariationTree();
solution.addLine(['e4', 'e5']);
const puzzle = new rules.PuzzleSession(solution);
if (puzzle.attempt('e4').replies[0]?.san !== 'e5') {
  throw new Error('the packaged puzzle session did not apply its solution reply');
}

const core = await import('@blunderon/board/core');
if (core.boardRows('white').length !== 8) throw new Error('the packaged core entry has no board');

const dom = await import('@blunderon/board/dom');
const king = dom.defaultPieces({ color: 'white', type: 'king' });
if (!king.endsWith('/dist/pieces/wK.svg')) {
  throw new Error(`the packaged piece URL points outside the distribution: ${king}`);
}

const consumerOutput = await mkdtemp(join(tmpdir(), 'blunderon-consumer-'));
try {
  const bundle = await Bun.build({
    entrypoints: [new URL('./consumer-bundle-entry.ts', import.meta.url).pathname],
    outdir: consumerOutput,
    target: 'browser',
    format: 'esm',
  });
  if (!bundle.success) throw new Error('a consumer could not bundle the DOM entry');
  const assets = bundle.outputs.filter((output) => output.path.endsWith('.svg'));
  if (assets.length !== 12) {
    throw new Error(`the consumer bundle emitted ${assets.length} piece assets, expected 12`);
  }
  if (!(await assets[0].text()).includes('creativecommons.org/licenses/by-sa/3.0')) {
    throw new Error('consumer-bundled pieces lost their CC BY-SA attribution metadata');
  }
} finally {
  await rm(consumerOutput, { recursive: true, force: true });
}

const integration = await import('@blunderon/board');
const projected = integration.boardState(rules.Position.fromFen('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1'));
if (projected.checkedKing !== 'e8') {
  throw new Error('the packaged integration entry did not project the checked king');
}
if (
  typeof integration.createPuzzleBoard !== 'function' ||
  typeof integration.createAnalysisBoard !== 'function'
) {
  throw new Error('the packaged integration entry is missing a use-case controller');
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
