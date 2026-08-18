import { expect, test } from 'bun:test';
import { Position, VariationTree } from './index.js';

test('builds and navigates legal branches without discarding continuations', () => {
  const tree = new VariationTree();
  const e4 = tree.play('e4');
  const e5 = tree.play('e5');
  tree.back();
  const c5 = tree.play('c5');

  expect(e4.children.map((node) => node.move?.san)).toEqual(['e5', 'c5']);
  expect(tree.current).toBe(c5);
  expect(tree.back()).toBe(e4);
  expect(tree.forward()).toBe(e5);

  tree.promote(c5);
  expect(e4.children.map((node) => node.move?.san)).toEqual(['c5', 'e5']);
  expect(tree.mainline.map((node) => node.move?.san)).toEqual(['e4', 'c5']);
});

test('reuses an existing move and keeps analysis annotations on its node', () => {
  const tree = new VariationTree(Position.initial());
  const first = tree.play('e4');
  tree.annotate(first, {
    comment: 'Controls the centre.',
    nags: [1],
    evaluation: { type: 'centipawn', value: 32, pov: 'white', depth: 18 },
  });
  tree.back();

  const selected = tree.play('e2e4');

  expect(selected).toBe(first);
  expect(selected.annotations).toEqual({
    comment: 'Controls the centre.',
    nags: [1],
    evaluation: { type: 'centipawn', value: 32, pov: 'white', depth: 18 },
  });
});

test('removes only the selected branch and moves the cursor to its parent', () => {
  const tree = new VariationTree();
  const e4 = tree.play('e4');
  tree.play('e5');
  tree.back();
  const c5 = tree.play('c5');

  expect(tree.remove(c5)).toBe(true);
  expect(tree.current).toBe(e4);
  expect(e4.children.map((node) => node.move?.san)).toEqual(['e5']);
  expect(tree.remove(tree.root)).toBe(false);
});

test('round-trips an annotated PGN variation tree', () => {
  const pgn = '[Event "Study"]\n\n1. e4 {King pawn} (1. d4 $2 d5 {Queen pawn}) 1... e5 $1 2. Nf3 *';
  const tree = VariationTree.fromPgn(pgn);

  expect(tree.root.children.map((node) => node.move?.san)).toEqual(['e4', 'd4']);
  expect(tree.root.children[0]?.annotations.comment).toBe('King pawn');
  expect(tree.root.children[1]?.annotations.nags).toEqual([2]);

  const reparsed = VariationTree.fromPgn(tree.toPgn());
  expect(reparsed.tags.Event).toBe('Study');
  expect(reparsed.root.children.map((node) => node.move?.san)).toEqual(['e4', 'd4']);
  expect(reparsed.root.children[1]?.children[0]?.annotations.comment).toBe('Queen pawn');
});

test('adds an engine PV atomically as a navigable line', () => {
  const tree = new VariationTree();

  expect(tree.addUci('e2e4 e7e5 g1f3').map((node) => node.move?.san)).toEqual(['e4', 'e5', 'Nf3']);

  const invalid = new VariationTree();
  expect(() => invalid.addUci('e2e4 e7e5 e1e3')).toThrow();
  expect(invalid.root.children).toEqual([]);
  expect(invalid.current).toBe(invalid.root);
});

test('rejects nodes after their branch has been removed', () => {
  const tree = new VariationTree();
  const e4 = tree.play('e4');
  const e5 = tree.play('e5');

  tree.remove(e4);

  expect(() => tree.select(e5)).toThrow(TypeError);
  expect(() => tree.annotate(e4, { comment: 'detached' })).toThrow(TypeError);
  expect(tree.current).toBe(tree.root);
});

test('does not replace the mainline when a PGN variation repeats its first move', () => {
  const tree = VariationTree.fromPgn('1. e4 {first} (1. e4 {second} 1... c5) 1... e5 *');
  const e4 = tree.root.children[0];

  expect(tree.mainline.map((node) => node.move?.san)).toEqual(['e4', 'e5']);
  expect(e4?.children.map((node) => node.move?.san)).toEqual(['e5', 'c5']);
  expect(e4?.annotations.comment).toContain('first');
  expect(e4?.annotations.comment).toContain('second');
});

test('round-trips a complete analysis tree through a JSON-safe snapshot', () => {
  const tree = new VariationTree();
  const e4 = tree.play('e4');
  tree.annotate(e4, {
    comment: 'Candidate',
    nags: [5],
    evaluation: {
      type: 'centipawn',
      value: 31,
      pov: 'white',
      depth: 18,
      bound: 'lower',
      multipv: 2,
      wdl: [420, 500, 80],
    },
  });
  tree.play('e5');
  tree.select(e4);
  tree.play('c5');

  const restored = VariationTree.fromSnapshot(JSON.parse(JSON.stringify(tree.snapshot)));

  expect(restored.root.children[0]?.children.map((node) => node.move?.san)).toEqual(['e5', 'c5']);
  expect(restored.root.children[0]?.annotations).toEqual(e4.annotations);
  expect(restored.current.move?.san).toBe('c5');
});

test('persists a white-relative engine evaluation through annotated PGN', () => {
  const tree = new VariationTree();
  const e4 = tree.play('e4');
  tree.annotate(e4, {
    evaluation: { type: 'centipawn', value: 42, pov: 'white', depth: 20 },
  });

  const restored = VariationTree.fromPgn(tree.toPgn());

  expect(restored.root.children[0]?.annotations.evaluation).toEqual({
    type: 'centipawn',
    value: 42,
    pov: 'white',
    depth: 20,
  });
});

test('preserves unsupported evaluation directives as ordinary comment text', () => {
  const tree = VariationTree.fromPgn('1. e4 {keep [%eval ?] [%depth 20]} *');

  expect(tree.toPgn()).toContain('{keep [%eval ?] [%depth 20]}');
});

test('rejects invalid evaluation metadata in snapshots', () => {
  const tree = new VariationTree();
  tree.play('e4');
  const snapshot = JSON.parse(JSON.stringify(tree.snapshot));
  snapshot.root.children[0].annotations.evaluation = {
    type: 'centipawn',
    pov: 'white',
    value: 1,
    depth: -1,
    multipv: 0,
    wdl: [-1, 2000, 0],
  };

  expect(() => VariationTree.fromSnapshot(snapshot)).toThrow(TypeError);
});

test('rejects duplicate move edges in snapshots instead of merging them', () => {
  const tree = new VariationTree();
  tree.play('e4');
  const snapshot = JSON.parse(JSON.stringify(tree.snapshot));
  snapshot.root.children.push(JSON.parse(JSON.stringify(snapshot.root.children[0])));

  expect(() => VariationTree.fromSnapshot(snapshot)).toThrow(TypeError);
});

test('rejects annotations that would make its own output unreadable', () => {
  const tree = new VariationTree();
  const e4 = tree.play('e4');
  tree.annotate(e4, { comment: 'Candidate' });

  expect(() => tree.annotate(e4, { nags: [-1] })).toThrow(TypeError);
  expect(() =>
    tree.annotate(e4, {
      evaluation: {
        type: 'mate',
        pov: 'white',
        value: 1.5,
        depth: -1,
        multipv: 0,
        wdl: [-1, 2000, 0],
      },
    }),
  ).toThrow(TypeError);
  expect(() =>
    tree.annotate(e4, {
      arrows: [{ from: 'e2', to: 'e4', opacity: 1.1 }],
    }),
  ).toThrow(TypeError);
  expect(e4.annotations).toEqual({ comment: 'Candidate' });
  expect(() => VariationTree.fromSnapshot(tree.snapshot)).not.toThrow();
});
