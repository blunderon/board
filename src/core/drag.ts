/** DOM-free pointer-drag state and ghost positioning. */
import type { Square } from '../shared.js';

/** A pointer position in client coordinates, which is what a PointerEvent reports. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The board rectangle used to position a dragged piece. */
export interface BoardBox {
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

/** Travel required before a press becomes a drag rather than a tap. */
export const DRAG_THRESHOLD_PX = 6;

/** How far apart two points are, in the straight line a finger actually travels. */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Whether a pointer travelled far enough to become a drag instead of a tap or long-press. */
export function pointerMoved(from: Point, to: Point): boolean {
  return distance(from, to) >= DRAG_THRESHOLD_PX;
}

/** Positions a drag ghost while keeping touch feedback visible above the finger. */
export function ghostTransform(pointer: Point, board: BoardBox, pointerType = 'mouse'): string {
  const squareSize = board.size / 8;
  const touch = pointerType === 'touch';
  const ghostSize = squareSize * (touch ? 1.5 : 1);
  const x = pointer.x - board.left - ghostSize / 2;
  const y = pointer.y - board.top - ghostSize / 2 - (touch ? squareSize : 0);
  const transform = `transform: translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;

  return touch
    ? `width: ${ghostSize.toFixed(2)}px; height: ${ghostSize.toFixed(2)}px; ${transform}`
    : transform;
}

/** One DOM-free press-to-release gesture. */
export class DragSession {
  private origin: { square: Square; at: Point } | null = null;
  private active = false;

  press(square: Square, at: Point): void {
    this.origin = { square, at };
    this.active = false;
  }

  /** Whether a piece is currently in the air, which is the only thing the ghost is shown for. */
  get dragging(): boolean {
    return this.active;
  }

  /** The square the piece was picked up from, or null when nothing is pressed. */
  get from(): Square | null {
    return this.origin?.square ?? null;
  }

  /** Promotes the press to a drag after the movement threshold. */
  moved(to: Point): boolean {
    if (this.origin === null) return false;

    if (!this.active && pointerMoved(this.origin.at, to)) this.active = true;
    return this.active;
  }

  /** Returns the origin of a completed drag, or null for a tap. */
  release(): Square | null {
    const dragged = this.active ? (this.origin?.square ?? null) : null;
    this.cancel();
    return dragged;
  }

  /** Drops all gesture state without producing a move. */
  cancel(): void {
    this.origin = null;
    this.active = false;
  }
}
