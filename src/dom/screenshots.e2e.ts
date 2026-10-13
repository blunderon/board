import { find, snapshot } from '@blunderon/ax';
import { expect, type Page } from '@playwright/test';
import { test } from '../../tests/fixtures.js';
import type { GameBoardController } from '../index.js';
import type { Color } from '../shared.js';

type ExampleWindow = typeof window & { gameBoard: GameBoardController };

for (const [viewport, size] of Object.entries({
  desktop: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
})) {
  test.describe(viewport, () => {
    test.use({ viewport: size, contextOptions: { reducedMotion: 'reduce' } });

    for (const orientation of ['white', 'black'] as const) {
      test(`${orientation} orientation`, async ({ page }) => {
        await openBoard(page, orientation);
        await capture(page, `${viewport}-${orientation}`);
      });
    }

    test('last move and checked king', async ({ page }) => {
      await openBoard(page);
      await page.evaluate(() => {
        (window as ExampleWindow).gameBoard.loadPgn('1. f3 e5 2. g4 Qh4# 0-1');
      });
      await capture(page, `${viewport}-checkmate`);
    });

    test('selected piece and legal destinations', async ({ page }) => {
      await openBoard(page);
      await (await find(page, { role: 'gridcell', name: 'e2, white pawn' })).click();
      await capture(page, `${viewport}-legal-hints`);
    });

    test('user annotations and translucent analysis arrows', async ({ page }) => {
      await openBoard(page);
      await page.evaluate(() => {
        (window as ExampleWindow).gameBoard.board.update({
          highlights: [
            { square: 'd5', label: 'highlighted' },
            { square: 'e4', color: '#ff0000', label: 'Critical' },
          ],
          arrows: [
            { from: 'e2', to: 'e4' },
            { from: 'g1', to: 'f3', color: '#0000ff', opacity: 0.35, label: 'Develop' },
            { from: 'b1', to: 'c3', color: '#ff0000', opacity: 0.4, label: 'Blunder' },
          ],
        });
      });
      await capture(page, `${viewport}-annotations`);
    });

    test('promotion picker', async ({ page }) => {
      await openBoard(page);
      await page.evaluate(() => {
        (window as ExampleWindow).gameBoard.reset('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
      });
      await (await find(page, { role: 'gridcell', name: 'a7, white pawn' })).click();
      await (await find(page, { role: 'gridcell', name: 'a8, empty' })).click();
      await find(page, { role: 'dialog', name: 'Choose promotion piece' });
      await capture(page, `${viewport}-promotion`);
    });

    for (const example of ['analysis', 'puzzles']) {
      test(`${example} authored position`, async ({ page }) => {
        await page.goto(`/examples/${example}/`);
        await find(page, { role: 'grid', name: 'Chess board' });
        await find(page, {
          role: 'button',
          name: example === 'analysis' ? 'Reset example' : 'Try again',
        });
        await capture(page, `${viewport}-${example}`);
      });
    }
  });
}

async function openBoard(page: Page, orientation: Color = 'white'): Promise<void> {
  await page.goto('/example/');
  await find(page, { role: 'grid', name: 'Chess board' });
  await page.evaluate((value) => {
    (window as ExampleWindow).gameBoard.board.update({ orientation: value });
  }, orientation);
}

async function capture(page: Page, name: string): Promise<void> {
  const main = await find(page, { role: 'main' });
  expect(await snapshot(page, main)).toMatchSnapshot(`${name}.ax.txt`);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}
