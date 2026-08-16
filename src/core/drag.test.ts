import { expect, test } from 'bun:test';
import { DragSession, ghostTransform, pointerMoved } from './drag.js';

test('recognizes movement at the shared pointer gesture threshold', () => {
  expect(pointerMoved({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false);
  expect(pointerMoved({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(true);
});

test('lifts and enlarges a touch ghost without moving its drop point', () => {
  const board = { left: 0, size: 160, top: 0 };

  expect(ghostTransform({ x: 80, y: 80 }, board)).toBe('transform: translate(70.00px, 70.00px)');
  expect(ghostTransform({ x: 80, y: 80 }, board, 'touch')).toBe(
    'width: 30.00px; height: 30.00px; transform: translate(65.00px, 45.00px)',
  );
});

test('distinguishes a tap from a drag and cancels cleanly', () => {
  const drag = new DragSession();
  drag.press('e2', { x: 10, y: 10 });

  expect(drag.moved({ x: 12, y: 12 })).toBe(false);
  expect(drag.release()).toBeNull();

  drag.press('e2', { x: 10, y: 10 });
  expect(drag.moved({ x: 20, y: 10 })).toBe(true);
  expect(drag.release()).toBe('e2');
  expect(drag.dragging).toBe(false);
});
