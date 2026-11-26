// Turns the Vite build in dist-artifact/ into one self-contained HTML file for publishing.
// Phaser loads from a pinned CDN URL; everything else (code, styles, art) is inline.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PHASER_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js';
const dir = 'dist-artifact';
let html = readFileSync(join(dir, 'index.html'), 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_, f) => {
  const js = readFileSync(join(dir, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_, f) => `<style>${readFileSync(join(dir, f), 'utf8')}</style>`);
html = html.replace('<!--PHASER-->', `<script src="${PHASER_URL}"></script>`);
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('An asset was not inlined');

// The artifact host supplies the document skeleton, so publish only the contents.
const title = '<title>MunchKeep</title>';
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="utf-8" \/>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(title, '');
html = `${title}\n${html.trim()}\n`;

writeFileSync(join(dir, 'munchkeep.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`wrote ${dir}/munchkeep.html (${kb} KB); files: ${readdirSync(dir).join(', ')}`);
