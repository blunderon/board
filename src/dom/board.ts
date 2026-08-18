import {
  boardRows,
  type Destinations,
  DragSession,
  describeSquare,
  ghostTransform,
  nextSquare,
  type Point,
  parsePieces,
  pointerMoved,
  Selection,
  squareShade,
} from '../core/index.js';
import type { BoardArrow, Color, Piece, Promotion, Square, SquareHighlight } from '../shared.js';
import { BOARD_STYLES } from './styles.js';
import { type BoardTheme, mergeTheme, type ThemeOptions } from './theme.js';

const PROMOTIONS: readonly Promotion[] = ['queen', 'rook', 'bishop', 'knight'];
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const LONG_PRESS_MS = 500;

export type { BoardArrow, SquareHighlight } from '../shared.js';

export type BoardAnnotationIntent =
  | { readonly type: 'highlight'; readonly square: Square }
  | { readonly type: 'arrow'; readonly from: Square; readonly to: Square };

export interface BoardOptions {
  readonly fen: string;
  readonly orientation?: Color;
  readonly legalMoves?: Destinations;
  readonly lastMove?: readonly [Square, Square] | null;
  readonly checkedKing?: Square | null;
  readonly coordinates?: boolean;
  readonly disabled?: boolean;
  readonly highlights?: readonly SquareHighlight[];
  readonly arrows?: readonly BoardArrow[];
  readonly theme?: ThemeOptions;
  readonly onMove?: (from: Square, to: Square, promotion?: Promotion) => void;
  readonly onSelect?: (square: Square | null) => void;
  readonly onAnnotate?: (intent: BoardAnnotationIntent) => void;
}

export type BoardUpdate = Partial<BoardOptions>;

export interface BoardController {
  update(update: BoardUpdate): void;
  focus(square?: Square): void;
  announce(message: string): void;
  destroy(): void;
}

interface State {
  fen: string;
  orientation: Color;
  legalMoves: Destinations;
  lastMove: readonly [Square, Square] | null;
  checkedKing: Square | null;
  coordinates: boolean;
  disabled: boolean;
  highlights: readonly SquareHighlight[];
  arrows: readonly BoardArrow[];
  theme: BoardTheme;
  onMove?: BoardOptions['onMove'];
  onSelect?: BoardOptions['onSelect'];
  onAnnotate?: BoardOptions['onAnnotate'];
}

/** Creates a dependency-free chess board in the supplied element. */
export function createBoard(element: HTMLElement, options: BoardOptions): BoardController {
  return new DomBoard(element, options);
}

class DomBoard implements BoardController {
  private readonly shadow: ShadowRoot;
  private readonly frame: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly annotations: SVGSVGElement;
  private readonly dragTargetHint: HTMLElement;
  private readonly ghost: HTMLImageElement;
  private readonly promotion: HTMLElement;
  private readonly live: HTMLElement;
  private readonly squares = new Map<Square, HTMLButtonElement>();
  private readonly selection = new Selection();
  private readonly drag = new DragSession();
  private readonly events = new AbortController();
  private state: State;
  private pieces: ReadonlyMap<Square, Piece>;
  private focusSquare: Square = 'a1';
  private suppressClick = false;
  private cancelPendingPromotion: (() => void) | null = null;
  private annotationFrom: Square | null = null;
  private annotationTo: Square | null = null;
  private touchAnnotation: {
    readonly origin: Point;
    readonly timer: number;
  } | null = null;
  private dragTarget: Square | null = null;

  constructor(element: HTMLElement, options: BoardOptions) {
    this.state = stateFromOptions(options);
    this.pieces = parsePieces(options.fen);
    this.shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    this.shadow.replaceChildren();

    const style = document.createElement('style');
    style.textContent = BOARD_STYLES;
    this.frame = elementOf('div', 'frame');
    this.grid = elementOf('div', 'grid');
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', 'Chess board');
    this.annotations = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.annotations.classList.add('annotations');
    this.annotations.setAttribute('viewBox', '0 0 8 8');
    this.annotations.setAttribute('aria-hidden', 'true');
    this.dragTargetHint = elementOf('div', 'drag-target');
    this.dragTargetHint.setAttribute('aria-hidden', 'true');
    this.ghost = document.createElement('img');
    this.ghost.className = 'ghost';
    this.ghost.alt = '';
    this.ghost.setAttribute('aria-hidden', 'true');
    this.promotion = this.createPromotionPicker();
    this.live = elementOf('div', 'sr-only');
    this.live.setAttribute('aria-live', 'polite');

    this.frame.append(
      this.grid,
      this.dragTargetHint,
      this.annotations,
      this.ghost,
      this.promotion,
      this.live,
    );
    this.shadow.append(style, this.frame);
    this.bindEvents();
    this.renderGrid();
    this.patch();
  }

  update(update: BoardUpdate): void {
    if (update.fen !== undefined || update.legalMoves !== undefined || update.disabled === true) {
      this.cancelPendingPromotion?.();
      this.cancelAnnotationGesture();
      if (this.drag.from !== null) {
        this.suppressClick = true;
        this.cancelDrag();
      }
    }
    if (update.fen !== undefined && this.selection.square !== null) {
      this.selection.clear();
      this.state.onSelect?.(null);
    }
    const orientationChanged =
      update.orientation !== undefined && update.orientation !== this.state.orientation;
    this.state = {
      ...this.state,
      ...update,
      theme: update.theme ? mergeTheme({ ...this.state.theme, ...update.theme }) : this.state.theme,
    };
    if (update.fen !== undefined) this.pieces = parsePieces(update.fen);
    if (this.state.disabled) this.selection.clear();
    if (orientationChanged) this.renderGrid();
    this.patch();
  }

  focus(square = this.focusSquare): void {
    this.setFocus(square, true);
  }

  announce(message: string): void {
    this.live.textContent = '';
    queueMicrotask(() => {
      this.live.textContent = message;
    });
  }

  destroy(): void {
    this.cancelPendingPromotion?.();
    this.cancelAnnotationGesture();
    this.events.abort();
    this.shadow.replaceChildren();
    this.squares.clear();
  }

  private renderGrid(): void {
    this.grid.replaceChildren();
    this.squares.clear();
    const rows = boardRows(this.state.orientation);

    for (const row of rows) {
      const rowElement = elementOf('div', 'row');
      rowElement.setAttribute('role', 'row');
      for (const [column, square] of row.squares.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `square ${squareShade(square)}`;
        button.dataset.square = square;
        button.setAttribute('role', 'gridcell');

        const image = document.createElement('img');
        image.className = 'piece';
        image.alt = '';
        image.draggable = false;
        const file = elementOf('span', 'coordinate file');
        file.textContent = square[0] ?? '';
        const rank = elementOf('span', 'coordinate rank');
        rank.textContent = square[1] ?? '';
        if (row !== rows[7]) file.hidden = true;
        if (column !== 0) rank.hidden = true;

        button.append(image, file, rank);
        rowElement.append(button);
        this.squares.set(square, button);
      }
      this.grid.append(rowElement);
    }
  }

  private patch(): void {
    this.applyTheme();
    this.renderAnnotations();
    const selected = this.selection.square;
    const moveSource = selected ?? (this.drag.dragging ? this.drag.from : null);
    const targets = moveSource ? (this.state.legalMoves.get(moveSource) ?? []) : [];
    const checkedKing = this.state.checkedKing;

    for (const [square, button] of this.squares) {
      const piece = this.pieces.get(square) ?? null;
      const image = button.querySelector<HTMLImageElement>('.piece');
      if (!image) continue;

      const last = this.state.lastMove?.includes(square) ?? false;
      button.className = `square ${squareShade(square)}${last ? ' last-move' : ''}${
        selected === square ? ' selected' : ''
      }${checkedKing === square ? ' check' : ''}`;
      const annotation = this.state.highlights.find((highlight) => highlight.square === square);
      const label = describeSquare(piece, square);
      const arrowLabels = this.state.arrows.flatMap((arrow) => {
        if (arrow.from === square) return [arrow.label ?? `arrow to ${arrow.to}`];
        if (arrow.to === square) return [arrow.label ?? `arrow from ${arrow.from}`];
        return [];
      });
      const labels = [
        annotation ? (annotation.label ?? 'highlighted') : undefined,
        ...arrowLabels,
      ].filter(Boolean);
      button.setAttribute(
        'aria-label',
        labels.length > 0 ? `${label}, ${labels.join(', ')}` : label,
      );
      button.setAttribute('aria-selected', String(selected === square));
      button.tabIndex = square === this.focusSquare ? 0 : -1;
      button.setAttribute('aria-disabled', String(this.state.disabled));
      button.dataset.empty = String(piece === null);
      button.dataset.movable = String(!this.state.disabled && this.state.legalMoves.has(square));
      button.dataset.dragSource = String(this.drag.dragging && this.drag.from === square);
      button.dataset.dropTarget = String(this.dragTarget === square);
      button.dataset.legalDestination = targets.includes(square)
        ? piece
          ? 'occupied'
          : 'empty'
        : 'false';
      if (piece) image.src = this.state.theme.pieces(piece);
      else image.removeAttribute('src');
      image.hidden = piece === null;

      for (const coordinate of button.querySelectorAll<HTMLElement>('.coordinate')) {
        coordinate.style.display = this.state.coordinates ? '' : 'none';
      }
    }
  }

  private applyTheme(): void {
    const variables = {
      '--board-light': this.state.theme.lightSquare,
      '--board-dark': this.state.theme.darkSquare,
      '--board-selected': this.state.theme.selected,
      '--board-legal': this.state.theme.legalMove,
      '--board-last': this.state.theme.lastMove,
      '--board-check': this.state.theme.check,
      '--board-focus': this.state.theme.focus,
      '--board-annotation': this.state.theme.annotation,
    };
    for (const [name, value] of Object.entries(variables))
      this.frame.style.setProperty(name, value);

    for (const [square, button] of this.squares) {
      button.style.setProperty(
        '--base',
        squareShade(square) === 'light'
          ? this.state.theme.lightSquare
          : this.state.theme.darkSquare,
      );
    }
  }

  private renderAnnotations(): void {
    this.annotations.replaceChildren();

    for (const highlight of this.state.highlights) {
      this.renderHighlight(highlight);
    }

    for (const arrow of this.state.arrows) this.renderArrow(arrow);

    if (this.annotationFrom && this.annotationTo) {
      if (this.annotationFrom === this.annotationTo) {
        this.renderHighlight({ square: this.annotationFrom }, true);
      } else {
        this.renderArrow({ from: this.annotationFrom, to: this.annotationTo }, true);
      }
    }
  }

  private renderHighlight(highlight: SquareHighlight, preview = false): void {
    const point = displayPoint(highlight.square, this.state.orientation);
    const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
    if (preview) rectangle.dataset.annotationPreview = highlight.square;
    else rectangle.dataset.highlight = highlight.square;
    rectangle.setAttribute('x', String(point.x - 0.5));
    rectangle.setAttribute('y', String(point.y - 0.5));
    rectangle.setAttribute('width', '1');
    rectangle.setAttribute('height', '1');
    rectangle.setAttribute('rx', '0.12');
    rectangle.setAttribute('fill', highlight.color ?? this.state.theme.annotation);
    rectangle.setAttribute('fill-opacity', preview ? '0.3' : '0.42');
    this.annotations.append(rectangle);
  }

  private renderArrow(arrow: BoardArrow, preview = false): void {
    if (arrow.from === arrow.to) return;
    const from = displayPoint(arrow.from, this.state.orientation);
    const to = displayPoint(arrow.to, this.state.orientation);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
    const tip = { x: to.x - unit.x * 0.18, y: to.y - unit.y * 0.18 };
    const base = { x: tip.x - unit.x * 0.48, y: tip.y - unit.y * 0.48 };
    const perpendicular = { x: -unit.y * 0.25, y: unit.x * 0.25 };
    const color = arrow.color ?? this.state.theme.annotation;
    const opacity = preview ? 0.65 : arrow.opacity;

    const line = document.createElementNS(SVG_NAMESPACE, 'line');
    if (preview) line.dataset.annotationPreview = `${arrow.from}${arrow.to}`;
    else line.dataset.arrow = `${arrow.from}${arrow.to}`;
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(base.x + unit.x * 0.1));
    line.setAttribute('y2', String(base.y + unit.y * 0.1));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '0.18');
    line.setAttribute('stroke-linecap', 'round');
    if (opacity !== undefined) line.setAttribute('stroke-opacity', String(opacity));

    const head = document.createElementNS(SVG_NAMESPACE, 'polygon');
    head.setAttribute(
      'points',
      `${tip.x},${tip.y} ${base.x + perpendicular.x},${base.y + perpendicular.y} ${
        base.x - perpendicular.x
      },${base.y - perpendicular.y}`,
    );
    head.setAttribute('fill', color);
    if (opacity !== undefined) head.setAttribute('fill-opacity', String(opacity));
    this.annotations.append(line, head);
  }

  private bindEvents(): void {
    const signal = this.events.signal;
    this.grid.addEventListener('click', (event) => this.onClick(event), { signal });
    this.grid.addEventListener('keydown', (event) => this.onKeyDown(event), { signal });
    this.grid.addEventListener('focusin', (event) => this.onFocus(event), { signal });
    this.grid.addEventListener('pointerdown', (event) => this.onPointerDown(event), { signal });
    this.grid.addEventListener('pointermove', (event) => this.onPointerMove(event), { signal });
    this.grid.addEventListener('pointerup', (event) => this.onPointerUp(event), { signal });
    this.grid.addEventListener(
      'pointercancel',
      () => {
        this.cancelAnnotationGesture();
        this.cancelDrag();
      },
      { signal },
    );
    this.grid.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
  }

  private onClick(event: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const square = squareFromEvent(event);
    if (square) void this.activate(square);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const square = squareFromEvent(event);
    if (!square) return;

    const next = nextSquare(square, event.key, this.state.orientation);
    if (next) {
      event.preventDefault();
      this.setFocus(next, true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void this.activate(square);
    } else if (event.key === 'Escape') {
      this.selection.clear();
      this.state.onSelect?.(null);
      this.patch();
    }
  }

  private onFocus(event: FocusEvent): void {
    const square = squareFromEvent(event);
    if (square) this.setFocus(square, false);
  }

  private onPointerDown(event: PointerEvent): void {
    const square = squareFromEvent(event);
    if (!square || this.state.disabled) return;
    if (event.button === 2) {
      event.preventDefault();
      this.annotationFrom = square;
      this.annotationTo = square;
      (event.target as Element).setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.pointerType === 'touch') {
      if (this.state.legalMoves.has(square)) {
        this.drag.press(square, { x: event.clientX, y: event.clientY });
      }
      this.startTouchAnnotation(square, event);
      return;
    }
    if (!this.state.legalMoves.has(square)) return;
    this.drag.press(square, { x: event.clientX, y: event.clientY });
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    if (
      this.touchAnnotation &&
      !pointerMoved(this.touchAnnotation.origin, {
        x: event.clientX,
        y: event.clientY,
      })
    ) {
      return;
    }
    if (this.touchAnnotation) this.clearTouchAnnotation();
    if (this.annotationFrom) {
      event.preventDefault();
      const hit = this.shadow.elementFromPoint(event.clientX, event.clientY);
      this.annotationTo = squareFromElement(hit);
      this.renderAnnotations();
      return;
    }
    if (!this.drag.moved({ x: event.clientX, y: event.clientY })) return;
    event.preventDefault();
    const box = this.frame.getBoundingClientRect();
    this.ghost.style.cssText = ghostTransform(
      { x: event.clientX, y: event.clientY },
      { left: box.left, top: box.top, size: box.width },
      event.pointerType,
    );
    const piece = this.drag.from ? this.pieces.get(this.drag.from) : null;
    if (piece) this.ghost.src = this.state.theme.pieces(piece);
    this.frame.dataset.dragging = 'true';
    this.frame.dataset.dragPointer = event.pointerType;
    this.updateDragTarget(event);
    this.patch();
  }

  private onPointerUp(event: PointerEvent): void {
    this.clearTouchAnnotation();
    if (this.annotationFrom) {
      const from = this.annotationFrom;
      const fallback = this.annotationTo;
      this.annotationFrom = null;
      this.annotationTo = null;
      const hit = this.shadow.elementFromPoint(event.clientX, event.clientY);
      const to = squareFromElement(hit) ?? fallback;
      if (to) {
        this.state.onAnnotate?.(
          from === to ? { type: 'highlight', square: from } : { type: 'arrow', from, to },
        );
      }
      this.renderAnnotations();
      return;
    }
    const from = this.drag.release();
    if (!from) return;
    this.suppressClick = true;
    const hit = this.shadow.elementFromPoint(event.clientX, event.clientY);
    const to = squareFromElement(hit);
    if (!this.state.disabled && to && this.state.legalMoves.get(from)?.includes(to)) {
      void this.play(from, to);
    }
    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.drag.cancel();
    this.dragTarget = null;
    this.frame.dataset.dragging = 'false';
    delete this.frame.dataset.dragPointer;
    this.dragTargetHint.removeAttribute('style');
    this.ghost.removeAttribute('style');
    this.patch();
  }

  private startTouchAnnotation(square: Square, event: PointerEvent): void {
    this.clearTouchAnnotation();
    const origin = { x: event.clientX, y: event.clientY };
    const timer = window.setTimeout(() => {
      this.touchAnnotation = null;
      this.annotationFrom = square;
      this.annotationTo = square;
      this.suppressClick = true;
      this.cancelDrag();
    }, LONG_PRESS_MS);
    this.touchAnnotation = { origin, timer };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  private clearTouchAnnotation(): void {
    if (!this.touchAnnotation) return;
    window.clearTimeout(this.touchAnnotation.timer);
    this.touchAnnotation = null;
  }

  private cancelAnnotationGesture(): void {
    this.clearTouchAnnotation();
    this.annotationFrom = null;
    this.annotationTo = null;
  }

  private updateDragTarget(event: PointerEvent): void {
    const from = this.drag.from;
    const hit = this.shadow.elementFromPoint(event.clientX, event.clientY);
    const hovered = squareFromElement(hit);
    const target =
      from && hovered && this.state.legalMoves.get(from)?.includes(hovered) ? hovered : null;
    this.dragTarget = target;
    if (!target) {
      this.dragTargetHint.removeAttribute('style');
      return;
    }

    const frameBox = this.frame.getBoundingClientRect();
    const targetBox = this.squares.get(target)?.getBoundingClientRect();
    if (!targetBox) return;
    this.dragTargetHint.style.cssText = [
      `left: ${(targetBox.left - frameBox.left - targetBox.width / 2).toFixed(2)}px`,
      `top: ${(targetBox.top - frameBox.top - targetBox.height / 2).toFixed(2)}px`,
      `width: ${(targetBox.width * 2).toFixed(2)}px`,
      `height: ${(targetBox.height * 2).toFixed(2)}px`,
    ].join('; ');
  }

  private async activate(square: Square): Promise<void> {
    if (this.state.disabled) return;
    const result = this.selection.activate(square, this.state.legalMoves);
    this.state.onSelect?.(this.selection.square);
    this.patch();
    if (result.type === 'move') await this.play(result.from, result.to);
  }

  private async play(from: Square, to: Square): Promise<void> {
    if (this.state.disabled || !this.state.legalMoves.get(from)?.includes(to)) return;
    this.cancelPendingPromotion?.();
    const piece = this.pieces.get(from);
    const promotion =
      piece?.type === 'pawn' && (to[1] === '1' || to[1] === '8')
        ? await this.choosePromotion(piece.color)
        : undefined;
    if (promotion === null) return;
    this.state.onMove?.(from, to, promotion);
  }

  private choosePromotion(color: Color): Promise<Promotion | null> {
    this.promotion.hidden = false;
    const buttons = this.promotion.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) {
      const type = button.dataset.promotion as Promotion;
      const image = button.querySelector<HTMLImageElement>('img');
      if (image) image.src = this.state.theme.pieces({ color, type });
    }
    buttons[0]?.focus();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (choice: Promotion | null, restoreFocus = true): void => {
        if (settled) return;
        settled = true;
        this.cancelPendingPromotion = null;
        this.promotion.hidden = true;
        this.promotion.removeEventListener('click', click);
        this.promotion.removeEventListener('keydown', keydown);
        if (restoreFocus && this.shadow.host.isConnected) this.focus();
        resolve(choice);
      };
      const click = (event: Event): void => {
        const button = (event.target as Element).closest<HTMLButtonElement>('button');
        if (button) finish(button.dataset.promotion as Promotion);
      };
      const keydown = (event: Event): void => {
        const key = event as KeyboardEvent;
        if (key.key === 'Escape') {
          finish(null);
          return;
        }
        if (key.key !== 'Tab') return;

        key.preventDefault();
        const choices = Array.from(buttons);
        const current = choices.indexOf(this.shadow.activeElement as HTMLButtonElement);
        const direction = key.shiftKey ? -1 : 1;
        const next = (current + direction + choices.length) % choices.length;
        choices[next]?.focus();
      };
      this.cancelPendingPromotion = () => finish(null, false);
      this.promotion.addEventListener('click', click);
      this.promotion.addEventListener('keydown', keydown);
    });
  }

  private createPromotionPicker(): HTMLElement {
    const overlay = elementOf('div', 'promotion');
    overlay.hidden = true;
    const panel = elementOf('div', 'promotion-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose promotion piece');
    panel.setAttribute('aria-modal', 'true');
    for (const type of PROMOTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.promotion = type;
      button.setAttribute('aria-label', `Promote to ${type}`);
      const image = document.createElement('img');
      image.alt = '';
      button.append(image);
      panel.append(button);
    }
    overlay.append(panel);
    return overlay;
  }

  private setFocus(square: Square, moveFocus: boolean): void {
    this.focusSquare = square;
    for (const [name, button] of this.squares) button.tabIndex = name === square ? 0 : -1;
    if (moveFocus) this.squares.get(square)?.focus();
  }
}

function stateFromOptions(options: BoardOptions): State {
  return {
    fen: options.fen,
    orientation: options.orientation ?? 'white',
    legalMoves: options.legalMoves ?? new Map(),
    lastMove: options.lastMove ?? null,
    checkedKing: options.checkedKing ?? null,
    coordinates: options.coordinates ?? true,
    disabled: options.disabled ?? false,
    highlights: options.highlights ?? [],
    arrows: options.arrows ?? [],
    theme: mergeTheme(options.theme),
    ...(options.onMove ? { onMove: options.onMove } : {}),
    ...(options.onSelect ? { onSelect: options.onSelect } : {}),
    ...(options.onAnnotate ? { onAnnotate: options.onAnnotate } : {}),
  };
}

function displayPoint(square: Square, orientation: Color): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return orientation === 'white'
    ? { x: file + 0.5, y: 7.5 - rank }
    : { x: 7.5 - file, y: rank + 0.5 };
}

function elementOf<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function squareFromEvent(event: Event): Square | null {
  return squareFromElement((event.target as Element).closest?.('[data-square]') ?? null);
}

function squareFromElement(element: Element | null): Square | null {
  const square = (element as HTMLElement | null)?.dataset.square;
  return square && /^[a-h][1-8]$/.test(square) ? (square as Square) : null;
}
