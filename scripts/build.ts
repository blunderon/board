import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const output = `${root}/dist`;

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const compiled = Bun.spawnSync(['bunx', 'tsc', '--project', `${root}/tsconfig.build.json`]);
if (compiled.exitCode !== 0) {
  process.stderr.write(compiled.stderr);
  process.exit(compiled.exitCode);
}

await cp(`${root}/src/pieces`, `${output}/pieces`, { recursive: true });

const example = await Bun.build({
  entrypoints: [`${root}/example/app.ts`],
  outdir: `${output}/example`,
  target: 'browser',
  format: 'esm',
  sourcemap: 'external',
});
if (!example.success) {
  for (const log of example.logs) console.error(log);
  process.exit(1);
}
await cp(`${root}/example/index.html`, `${output}/example/index.html`);
await cp(`${root}/examples/index.html`, `${output}/index.html`);
await cp(`${root}/examples/styles.css`, `${output}/styles.css`);

for (const name of ['analysis', 'bot', 'puzzles']) {
  const directory = `${root}/examples/${name}`;
  const result = await Bun.build({
    entrypoints: [`${directory}/app.ts`],
    outdir: `${output}/examples/${name}`,
    target: 'browser',
    format: 'esm',
    sourcemap: 'external',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  await cp(`${directory}/index.html`, `${output}/examples/${name}/index.html`);
  await cp(`${directory}/styles.css`, `${output}/examples/${name}/styles.css`);
}
