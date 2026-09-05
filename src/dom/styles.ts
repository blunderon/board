export const BOARD_STYLES = `
  :host {
    display: block;
    width: min(100%, 42rem);
    color: #201a17;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  * { box-sizing: border-box; }

  .frame {
    position: relative;
    overflow: visible;
    width: 100%;
    aspect-ratio: 1;
    border: 0.375rem solid #3b2922;
    border-radius: 0.75rem;
    background: #3b2922;
    box-shadow: 0 1.1rem 2.5rem rgb(47 30 22 / 24%), 0 0.2rem 0.5rem rgb(47 30 22 / 28%);
    touch-action: none;
    user-select: none;
  }

  .grid {
    display: grid;
    overflow: hidden;
    width: 100%;
    height: 100%;
    grid-template-rows: repeat(8, 1fr);
  }

  .row { display: grid; grid-template-columns: repeat(8, 1fr); }

  .annotations {
    position: absolute;
    z-index: 3;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .square {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 0;
    place-items: center;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: var(--square);
    cursor: default;
  }

  .square[data-movable='true'] { cursor: grab; }
  .frame[data-dragging='true'] .square { cursor: grabbing; }
  .square.light { --square: var(--board-light); }
  .square.dark { --square: var(--board-dark); }
  .square.last-move { --square: color-mix(in srgb, var(--board-last) 64%, var(--base)); }
  .square.selected { box-shadow: inset 0 0 0 0.34rem var(--board-selected); }
  .square.check { --square: var(--board-check); }
  .square[data-drop-target='true'] {
    z-index: 4;
    box-shadow: inset 0 0 0 0.34rem var(--board-legal);
  }

  .square:focus-visible {
    z-index: 4;
    outline: 0.25rem solid var(--board-focus);
    outline-offset: -0.25rem;
  }

  .piece {
    z-index: 2;
    width: 88%;
    height: 88%;
    pointer-events: none;
    filter: drop-shadow(0 0.12rem 0.08rem rgb(0 0 0 / 22%));
  }

  .square[data-empty='true'] .piece { visibility: hidden; }
  .square[data-drag-source='true'] .piece { opacity: 0.18; }

  .drag-target {
    position: absolute;
    z-index: 1;
    display: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--board-legal) 28%, transparent);
    pointer-events: none;
  }

  .frame[data-dragging='true'][data-drag-pointer='touch'] .drag-target[style] { display: block; }

  .square[data-legal-destination='empty']::after,
  .square[data-legal-destination='occupied']::after {
    position: absolute;
    z-index: 3;
    border-radius: 50%;
    content: '';
    pointer-events: none;
  }

  .square[data-legal-destination='empty']::after {
    width: 24%;
    aspect-ratio: 1;
    background: color-mix(in srgb, var(--board-legal) 68%, transparent);
  }

  .square[data-legal-destination='occupied']::after {
    inset: 7%;
    border: 0.35rem solid color-mix(in srgb, var(--board-legal) 72%, transparent);
  }

  .coordinate {
    position: absolute;
    z-index: 4;
    color: color-mix(in srgb, var(--square) 25%, #201a17);
    font-size: clamp(0.55rem, 2.1cqi, 0.82rem);
    font-weight: 750;
    line-height: 1;
    pointer-events: none;
  }

  .file { right: 0.2rem; bottom: 0.16rem; }
  .rank { top: 0.18rem; left: 0.2rem; }

  .ghost {
    position: absolute;
    z-index: 8;
    top: 0;
    left: 0;
    display: none;
    width: 12.5%;
    height: 12.5%;
    pointer-events: none;
    filter: drop-shadow(0 0.4rem 0.22rem rgb(0 0 0 / 35%));
  }

  .frame[data-dragging='true'] .ghost { display: block; }

  .promotion {
    position: absolute;
    z-index: 12;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(32 26 23 / 52%);
    backdrop-filter: blur(0.16rem);
  }

  .promotion[hidden] { display: none; }

  .promotion-panel {
    display: grid;
    grid-template-columns: repeat(4, minmax(3rem, 5.2rem));
    gap: 0.45rem;
    border: 0.15rem solid rgb(255 255 255 / 55%);
    border-radius: 0.75rem;
    padding: 0.65rem;
    background: #f7efe5;
    box-shadow: 0 1rem 2rem rgb(0 0 0 / 30%);
  }

  .promotion button {
    aspect-ratio: 1;
    border: 0.12rem solid transparent;
    border-radius: 0.55rem;
    padding: 0.2rem;
    background: #dbc1a5;
    cursor: pointer;
  }

  .promotion button:hover { background: #ecd8c2; }
  .promotion button:focus-visible { outline: 0.22rem solid var(--board-focus); }
  .promotion img { width: 100%; height: 100%; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
`;
