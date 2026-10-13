import { expect, test } from 'bun:test';
import { describeSquareState, type SquareState } from './description.js';

const idle: SquareState = {
  lastMove: null,
  checkedKing: null,
  legalDestinations: [],
  heldPiece: null,
  dropTarget: null,
  annotationFrom: null,
  annotationTo: null,
};

test('describes last move endpoints, check and legal destinations together', () => {
  const state: SquareState = {
    ...idle,
    lastMove: ['e2', 'e4'],
    checkedKing: 'e4',
    legalDestinations: ['e4'],
  };
  expect(describeSquareState('e2', state)).toBe('last move');
  expect(describeSquareState('e4', state)).toBe('last move, check, legal destination');
  expect(describeSquareState('d4', state)).toBe('');
});

test('describes held pieces and drop targets only while dragging', () => {
  const state: SquareState = { ...idle, heldPiece: 'e2', dropTarget: 'e4' };
  expect(describeSquareState('e2', state)).toBe('held piece');
  expect(describeSquareState('e4', state)).toBe('drop target');
  expect(describeSquareState('e2', idle)).toBe('');
  expect(describeSquareState('e4', idle)).toBe('');
});

test('describes highlight and arrow previews at their endpoints', () => {
  const state: SquareState = { ...idle, annotationFrom: 'e2', annotationTo: 'e2' };
  expect(describeSquareState('e2', state)).toBe('highlight preview');
  expect(describeSquareState('d2', state)).toBe('');
  const arrow = { ...state, annotationTo: 'e4' as const };
  expect(describeSquareState('e2', arrow)).toBe('arrow preview to e4');
  expect(describeSquareState('e4', arrow)).toBe('arrow preview from e2');
  expect(describeSquareState('e3', arrow)).toBe('');
  expect(describeSquareState('e2', { ...state, annotationTo: null })).toBe('');
  expect(describeSquareState('e2', idle)).toBe('');
});
