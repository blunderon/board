import { expect, type Page, test } from '@playwright/test';

test('static landing page routes to every example', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.card')).toHaveCount(3);
  await page.getByRole('link', { name: /Game analysis/ }).click();
  await expect(page).toHaveURL(/\/examples\/analysis\/$/);
  await expect(page.locator('#board [data-square]')).toHaveCount(64);
});

test('analysis example adds and evaluates a legal engine line', async ({ page }) => {
  await openExample(page, 'analysis');

  await expect(page.getByText('After Bb5')).toBeVisible();
  await page.getByRole('button', { name: 'Add sample engine line' }).click();

  await expect(page.locator('.evaluation')).toHaveText('+0.34');
  await expect(page.locator('#board [data-arrow]')).toHaveCount(1);
});

test('bot example owns scheduling while the library owns legal moves', async ({ page }) => {
  await openExample(page, 'bot');

  await square(page, 'e2').click();
  await square(page, 'e4').click();

  await expect(page.locator('.history li')).toHaveCount(2);
  await expect(page.locator('#status')).toHaveText('Your move');
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
  await expect(page.locator('#board [data-square][aria-disabled="true"]')).toHaveCount(0);
});

test('puzzle example follows an authored branch through checkmate', async ({ page }) => {
  await openExample(page, 'puzzles');

  await square(page, 'e1').click();
  await square(page, 'e8').click();
  await expect(square(page, 'e8')).toHaveAttribute('aria-label', 'e8, black rook');

  await square(page, 'b5').click();
  await square(page, 'e8').click();

  await expect(page.getByText('Solved — checkmate.')).toBeVisible();
  await expect(page.locator('.solution strong')).toHaveText(['Rxe8+', 'Rxe8', 'Qxe8#']);
  await expect(page.locator('#board [data-square][aria-disabled="true"]')).toHaveCount(64);
});

async function openExample(page: Page, name: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/examples/${name}/`);
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
}

function square(page: Page, name: string) {
  return page.locator(`#board [data-square="${name}"]`);
}
