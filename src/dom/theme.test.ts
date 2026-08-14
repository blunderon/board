import { describe, expect, test } from 'bun:test';
import { DEFAULT_THEME, mergeTheme, type PieceTheme } from './theme.js';

describe('board themes', () => {
  test('uses a complete attractive theme without configuration', () => {
    expect(DEFAULT_THEME.lightSquare).toMatch(/^#/);
    expect(DEFAULT_THEME.darkSquare).toMatch(/^#/);
    expect(DEFAULT_THEME.focus).not.toBe(DEFAULT_THEME.selected);
    expect(DEFAULT_THEME.annotation).toMatch(/^#/);
  });

  test('overrides only the requested colors', () => {
    const theme = mergeTheme({ lightSquare: '#fff', darkSquare: '#222' });

    expect(theme.lightSquare).toBe('#fff');
    expect(theme.darkSquare).toBe('#222');
    expect(theme.selected).toBe(DEFAULT_THEME.selected);
  });

  test('supports a custom piece set through one obvious function', () => {
    const pieces: PieceTheme = (piece) => `/wood/${piece.color}-${piece.type}.svg`;

    expect(pieces({ color: 'black', type: 'knight' })).toBe('/wood/black-knight.svg');
  });
});
