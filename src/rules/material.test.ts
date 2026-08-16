import { describe, expect, test } from 'bun:test';
import { materialBalance, Position } from './index.js';

describe('materialBalance', () => {
  test('reports equal material in the starting position', () => {
    expect(materialBalance(Position.initial())).toEqual({
      blackExtra: [],
      pointDifference: 0,
      whiteExtra: [],
    });
  });

  test('reports net extra pieces and conventional point difference', () => {
    const balance = materialBalance(Position.fromFen('4k3/8/8/8/8/8/P2BNR2/3QK3 w - - 0 1'));

    expect(balance).toEqual({
      blackExtra: [],
      pointDifference: 21,
      whiteExtra: ['queen', 'rook', 'bishop', 'knight', 'pawn'],
    });
  });

  test('shows both sides of an exchange without treating equal value as a lead', () => {
    const balance = materialBalance(Position.fromFen('4k3/8/8/8/8/8/2B5/3nK3 w - - 0 1'));

    expect(balance).toEqual({
      blackExtra: ['knight'],
      pointDifference: 0,
      whiteExtra: ['bishop'],
    });
  });

  test('returns immutable result data', () => {
    const balance = materialBalance(Position.fromFen('4k3/8/8/8/8/8/P7/4K3 w - - 0 1'));

    expect(() => Object.assign(balance, { pointDifference: 9 })).toThrow(TypeError);
    expect(() => (balance.whiteExtra as string[]).push('queen')).toThrow(TypeError);
  });
});
