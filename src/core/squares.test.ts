import { expect, test } from 'bun:test';
import { boardRows, squareShade } from './squares.js';

test('orients the grid from either side', () => {
  expect(boardRows('white')[0]?.squares[0]).toBe('a8');
  expect(boardRows('black')[0]?.squares[0]).toBe('h1');
});

test('uses standard square shades', () => {
  expect(squareShade('a1')).toBe('dark');
  expect(squareShade('h1')).toBe('light');
});
