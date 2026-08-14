import { defaultPieces } from '@blunderon/board/dom';

for (const color of ['white', 'black'] as const) {
  for (const type of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const) {
    console.log(defaultPieces({ color, type }));
  }
}
