const root = new URL('../dist/', import.meta.url);

Bun.serve({
  hostname: '0.0.0.0',
  port: 4173,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const relative =
      path === '/' ? 'index.html' : `${path.slice(1)}${path.endsWith('/') ? 'index.html' : ''}`;
    const file = Bun.file(new URL(relative, root));
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file);
  },
});
