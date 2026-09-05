import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/example/');
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('plays a complete game by moving both colors on the board', async ({ page }) => {
  for (const [from, to] of [
    ['f2', 'f3'],
    ['e7', 'e5'],
    ['g2', 'g4'],
    ['d8', 'h4'],
  ]) {
    await square(page, from).click();
    await square(page, to).click();
  }

  await expect(page.locator('#status')).toHaveText('Checkmate — black wins');
  await expect(page.locator('#moves li')).toHaveText(['f3', 'e5', 'g4', 'Qh4#']);
  await expect(square(page, 'h4')).toHaveAttribute('aria-label', 'h4, black queen');
  await expect(page.locator('#board [data-square][aria-disabled="true"]')).toHaveCount(64);
});

test('supports keyboard movement and exposes a semantic 64-square grid', async ({ page }) => {
  expect(await page.evaluate(() => 'gameBoard' in window)).toBe(true);
  expect(
    await page.evaluate(
      () => 'game' in (window as typeof window & { gameBoard: Record<string, unknown> }).gameBoard,
    ),
  ).toBe(false);
  expect(
    await page
      .locator('#board')
      .evaluate((host) => host.shadowRoot?.querySelectorAll('[role="gridcell"]').length),
  ).toBe(64);
  await expect(page.locator('#board [role="gridcell"]')).toHaveCount(64);
  await square(page, 'e2').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');

  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
  await expect(page.locator('#status')).toHaveText('Black to move');
});

test('applies programmatic colors and loads every bundled piece offline', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) remoteRequests.push(request.url());
  });
  await page.reload();

  const light = await page.locator('#board').evaluate((host) => {
    const frame = host.shadowRoot?.querySelector<HTMLElement>('.frame');
    return frame ? getComputedStyle(frame).getPropertyValue('--board-light').trim() : '';
  });
  expect(light).toBe('#e8dcc4');

  await expect
    .poll(() =>
      page
        .locator('#board .piece:not([hidden])')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  expect(remoteRequests).toEqual([]);
  expect(
    await page
      .locator('#board .piece')
      .evaluateAll((images) =>
        images.some((image) => image.getAttribute('src')?.startsWith('data:')),
      ),
  ).toBe(false);
});

test('drags through the same move path as click and keyboard', async ({ page }) => {
  await square(page, 'e2').dragTo(square(page, 'e4'));

  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
  await expect(page.locator('#moves li')).toHaveText(['e4']);
});

test('marks the exact legal square under a drag at square boundaries', async ({ page }) => {
  const from = await square(page, 'e2').boundingBox();
  const upper = await square(page, 'e4').boundingBox();
  const lower = await square(page, 'e3').boundingBox();
  if (!from || !upper || !lower) throw new Error('expected visible drag squares');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(upper.x + upper.width / 2, upper.y + upper.height - 1);
  await expect(square(page, 'e4')).toHaveAttribute('data-drop-target', 'true');
  await expect(square(page, 'e3')).toHaveAttribute('data-drop-target', 'false');

  await page.mouse.move(lower.x + lower.width / 2, lower.y + 1);
  await expect(square(page, 'e4')).toHaveAttribute('data-drop-target', 'false');
  await expect(square(page, 'e3')).toHaveAttribute('data-drop-target', 'true');
  await page.mouse.up();

  await expect(square(page, 'e3')).toHaveAttribute('aria-label', 'e3, white pawn');
  await expect(page.locator('#moves li')).toHaveText(['e3']);
});

test('keeps touch drag feedback visible above the finger and marks the drop square', async ({
  page,
}) => {
  const from = await square(page, 'e2').boundingBox();
  const to = await square(page, 'e4').boundingBox();
  if (!from || !to) throw new Error('expected visible drag squares');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const destination = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Input.dispatchTouchEvent', {
    touchPoints: [start],
    type: 'touchStart',
  });
  await cdp.send('Input.dispatchTouchEvent', {
    touchPoints: [destination],
    type: 'touchMove',
  });

  await expect(square(page, 'e4')).toHaveAttribute('data-drop-target', 'true');
  const frame = await page.locator('#board .frame').boundingBox();
  const ghost = await page.locator('#board .ghost').boundingBox();
  const target = await page.locator('#board .drag-target').boundingBox();
  if (!frame || !ghost || !target) throw new Error('expected visible touch feedback');
  expect(ghost.width).toBeCloseTo((frame.width / 8) * 1.5, 0);
  expect(ghost.y + ghost.height).toBeLessThan(destination.y);
  expect(target.width).toBeCloseTo(to.width * 2, 0);

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await expect(page.locator('#board .drag-target')).toBeHidden();
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
});

test('keeps quick touch taps on the normal move path', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);

  await touchTap(cdp, await centerOf(square(page, 'e2')));
  await expect(square(page, 'e2')).toHaveAttribute('aria-selected', 'true');
  await touchTap(cdp, await centerOf(square(page, 'e4')));

  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
  await expect(page.locator('#moves li')).toHaveText(['e4']);
  await page.waitForTimeout(550);
  await expect(page.locator('#board [data-annotation-preview]')).toHaveCount(0);
});

test('uses a touch long-press to highlight a square or draw an arrow', async ({ page }) => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      gameBoard: { destroy(): void };
      blunderon: {
        createAnalysisBoard(element: HTMLElement): { destroy(): void };
      };
      touchAnalysis?: { destroy(): void };
    };
    scope.gameBoard.destroy();
    const element = document.getElementById('board');
    if (!element) throw new Error('missing board');
    scope.touchAnalysis = scope.blunderon.createAnalysisBoard(element);
  });
  const cdp = await page.context().newCDPSession(page);
  const d5 = await centerOf(square(page, 'd5'));

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [d5], type: 'touchStart' });
  await page.waitForTimeout(550);
  await expect(page.locator('#board [data-annotation-preview="d5"]')).toHaveCount(1);
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await expect(page.locator('#board .annotations [data-highlight="d5"]')).toHaveCount(1);

  const e2 = await centerOf(square(page, 'e2'));
  const e4 = await centerOf(square(page, 'e4'));
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [e2], type: 'touchStart' });
  await page.waitForTimeout(550);
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [e4], type: 'touchMove' });
  await expect(page.locator('#board [data-annotation-preview="e2e4"]')).toHaveCount(1);
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });

  await expect(page.locator('#board .annotations [data-arrow="e2e4"]')).toHaveCount(1);
  await expect(square(page, 'e2')).toHaveAttribute('aria-label', /white pawn, arrow to e4/);
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, empty, arrow from e2');
  await expect(page.locator('#moves li')).toHaveCount(0);
});

test('does not restore the drag source before the controlled move callback', async ({ page }) => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      dragSourceAtMove?: string | null;
      gameBoard: {
        board: {
          update(update: { onMove(from: string, to: string, promotion?: string): void }): void;
        };
        move(move: { from: string; to: string; promotion?: string }): void;
      };
    };
    const host = document.getElementById('board');
    scope.gameBoard.board.update({
      onMove: (from, to, promotion) => {
        scope.dragSourceAtMove =
          host?.shadowRoot
            ?.querySelector(`[data-square="${from}"]`)
            ?.getAttribute('data-drag-source') ?? null;
        scope.gameBoard.move({ from, to, ...(promotion ? { promotion } : {}) });
      },
    });
  });

  await square(page, 'e2').dragTo(square(page, 'e4'));

  expect(
    await page.evaluate(
      () => (window as typeof window & { dragSourceAtMove?: string | null }).dragSourceAtMove,
    ),
  ).toBe('true');
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
});

test('cancels a drag when controlled state disables the board', async ({ page }) => {
  const from = await square(page, 'e2').boundingBox();
  const to = await square(page, 'e4').boundingBox();
  if (!from || !to) throw new Error('expected visible drag squares');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { board: { update(update: { disabled: boolean }): void } };
      }
    ).gameBoard;
    controller.board.update({ disabled: true });
  });
  await page.mouse.up();

  await expect(square(page, 'e2')).toHaveAttribute('aria-label', 'e2, white pawn');
  await expect(page.locator('#moves li')).toHaveCount(0);
});

test('offers a keyboard-accessible promotion picker', async ({ page }) => {
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen: string): void };
      }
    ).gameBoard;
    controller.reset('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  });

  await square(page, 'a7').click();
  await square(page, 'a8').click();
  await expect(page.getByRole('dialog', { name: 'Choose promotion piece' })).toBeVisible();
  await page.getByRole('button', { name: 'Promote to knight' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Promote to queen' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Promote to knight' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Choose promotion piece' })).toBeHidden();
  await expect(square(page, 'a7')).toHaveAttribute('aria-label', 'a7, white pawn');

  await square(page, 'a7').click();
  await square(page, 'a8').click();
  await page.getByRole('button', { name: 'Promote to queen' }).click();

  await expect(square(page, 'a8')).toHaveAttribute('aria-label', 'a8, white queen');
  await expect(page.locator('#moves li')).toHaveText(['a8=Q+']);
});

test('cancels a pending promotion when the position is replaced', async ({ page }) => {
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen?: string): void };
      }
    ).gameBoard;
    controller.reset('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  });
  await square(page, 'a7').click();
  await square(page, 'a8').click();
  await expect(page.getByRole('dialog', { name: 'Choose promotion piece' })).toBeVisible();

  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen?: string): void };
      }
    ).gameBoard;
    controller.reset();
  });

  await expect(page.getByRole('dialog', { name: 'Choose promotion piece' })).toBeHidden();
  await expect(square(page, 'a7')).toHaveAttribute('aria-label', 'a7, black pawn');
});

test('clears selection when the position is replaced', async ({ page }) => {
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen?: string): void };
      }
    ).gameBoard;
    controller.reset('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  });
  await square(page, 'a7').click();
  await expect(square(page, 'a7')).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen?: string): void };
      }
    ).gameBoard;
    controller.reset();
  });

  await expect(square(page, 'a7')).toHaveAttribute('aria-selected', 'false');
});

test('renders controlled analysis highlights and arrows without intercepting input', async ({
  page,
}) => {
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: {
          board: {
            update(update: {
              highlights: readonly { square: 'e4'; color: string; label: string }[];
              arrows: readonly { from: 'g1'; to: 'f3'; color: string; opacity: number }[];
            }): void;
          };
        };
      }
    ).gameBoard;
    controller.board.update({
      highlights: [{ square: 'e4', color: '#ff0000', label: 'Critical' }],
      arrows: [{ from: 'g1', to: 'f3', color: '#0000ff', opacity: 0.35 }],
    });
  });

  await expect(page.locator('#board .annotations [data-highlight="e4"]')).toHaveCount(1);
  await expect(page.locator('#board .annotations [data-arrow="g1f3"]')).toHaveCount(1);
  await expect(page.locator('#board .annotations [data-arrow="g1f3"]')).toHaveAttribute(
    'stroke-opacity',
    '0.35',
  );
  await expect(page.locator('#board .annotations polygon')).toHaveAttribute('fill-opacity', '0.35');
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', /Critical/);

  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', /white pawn/);
});

test('restores a complete game snapshot and records an external ending', async ({ page }) => {
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  const snapshot = await page.evaluate(() => {
    const controller = (window as typeof window & { gameBoard: { snapshot(): unknown } }).gameBoard;
    return controller.snapshot();
  });
  await square(page, 'e7').click();
  await square(page, 'e5').click();

  await page.evaluate((saved) => {
    const controller = (
      window as typeof window & {
        gameBoard: {
          restore(snapshot: never): void;
          finish(outcome: 'timeout', winner: 'white'): void;
        };
      }
    ).gameBoard;
    controller.restore(saved as never);
    controller.finish('timeout', 'white');
  }, snapshot);

  await expect(square(page, 'e7')).toHaveAttribute('aria-label', 'e7, black pawn');
  await expect(page.locator('#status')).toHaveText('White wins — timeout');
  await expect(page.locator('#board [data-square][aria-disabled="true"]')).toHaveCount(64);
});

test('announces a drawn timeout when the opponent cannot possibly mate', async ({ page }) => {
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: {
          reset(fen?: string): void;
          finish(outcome: 'timeout', winner: 'black'): void;
        };
      }
    ).gameBoard;
    controller.reset('7k/8/8/8/8/8/6Q1/7K w - - 0 1');
    controller.finish('timeout', 'black');
  });

  await expect(page.locator('#status')).toHaveText('Draw — timeout');
  await expect(page.locator('#board [aria-live="polite"]')).toHaveText(
    'Draw because the opponent has no mating material.',
  );
});

test('runs a puzzle without letting an incorrect legal move change its solution', async ({
  page,
}) => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      gameBoard: { destroy(): void };
      blunderon: {
        VariationTree: new () => {
          addLine(moves: readonly string[]): unknown;
        };
        createPuzzleBoard(
          element: HTMLElement,
          options: object,
        ): {
          snapshot(): unknown;
          restore(snapshot: never): void;
        };
      };
      puzzle?: {
        snapshot(): unknown;
        restore(snapshot: never): void;
      };
    };
    scope.gameBoard.destroy();
    const solution = new scope.blunderon.VariationTree();
    solution.addLine(['e4', 'e5', 'Nf3']);
    const element = document.getElementById('board');
    if (!element) throw new Error('missing board');
    scope.puzzle = scope.blunderon.createPuzzleBoard(element, { solution });
  });

  await square(page, 'd2').click();
  await square(page, 'd4').click();
  await expect(square(page, 'd2')).toHaveAttribute('aria-label', 'd2, white pawn');

  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
  await expect(square(page, 'e5')).toHaveAttribute('aria-label', 'e5, black pawn');

  await square(page, 'f1').click();
  await square(page, 'c4').click();
  await expect(square(page, 'e5')).toHaveClass(/last-move/);

  const snapshot = await page.evaluate(() => {
    const scope = window as typeof window & { puzzle: { snapshot(): unknown } };
    return JSON.parse(JSON.stringify(scope.puzzle.snapshot()));
  });

  await square(page, 'g1').click();
  await square(page, 'f3').click();
  await expect(page.locator('#board [data-square][aria-disabled="true"]')).toHaveCount(64);

  await page.evaluate((saved) => {
    const scope = window as typeof window & { puzzle: { restore(snapshot: never): void } };
    scope.puzzle.restore(saved as never);
  }, snapshot);
  await expect(square(page, 'g1')).toHaveAttribute('aria-label', 'g1, white knight');
  await expect(square(page, 'g1')).toHaveAttribute('aria-disabled', 'false');
});

test('starts an opponent-first puzzle without disabling the solver', async ({ page }) => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      gameBoard: { destroy(): void };
      blunderon: {
        VariationTree: new () => { addLine(moves: readonly string[]): unknown };
        createPuzzleBoard(
          element: HTMLElement,
          options: object,
        ): {
          attempt(move: string): unknown;
          reply(): unknown;
        };
      };
      puzzle?: { attempt(move: string): unknown; reply(): unknown };
    };
    scope.gameBoard.destroy();
    const solution = new scope.blunderon.VariationTree();
    solution.addLine(['e4', 'e5', 'Nf3']);
    const element = document.getElementById('board');
    if (!element) throw new Error('missing board');
    scope.puzzle = scope.blunderon.createPuzzleBoard(element, {
      solution,
      player: 'black',
    });
  });

  await expect(square(page, 'e4')).toHaveAttribute('aria-label', 'e4, white pawn');
  await expect(square(page, 'e7')).toHaveAttribute('aria-disabled', 'false');
});

test('announces a product-controlled puzzle reply', async ({ page }) => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      gameBoard: { destroy(): void };
      blunderon: {
        VariationTree: new () => { addLine(moves: readonly string[]): unknown };
        createPuzzleBoard(
          element: HTMLElement,
          options: object,
        ): {
          attempt(move: string): unknown;
          reply(): unknown;
        };
      };
    };
    scope.gameBoard.destroy();
    const solution = new scope.blunderon.VariationTree();
    solution.addLine(['e4', 'e5']);
    const element = document.getElementById('board');
    if (!element) throw new Error('missing board');
    const puzzle = scope.blunderon.createPuzzleBoard(element, {
      solution,
      autoReply: false,
    });
    puzzle.attempt('e4');
    puzzle.reply();
  });

  await expect(square(page, 'e5')).toHaveAttribute('aria-label', 'e5, black pawn');
  await expect(page.locator('#board [aria-live="polite"]')).toHaveText('e5. Puzzle complete.');
});

test('keeps an analysis tree and board synchronized through navigation and restore', async ({
  page,
}) => {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      gameBoard: { destroy(): void };
      blunderon: {
        createAnalysisBoard(element: HTMLElement): {
          play(move: string): unknown;
          back(): unknown;
          annotate(update: object): void;
          snapshot(): unknown;
          restore(snapshot: never): void;
          toPgn(): string;
        };
      };
      analysis?: {
        play(move: string): unknown;
        back(): unknown;
        annotate(update: object): void;
        snapshot(): unknown;
        restore(snapshot: never): void;
        toPgn(): string;
      };
    };
    scope.gameBoard.destroy();
    const element = document.getElementById('board');
    if (!element) throw new Error('missing board');
    scope.analysis = scope.blunderon.createAnalysisBoard(element);
    scope.analysis.play('e4');
    scope.analysis.annotate({
      comment: 'Candidate move',
      highlights: [{ square: 'e4', label: 'Candidate' }],
      arrows: [{ from: 'g1', to: 'f3', label: 'Develop the knight' }],
    });
    const snapshot = JSON.parse(JSON.stringify(scope.analysis.snapshot()));
    scope.analysis.back();
    scope.analysis.play('d4');
    scope.analysis.restore(snapshot as never);
  });

  await expect(square(page, 'e4')).toHaveAttribute('aria-label', /white pawn, Candidate/);
  await expect(square(page, 'g1')).toHaveAttribute('aria-label', /Develop the knight/);
  await expect(page.locator('#board .annotations [data-arrow="g1f3"]')).toHaveCount(1);

  await drawArrow(page, 'e4', 'd5');
  await expect(page.locator('#board .annotations [data-arrow="e4d5"]')).toHaveCount(1);

  await square(page, 'd5').click({ button: 'right' });
  await expect(page.locator('#board .annotations [data-highlight="d5"]')).toHaveCount(1);
  await expect(square(page, 'd5')).toHaveAttribute('aria-label', /highlighted/);

  // Drawings are scratch marks, so the next tap on the board wipes them.
  await square(page, 'e2').click();
  await expect(page.locator('#board .annotations [data-arrow="e4d5"]')).toHaveCount(0);
  await expect(page.locator('#board .annotations [data-highlight="d5"]')).toHaveCount(0);
  await expect(page.locator('#board .annotations [data-arrow="g1f3"]')).toHaveCount(0);

  const exposesMutableTree = await page.evaluate(() => {
    const scope = window as typeof window & { analysis: object };
    return 'tree' in scope.analysis;
  });
  expect(exposesMutableTree).toBe(false);

  const pgn = await page.evaluate(() => {
    const scope = window as typeof window & { analysis: { toPgn(): string } };
    return scope.analysis.toPgn();
  });
  expect(pgn).toContain('1. e4');
  expect(pgn).toContain('Candidate move');
});

test('keeps the themed board within a narrow offline viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const metrics = await page.evaluate(() => {
    const board = document.getElementById('board')?.getBoundingClientRect();
    return {
      boardWidth: board?.width ?? 0,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(metrics.boardWidth).toBeGreaterThan(300);
  expect(metrics.boardWidth).toBeLessThanOrEqual(metrics.clientWidth - 32);
  expect(metrics.scrollWidth).toBe(metrics.clientWidth);
});

test('holds a piece picked up while the opponent is still thinking', async ({ page }) => {
  await controlBoard(page, { disabled: true, player: 'black' });
  const from = await centerOf(square(page, 'e7'));
  const to = await centerOf(square(page, 'e5'));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await expect(square(page, 'e7')).toHaveAttribute('data-drag-source', 'true');

  await playOpponentMove(page, 'e2', 'e4');
  await expect(page.locator('#board .ghost')).toBeVisible();
  await page.mouse.up();

  await expect(page.locator('#moves li')).toHaveText(['e4', 'e5']);
});

test('drops a held piece when the opponent takes it off its square', async ({ page }) => {
  await page.evaluate(() => {
    const controller = (window as typeof window & { gameBoard: { reset(fen: string): void } })
      .gameBoard;
    controller.reset('rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2');
  });
  await controlBoard(page, { disabled: true, player: 'black' });
  const from = await centerOf(square(page, 'e5'));
  const to = await centerOf(square(page, 'e4'));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await expect(page.locator('#board .ghost')).toBeVisible();

  await playOpponentMove(page, 'd4', 'e5');
  await expect(page.locator('#board .ghost')).toBeHidden();
  await page.mouse.up();

  await expect(page.locator('#moves li')).toHaveText(['dxe5']);
});

test('keeps a piece chosen while waiting so the reply is one tap away', async ({ page }) => {
  await controlBoard(page, { disabled: true, player: 'black' });

  await square(page, 'e7').click();
  await expect(square(page, 'e7')).toHaveAttribute('aria-selected', 'true');

  await playOpponentMove(page, 'e2', 'e4');
  await expect(square(page, 'e7')).toHaveAttribute('aria-selected', 'true');
  await square(page, 'e5').click();

  await expect(page.locator('#moves li')).toHaveText(['e4', 'e5']);
});

test('offers a grab cursor for the pieces that stay pickable while waiting', async ({ page }) => {
  await controlBoard(page, { disabled: true, player: 'black' });

  await expect(square(page, 'e7')).toHaveCSS('cursor', 'grab');
  await expect(square(page, 'e2')).toHaveCSS('cursor', 'default');

  const from = await centerOf(square(page, 'e7'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 40);

  await expect(square(page, 'e7')).toHaveCSS('cursor', 'grabbing');
  await expect(square(page, 'e2')).toHaveCSS('cursor', 'grabbing');
  await page.mouse.up();
});

function square(page: import('@playwright/test').Page, name: string) {
  return page.locator(`#board [data-square="${name}"]`);
}

async function centerOf(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('board square is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function touchTap(
  cdp: import('@playwright/test').CDPSession,
  point: { x: number; y: number },
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [point], type: 'touchStart' });
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
}

async function drawArrow(
  page: import('@playwright/test').Page,
  from: string,
  to: string,
): Promise<void> {
  const source = await square(page, from).boundingBox();
  const target = await square(page, to).boundingBox();
  if (!source || !target) throw new Error('board square is not visible');

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.up({ button: 'right' });
}

async function controlBoard(
  page: import('@playwright/test').Page,
  update: { disabled?: boolean; player?: 'white' | 'black' },
): Promise<void> {
  await page.evaluate((value) => {
    const controller = (
      window as typeof window & {
        gameBoard: { board: { update(update: Record<string, unknown>): void } };
      }
    ).gameBoard;
    controller.board.update(value);
  }, update);
}

async function playOpponentMove(
  page: import('@playwright/test').Page,
  from: string,
  to: string,
): Promise<void> {
  await page.evaluate(
    (move) => {
      const controller = (
        window as typeof window & {
          gameBoard: { move(move: { from: string; to: string }): void };
        }
      ).gameBoard;
      controller.move(move);
    },
    { from, to },
  );
}
