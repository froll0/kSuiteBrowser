// Renders build/icon.svg to the app icons:
//   build/icon.png (1024 px)  -> electron-builder derives the macOS .icns and Linux icons from it
//   build/icon.ico (16–256 px) -> Windows installer, exe and window icon
//   build/icon-256.png         -> window icon on Linux and the macOS Dock in development
// build/icon-small.svg is used for the 16–48 px images.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('build/icon.svg', 'utf8');
// Small sizes use a simplified drawing that stays readable in the taskbar and title bar.
const small = readFileSync('build/icon-small.svg', 'utf8');
const render = (size) => Buffer.from(new Resvg(size <= 48 ? small : svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

writeFileSync('build/icon.png', render(1024));
writeFileSync('build/icon-256.png', render(256));

// ICO with PNG-compressed images (supported since Windows Vista).
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = Buffer.alloc(16 * images.length);
let offset = header.length + entries.length;
images.forEach((png, i) => {
  const size = sizes[i];
  const e = i * 16;
  entries.writeUInt8(size >= 256 ? 0 : size, e);
  entries.writeUInt8(size >= 256 ? 0 : size, e + 1);
  entries.writeUInt8(0, e + 2);
  entries.writeUInt8(0, e + 3);
  entries.writeUInt16LE(1, e + 4);
  entries.writeUInt16LE(32, e + 6);
  entries.writeUInt32LE(png.length, e + 8);
  entries.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync('build/icon.ico', Buffer.concat([header, entries, ...images]));
console.log('build/icon.png, build/icon-256.png, build/icon.ico');
