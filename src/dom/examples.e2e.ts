import { find, snapshot } from '@blunderon/ax';
import type { Page } from '@playwright/test';
import { expect, test } from '../../tests/fixtures.js';

test('static landing page routes to every example', async ({ page }) => {
  await page.goto('/');

  const examples = await find(page, { role: 'region', name: 'Examples' });
  expect(await snapshot(page, examples)).toMatchSnapshot('example-links.txt');
  await (await find(page, { role: 'link', name: /Game analysis/, scope: examples })).click();
  await expect(page).toHaveURL(/\/examples\/analysis\/$/);
  const board = await find(page, { role: 'grid', name: 'Chess board' });
  expect((await snapshot(page, board)).match(/gridcell /g)).toHaveLength(64);
});

test('analysis example adds and evaluates a legal engine line', async ({ page }) => {
  await openExample(page, 'analysis');

  await find(page, { role: 'StaticText', name: 'After Bb5' });
  await (await find(page, { role: 'button', name: 'Add sample engine line' })).click();

  await find(page, { role: 'StaticText', name: '+0.34' });
  const board = await find(page, { role: 'grid', name: 'Chess board' });
  expect(await snapshot(page, board)).toMatchSnapshot('analysis-engine-line.txt');
});

test('bot example owns scheduling while the library owns legal moves', async ({ page }) => {
  await openExample(page, 'bot');

  await (await square(page, 'e2')).click();
  await (await square(page, 'e4')).click();

  const history = await find(page, { role: 'region', name: 'Move history' });
  await expect.poll(() => snapshot(page, history)).toContain('StaticText "2 PLIES"');
  await find(page, { role: 'StaticText', name: 'Your move' });
  await find(page, { role: 'gridcell', name: 'e4, white pawn' });
  expect(await snapshot(page, history)).toMatchSnapshot('bot-move-history.txt');
  const board = await find(page, { role: 'grid', name: 'Chess board' });
  expect((await snapshot(page, board)).match(/gridcell .*disabled=true/g) ?? []).toHaveLength(0);
});

test('puzzle example follows an authored branch through checkmate', async ({ page }) => {
  await openExample(page, 'puzzles');

  await (await square(page, 'e1')).click();
  await (await square(page, 'e8')).click();
  await find(page, { role: 'gridcell', name: 'e8, black rook' });

  await (await square(page, 'b5')).click();
  await (await square(page, 'e8')).click();

  await find(page, { role: 'StaticText', name: 'Solved — checkmate.' });
  const solution = await find(page, { role: 'list', name: 'Moves played' });
  expect(await snapshot(page, solution)).toMatchSnapshot('puzzle-solution.txt');
  const board = await find(page, { role: 'grid', name: 'Chess board' });
  expect((await snapshot(page, board)).match(/gridcell .*disabled=true/g)).toHaveLength(64);
});

async function openExample(page: Page, name: string): Promise<void> {
  await page.goto(`/examples/${name}/`);
  await find(page, { role: 'grid', name: 'Chess board' });
}

function square(page: Page, name: string) {
  return find(page, { role: 'gridcell', name: new RegExp(`^${name},`) });
}
