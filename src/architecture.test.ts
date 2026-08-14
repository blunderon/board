import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';

test('headless and DOM board modules do not import the rules engine', async () => {
  for (const directory of ['src/core', 'src/dom']) {
    const files = await readdir(directory, { recursive: true });
    for (const file of files.filter((path) => path.endsWith('.ts'))) {
      const source = await Bun.file(`${directory}/${file}`).text();
      expect(source).not.toMatch(/from ['"]\.\.\/rules/);
    }
  }
});

test('examples are independent package consumers', async () => {
  const examples = ['analysis', 'bot', 'puzzles'];

  for (const example of examples) {
    const source = await Bun.file(`examples/${example}/app.ts`).text();

    expect(source).toContain("from '@blunderon/board");
    expect(source).not.toMatch(/from ['"]\.\.\//);
    expect(source).not.toContain('/src/');
  }
});

test('the static site links to every shipped example with relative URLs', async () => {
  const landingPage = await Bun.file('examples/index.html').text();

  for (const example of ['analysis', 'bot', 'puzzles']) {
    expect(landingPage).toContain(`href="./examples/${example}/"`);
  }
  expect(landingPage).not.toMatch(/(?:href|src)="\//);
});
