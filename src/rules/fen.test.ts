import { expect, test } from 'bun:test';
import { FenError, parseFen } from './fen.js';

test('rejects positions that cannot represent standard chess', () => {
  for (const fen of [
    '8/8/8/8/8/8/8/8 w - - 0 1',
    '4k3/8/8/8/8/8/4K3/4K3 w - - 0 1',
    'P3k3/8/8/8/8/8/8/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 0',
    '4k3/8/8/8/8/8/8/4K3 w - e3 0 1',
    '4k3/8/8/8/8/8/8/4K3 w K - 0 1',
    '4k3/4R3/8/8/8/8/8/4K3 w - - 0 1',
    '8/8/8/8/8/8/5kK1/8 w - - 0 1',
    '4k3/8/8/8/8/8/8/4K3 w - - 9007199254740991 1',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 9007199254740991',
  ]) {
    expect(() => parseFen(fen), fen).toThrow(FenError);
  }
});

test('accepts a valid en passant target even when no pawn can capture it', () => {
  expect(parseFen('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1').ep).not.toBe(-1);
});
