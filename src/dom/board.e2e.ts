import { type AXHandle, snapshot as axSnapshot, find } from '@blunderon/ax';
import type { Page } from '@playwright/test';
import { expect, test } from '../../tests/fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/example/');
  await find(page, { role: 'grid', name: 'Chess board' });
});

test('plays a complete game by moving both colors on the board', async ({ page }) => {
  for (const [from, to] of [
    ['f2', 'f3'],
    ['e7', 'e5'],
    ['g2', 'g4'],
    ['d8', 'h4'],
  ]) {
    await (await square(page, from)).click();
    await (await square(page, to)).click();
  }

  await find(page, { role: 'StaticText', name: 'Checkmate — black wins' });
  await moves(page, ['f3', 'e5', 'g4', 'Qh4#']);
  await cellName(page, 'h4', 'h4, black queen');
  expect((await boardSnapshot(page)).match(/gridcell .*disabled=true/g)).toHaveLength(64);
});

test('supports keyboard movement and exposes a semantic 64-square grid', async ({ page }) => {
  expect(await page.evaluate(() => 'gameBoard' in window)).toBe(true);
  expect(
    await page.evaluate(
      () => 'game' in (window as typeof window & { gameBoard: Record<string, unknown> }).gameBoard,
    ),
  ).toBe(false);
  expect((await boardSnapshot(page)).match(/gridcell /g)).toHaveLength(64);
  expect(await boardSnapshot(page)).toMatchSnapshot('initial-grid.txt');
  await (await square(page, 'e2')).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');

  await cellName(page, 'e4', 'e4, white pawn');
  await find(page, { role: 'StaticText', name: 'Black to move' });
});

test('loads every bundled piece without remote requests', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) remoteRequests.push(request.url());
  });
  const sources = new Set<string>();
  page.on('request', (request) => {
    if (request.resourceType() === 'image') sources.add(request.url());
  });
  await page.reload();
  const pieces = await page.evaluate(
    async (urls) =>
      Promise.all(
        urls.map(
          (src) =>
            new Promise<{ src: string; width: number }>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve({ src, width: image.naturalWidth });
              image.onerror = () => reject(new Error(`Cannot load ${src}`));
              image.src = src;
            }),
        ),
      ),
    [...sources],
  );
  expect(pieces).toHaveLength(12);
  expect(pieces.every(({ src, width }) => !src.startsWith('data:') && width > 0)).toBe(true);
  expect(remoteRequests).toEqual([]);
});

test('drags through the same move path as click and keyboard', async ({ page }) => {
  await (await square(page, 'e2')).dragTo(await square(page, 'e4'));

  await cellName(page, 'e4', 'e4, white pawn');
  await moves(page, ['e4']);
});

test('marks the exact legal square under a drag at square boundaries', async ({ page }) => {
  const from = await (await square(page, 'e2')).box();
  const upper = await (await square(page, 'e4')).box();
  const lower = await (await square(page, 'e3')).box();
  if (!from || !upper || !lower) throw new Error('expected visible drag squares');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(upper.x + upper.width / 2, upper.y + upper.height - 1);
  await description(page, 'e4', 'drop target', true);
  await description(page, 'e3', 'drop target', false);

  await page.mouse.move(lower.x + lower.width / 2, lower.y + 1);
  await description(page, 'e4', 'drop target', false);
  await description(page, 'e3', 'drop target', true);
  await page.mouse.up();

  await cellName(page, 'e3', 'e3, white pawn');
  await moves(page, ['e3']);
});

test('keeps touch drag feedback visible above the finger and marks the drop square', async ({
  page,
}) => {
  const from = await (await square(page, 'e2')).box();
  const to = await (await square(page, 'e4')).box();
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

  await description(page, 'e4', 'drop target', true);
  await mechanicsScreenshot(page, 'touch-drag');

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await description(page, 'e4', 'drop target', false);
  await mechanicsScreenshot(page, 'touch-released');
  await cellName(page, 'e4', 'e4, white pawn');
});

test('keeps quick touch taps on the normal move path', async ({ page }) => {
  await page.clock.install();
  const cdp = await page.context().newCDPSession(page);

  await touchTap(cdp, await centerOf(await square(page, 'e2')));
  expect(await (await square(page, 'e2')).states()).toMatchObject({ selected: true });
  await touchTap(cdp, await centerOf(await square(page, 'e4')));

  await cellName(page, 'e4', 'e4, white pawn');
  await moves(page, ['e4']);
  await page.clock.fastForward(550);
  expect(await boardSnapshot(page)).not.toContain('preview');
});

test('uses a touch long-press to highlight a square or draw an arrow', async ({ page }) => {
  await page.clock.install();
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
  const d5 = await centerOf(await square(page, 'd5'));

  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [d5], type: 'touchStart' });
  await page.clock.fastForward(550);
  await description(page, 'd5', 'highlight preview');
  await mechanicsScreenshot(page, 'touch-highlight-preview');
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await cellName(page, 'd5', /highlighted/);

  const e2 = await centerOf(await square(page, 'e2'));
  const e4 = await centerOf(await square(page, 'e4'));
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [e2], type: 'touchStart' });
  await page.clock.fastForward(550);
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [e4], type: 'touchMove' });
  await description(page, 'e2', 'arrow preview to e4');
  await mechanicsScreenshot(page, 'touch-arrow-preview');
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });

  await cellName(page, 'e2', /arrow to e4/);
  await cellName(page, 'e2', /white pawn, arrow to e4/);
  await cellName(page, 'e4', 'e4, empty, arrow from e2');
  await moves(page, []);
});

test('does not restore the drag source before the controlled move callback', async ({ page }) => {
  await bindSource(page, await square(page, 'e2'));
  await page.evaluate(() => {
    const scope = window as typeof window & {
      sourceAtMove: Element;
      dragSourceAtMove?: string | null;
      gameBoard: {
        board: {
          update(update: { onMove(from: string, to: string, promotion?: string): void }): void;
        };
        move(move: { from: string; to: string; promotion?: string }): void;
      };
    };
    scope.gameBoard.board.update({
      onMove: (from, to, promotion) => {
        scope.dragSourceAtMove = scope.sourceAtMove.getAttribute('aria-description');
        scope.gameBoard.move({ from, to, ...(promotion ? { promotion } : {}) });
      },
    });
  });

  await (await square(page, 'e2')).dragTo(await square(page, 'e4'));

  expect(
    await page.evaluate(
      () => (window as typeof window & { dragSourceAtMove?: string | null }).dragSourceAtMove,
    ),
  ).toContain('held piece');
  await cellName(page, 'e4', 'e4, white pawn');
});

test('cancels a drag when controlled state disables the board', async ({ page }) => {
  const from = await (await square(page, 'e2')).box();
  const to = await (await square(page, 'e4')).box();
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

  await cellName(page, 'e2', 'e2, white pawn');
  await moves(page, []);
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

  await (await square(page, 'a7')).click();
  await (await square(page, 'a8')).click();
  await find(page, { role: 'dialog', name: 'Choose promotion piece' });
  await (await find(page, { role: 'button', name: 'Promote to knight' })).focus();
  await page.keyboard.press('Tab');
  expect(
    await (await find(page, { role: 'button', name: 'Promote to queen' })).states(),
  ).toMatchObject({ focused: true });
  await page.keyboard.press('Shift+Tab');
  expect(
    await (await find(page, { role: 'button', name: 'Promote to knight' })).states(),
  ).toMatchObject({ focused: true });
  await page.keyboard.press('Escape');
  expect(await axSnapshot(page)).not.toContain('dialog');
  await cellName(page, 'a7', 'a7, white pawn');

  await (await square(page, 'a7')).click();
  await (await square(page, 'a8')).click();
  await (await find(page, { role: 'button', name: 'Promote to queen' })).click();

  await cellName(page, 'a8', 'a8, white queen');
  await moves(page, ['a8=Q+']);
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
  await (await square(page, 'a7')).click();
  await (await square(page, 'a8')).click();
  await find(page, { role: 'dialog', name: 'Choose promotion piece' });

  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen?: string): void };
      }
    ).gameBoard;
    controller.reset();
  });

  expect(await axSnapshot(page)).not.toContain('dialog');
  await cellName(page, 'a7', 'a7, black pawn');
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
  await (await square(page, 'a7')).click();
  expect(await (await square(page, 'a7')).states()).toMatchObject({ selected: true });

  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        gameBoard: { reset(fen?: string): void };
      }
    ).gameBoard;
    controller.reset();
  });

  expect(await (await square(page, 'a7')).states()).toMatchObject({ selected: false });
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

  await cellName(page, 'g1', /arrow to f3/);
  await mechanicsScreenshot(page, 'controlled-annotations');
  await cellName(page, 'e4', /Critical/);

  await (await square(page, 'e2')).click();
  await (await square(page, 'e4')).click();
  await cellName(page, 'e4', /white pawn/);
});

test('restores a complete game snapshot and records an external ending', async ({ page }) => {
  await playOpponentMove(page, 'e2', 'e4');
  const snapshot = await page.evaluate(() => {
    const controller = (window as typeof window & { gameBoard: { snapshot(): unknown } }).gameBoard;
    return controller.snapshot();
  });
  await playOpponentMove(page, 'e7', 'e5');

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

  await cellName(page, 'e7', 'e7, black pawn');
  await find(page, { role: 'StaticText', name: 'White wins — timeout' });
  expect((await boardSnapshot(page)).match(/gridcell .*disabled=true/g)).toHaveLength(64);
  expect(await axSnapshot(page, await find(page, { role: 'main' }))).toMatchSnapshot(
    'restored-timeout.txt',
  );
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

  await find(page, { role: 'StaticText', name: 'Draw — timeout' });
  await find(page, {
    role: 'StaticText',
    name: 'Draw because the opponent has no mating material.',
  });
  expect(await axSnapshot(page, await find(page, { role: 'main' }))).toMatchSnapshot(
    'drawn-timeout.txt',
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

  await (await square(page, 'd2')).click();
  await (await square(page, 'd4')).click();
  await cellName(page, 'd2', 'd2, white pawn');

  await (await square(page, 'e2')).click();
  await (await square(page, 'e4')).click();
  await cellName(page, 'e4', 'e4, white pawn');
  await cellName(page, 'e5', 'e5, black pawn');

  await (await square(page, 'f1')).click();
  await (await square(page, 'c4')).click();
  await description(page, 'e5', 'last move');

  const snapshot = await page.evaluate(() => {
    const scope = window as typeof window & { puzzle: { snapshot(): unknown } };
    return JSON.parse(JSON.stringify(scope.puzzle.snapshot()));
  });

  await (await square(page, 'g1')).click();
  await (await square(page, 'f3')).click();
  expect((await boardSnapshot(page)).match(/gridcell .*disabled=true/g)).toHaveLength(64);

  await page.evaluate((saved) => {
    const scope = window as typeof window & { puzzle: { restore(snapshot: never): void } };
    scope.puzzle.restore(saved as never);
  }, snapshot);
  await cellName(page, 'g1', 'g1, white knight');
  expect((await (await square(page, 'g1')).states()).disabled ?? false).toBe(false);
  expect(await axSnapshot(page, await find(page, { role: 'main' }))).toMatchSnapshot(
    'restored-puzzle.txt',
  );
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

  await cellName(page, 'e4', 'e4, white pawn');
  expect((await (await square(page, 'e7')).states()).disabled ?? false).toBe(false);
  expect(await axSnapshot(page, await find(page, { role: 'main' }))).toMatchSnapshot(
    'opponent-first.txt',
  );
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

  await cellName(page, 'e5', 'e5, black pawn');
  await find(page, { role: 'StaticText', name: 'e5. Puzzle complete.' });
  expect(await axSnapshot(page, await find(page, { role: 'main' }))).toMatchSnapshot(
    'product-reply.txt',
  );
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

  await cellName(page, 'e4', /white pawn, Candidate/);
  await cellName(page, 'g1', /Develop the knight/);
  await cellName(page, 'g1', /Develop the knight/);

  expect(await boardSnapshot(page)).toMatchSnapshot('restored-analysis.txt');
  await drawArrow(page, 'e4', 'd5');
  await cellName(page, 'e4', /arrow to d5/);

  await (await square(page, 'd5')).click({ button: 'right' });
  await cellName(page, 'd5', /highlighted/);
  await cellName(page, 'd5', /highlighted/);

  // Drawings are scratch marks, so the next tap on the board wipes them.
  await (await square(page, 'e2')).click();
  expect(await axSnapshot(page, await square(page, 'e4'))).not.toContain('arrow to d5');
  expect(await axSnapshot(page, await square(page, 'd5'))).not.toContain('highlighted');
  expect(await axSnapshot(page, await square(page, 'g1'))).not.toContain('Develop the knight');

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

test('keeps the themed board within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const metrics = await page.evaluate(() => {
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  const board = await (await find(page, { role: 'grid', name: 'Chess board' })).box();
  expect(board.width).toBeGreaterThan(300);
  expect(board.width).toBeLessThanOrEqual(metrics.clientWidth - 32);
  expect(metrics.scrollWidth).toBe(metrics.clientWidth);
});

test('holds a piece picked up while the opponent is still thinking', async ({ page }) => {
  await controlBoard(page, { disabled: true, player: 'black' });
  const from = await centerOf(await square(page, 'e7'));
  const to = await centerOf(await square(page, 'e5'));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await description(page, 'e7', 'held piece');

  await playOpponentMove(page, 'e2', 'e4');
  await description(page, 'e7', 'held piece');
  await mechanicsScreenshot(page, 'held-after-opponent');
  await page.mouse.up();

  await moves(page, ['e4', 'e5']);
});

test('drops a held piece when the opponent takes it off its square', async ({ page }) => {
  await page.evaluate(() => {
    const controller = (window as typeof window & { gameBoard: { reset(fen: string): void } })
      .gameBoard;
    controller.reset('rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2');
  });
  await controlBoard(page, { disabled: true, player: 'black' });
  const from = await centerOf(await square(page, 'e5'));
  const to = await centerOf(await square(page, 'e4'));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await description(page, 'e5', 'held piece');
  await mechanicsScreenshot(page, 'held-before-capture');

  await playOpponentMove(page, 'd4', 'e5');
  await description(page, 'e5', 'held piece', false);
  await mechanicsScreenshot(page, 'held-captured');
  await page.mouse.up();

  await moves(page, ['dxe5']);
});

test('keeps a piece chosen while waiting so the reply is one tap away', async ({ page }) => {
  await controlBoard(page, { disabled: true, player: 'black' });

  await (await square(page, 'e7')).click();
  expect(await (await square(page, 'e7')).states()).toMatchObject({ selected: true });

  await playOpponentMove(page, 'e2', 'e4');
  expect(await (await square(page, 'e7')).states()).toMatchObject({ selected: true });
  await (await square(page, 'e5')).click();

  await moves(page, ['e4', 'e5']);
});

test('offers a grab cursor for the pieces that stay pickable while waiting', async ({ page }) => {
  await controlBoard(page, { disabled: true, player: 'black' });

  expect(await cursor(page, await square(page, 'e7'))).toBe('grab');
  expect(await cursor(page, await square(page, 'e2'))).toBe('default');

  const from = await centerOf(await square(page, 'e7'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 40);

  expect(await cursor(page, await square(page, 'e7'))).toBe('grabbing');
  expect(await cursor(page, await square(page, 'e2'))).toBe('grabbing');
  await page.mouse.up();
});

async function square(page: Page, name: string) {
  return find(page, { role: 'gridcell', name: new RegExp(`^${name},`) });
}

async function centerOf(handle: AXHandle) {
  const box = await handle.box();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function cellName(page: Page, squareName: string, name: string | RegExp) {
  const text = await axSnapshot(page, await square(page, squareName));
  if (typeof name === 'string') expect(text).toContain(`gridcell "${name}"`);
  else expect(text.split('\n')[0]).toMatch(name);
}

async function boardSnapshot(page: Page) {
  return axSnapshot(page, await find(page, { role: 'grid', name: 'Chess board' }));
}

async function description(page: Page, name: string, description: string, present = true) {
  const text = await axSnapshot(page, await square(page, name));
  if (present) expect(text).toContain(description);
  else expect(text).not.toContain(description);
}

async function moves(page: Page, expected: string[]) {
  const text = await axSnapshot(page, await find(page, { role: 'list' }));
  expect([...text.matchAll(/StaticText "(.*)"/g)].map((match) => match[1])).toEqual(expected);
}

async function mechanicsScreenshot(page: Page, name: string) {
  if (process.env.PLAYWRIGHT_DOCKER === '1') await expect(page).toHaveScreenshot(`${name}.png`);
}

async function cursor(page: Page, handle: AXHandle) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: handle.backendNodeId });
    const { result } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { return getComputedStyle(this).cursor; }',
      returnByValue: true,
    });
    return result.value;
  } finally {
    await cdp.detach();
  }
}

async function bindSource(page: Page, handle: AXHandle) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: handle.backendNodeId });
    await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function() { window.sourceAtMove = this; }',
    });
  } finally {
    await cdp.detach();
  }
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
  const source = await (await square(page, from)).box();
  const target = await (await square(page, to)).box();
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
