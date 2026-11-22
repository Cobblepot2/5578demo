import { mkdir, readFile, writeFile } from 'node:fs/promises';

const readAsset = (name) => readFile(new URL('../public/' + name, import.meta.url), 'utf8');
const [html, css, icon] = await Promise.all(['index.html', 'style.css', 'icon.svg'].map(readAsset));
const modules = await Promise.all([
  'fixtures.js', 'integrity.js', 'strings.js', 'folder-fixture.js', 'folder-strings.js', 'folder.js', 'app.js',
].map(readAsset));
const archive = await readFile(new URL('../public/nikke-source-samples.zip', import.meta.url));
const combined = modules
  .map((source) => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''))
  .join('\n');
const offline = html
  .replace('href="./icon.svg"', 'href="data:image/svg+xml,' + encodeURIComponent(icon) + '"')
  .replace('href="./nikke-source-samples.zip"', 'href="data:application/zip;base64,' + archive.toString('base64') + '"')
  .replace('<link rel="stylesheet" href="./style.css">', () => '<style>\n' + css + '</style>')
  .replace('<script type="module" src="./app.js"></script>', () => '<script type="module">\n' + combined + '</script>');
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('5578-integrity-demo.html', output), offline);
console.log('Offline demo: dist/5578-integrity-demo.html');
