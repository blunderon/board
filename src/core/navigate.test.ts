import { expect, test } from 'bun:test';
import { nextSquare } from './navigate.js';

test('navigates from either orientation and clamps at an edge', () => {
  expect(nextSquare('e4', 'ArrowUp', 'white')).toBe('e5');
  expect(nextSquare('e4', 'ArrowUp', 'black')).toBe('e3');
  expect(nextSquare('a1', 'ArrowLeft', 'white')).toBe('a1');
});
