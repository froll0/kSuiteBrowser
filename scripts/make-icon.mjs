// Renders build/icon.svg to build/icon.png (1024 px); electron-builder derives .ico and .icns from it.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('build/icon.svg', 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync('build/icon.png', png);
const small = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
writeFileSync('build/icon-256.png', small);
console.log(`build/icon.png ${png.length} bytes`);
