import type { Square } from '../shared.js';

export type Destinations = ReadonlyMap<Square, readonly Square[]>;

export type SelectionResult =
  | { readonly type: 'selected'; readonly square: Square }
  | { readonly type: 'move'; readonly from: Square; readonly to: Square }
  | { readonly type: 'cleared' };

/** Tap and keyboard selection with no DOM or chess-rule dependency. */
export class Selection {
  private selected: Square | null = null;

  get square(): Square | null {
    return this.selected;
  }

  activate(square: Square, destinations: Destinations): SelectionResult {
    if (this.selected && destinations.get(this.selected)?.includes(square)) {
      const from = this.selected;
      this.selected = null;
      return { type: 'move', from, to: square };
    }

    if (destinations.has(square)) {
      this.selected = square;
      return { type: 'selected', square };
    }

    this.selected = null;
    return { type: 'cleared' };
  }

  clear(): void {
    this.selected = null;
  }
}
