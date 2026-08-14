import { expect, test } from 'bun:test';
import { DragSession } from './drag.js';

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
