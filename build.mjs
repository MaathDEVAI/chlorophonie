// Chlorophonie — build de production.
// Concatène les modules (imports/exports retirés), inline le CSS, et produit
// dist/chlorophonie.html : un fichier unique, ouvrable d'un double-clic,
// sans serveur ni dépendance.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const ORDER = [
  'prng.js',
  'music.js',
  'genome.js',
  'plant.js',
  'audio.js',
  'world.js',
  'state.js',
  'ui.js',
  'main.js',
];

let bundle = "'use strict';\n";
for (const f of ORDER) {
  let code = readFileSync(join(root, 'src', f), 'utf8');
  code = code.replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '');
  code = code.replace(/^export\s+/gm, '');
  bundle += `\n/* ===== src/${f} ===== */\n${code}`;
}
if (/^\s*(import|export)\b/m.test(bundle)) {
  throw new Error('Des imports/exports subsistent dans le bundle.');
}

const css = readFileSync(join(root, 'src', 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
const cssTag = '<link rel="stylesheet" href="src/style.css" />';
const jsTag = '<script type="module" src="src/main.js"></script>';
if (!html.includes(cssTag) || !html.includes(jsTag)) {
  throw new Error('Balises attendues introuvables dans index.html');
}
html = html.replace(cssTag, `<style>\n${css}</style>`);
html = html.replace(jsTag, `<script type="module">\n${bundle}\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'chlorophonie.html');
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`dist/chlorophonie.html écrit (${kb} Ko) — ouvrable d'un double-clic.`);
