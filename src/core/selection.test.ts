import { describe, expect, test } from 'bun:test';
import { Selection } from './selection.js';

describe('Selection', () => {
  test('selects a source and completes only a legal destination', () => {
    const selection = new Selection();
    const destinations = new Map([['e2' as const, ['e3' as const, 'e4' as const]]]);

    expect(selection.activate('e2', destinations)).toEqual({ type: 'selected', square: 'e2' });
    expect(selection.activate('e4', destinations)).toEqual({
      type: 'move',
      from: 'e2',
      to: 'e4',
    });
    expect(selection.square).toBeNull();
  });

  test('switches directly to another movable piece and clears on an illegal square', () => {
    const selection = new Selection();
    const destinations = new Map([
      ['b1' as const, ['a3' as const]],
      ['g1' as const, ['f3' as const]],
    ]);

    selection.activate('b1', destinations);
    expect(selection.activate('g1', destinations)).toEqual({ type: 'selected', square: 'g1' });
    expect(selection.activate('g4', destinations)).toEqual({ type: 'cleared' });
  });
});
