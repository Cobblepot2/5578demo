import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url);
const supported = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/integrity.js', ['integrity.js', 'text/javascript']],
  ['/fixtures.js', ['fixtures.js', 'text/javascript']],
  ['/strings.js', ['strings.js', 'text/javascript']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const port = Number(process.env.DEMO_PORT ?? 4173);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const asset = supported.get(path);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
    response.end(await readFile(new URL(asset[0], root)));
  } catch {
    response.end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Release Integrity Lab: http://127.0.0.1:' + port);
});
