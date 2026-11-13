#!/usr/bin/env node
/**
 * Renders every Biber icon from one mark: the web favicons and PWA icons, the desktop app icons,
 * tray icons and installer images, and the phone app's icons.
 *
 * The mark is a white lowercase "b" (a stem and a round bowl) on an amber square. Edit the
 * geometry or colors here and run again:
 *
 *   node scripts/brand/generate-icons.mjs
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (...parts) => path.join(root, ...parts);

const PALETTES = {
  beta: ['#2DD4BF', '#0F766E'],
  dev: ['#94A3B8', '#334155'],
  nightly: ['#818CF8', '#4338CA'],
  stable: ['#F59E0B', '#B45309'],
};

/**
 * The "b" in a 1024 box: the bowl is a ring centered at (512, 580), and the stem runs up from the
 * ring's left side. `scale` shrinks it around the center for safe zones.
 */
const glyph = (color, scale = 1) => `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)"
     fill="none" stroke="${color}" stroke-linecap="round">
    <line x1="342" y1="274" x2="342" y2="580" stroke-width="124"/>
    <circle cx="512" cy="580" r="170" stroke-width="124"/>
  </g>`;

const svg = (body, size = 1024) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`,
  );

const background = ([from, to], { inset = 0, radius = 0 } = {}) => `
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}"
        rx="${radius}" fill="url(#bg)"/>`;

/** Rounded tile with transparent corners: web, Windows, and the general logo. */
const tile = (palette = PALETTES.stable) =>
  svg(`${background(palette, { radius: 232 })}${glyph('#FFFFFF')}`);

/** macOS draws app icons at 824/1024 with transparent margins. */
const macTile = (palette = PALETTES.stable) =>
  svg(`${background(palette, { inset: 100, radius: 185 })}${glyph('#FFFFFF', 824 / 1024)}`);

/** Full-bleed square for platforms that apply their own mask (iOS, maskable PWA icons). */
const square = (palette = PALETTES.stable, glyphScale = 1) =>
  svg(`${background(palette)}${glyph('#FFFFFF', glyphScale)}`);

/** Status favicons add a dot in the corner: done, error, or in progress. */
const STATUS_COLORS = { done: '#22C55E', error: '#EF4444', progress: '#3B82F6' };
const statusTile = (status, palette) =>
  svg(
    `${background(palette, { radius: 232 })}${glyph('#FFFFFF')}
     <circle cx="820" cy="820" r="190" fill="${STATUS_COLORS[status]}" stroke="#FFFFFF" stroke-width="48"/>`,
  );

const png = (input, size) => sharp(input, { density: 300 }).resize(size, size).png().toBuffer();

const write = async (file, data) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  console.log(`wrote ${path.relative(root, file)}`);
};

/** ICO with PNG entries (Windows Vista and later, every browser). */
const ico = async (input, sizes) => {
  const images = await Promise.all(sizes.map((size) => png(input, size)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    const size = sizes[i] >= 256 ? 0 : sizes[i];
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
};

/** ICNS with PNG chunks, from 16 px to 1024 px. */
const icns = async (input) => {
  const types = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ];
  const chunks = await Promise.all(
    types.map(async ([type, size]) => {
      const data = await png(input, size);
      const head = Buffer.alloc(8);
      head.write(type, 0, 'ascii');
      head.writeUInt32BE(data.length + 8, 4);
      return Buffer.concat([head, data]);
    }),
  );
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
};

/** 24-bit uncompressed BMP, the only kind NSIS installer images accept. */
const bmp = async (input, width, height) => {
  const { data } = await sharp(input)
    .resize(width, height)
    .flatten({ background: '#FFFFFF' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const file = Buffer.alloc(54 + rowSize * height);
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3;
      file[row + x * 3] = data[source + 2];
      file[row + x * 3 + 1] = data[source + 1];
      file[row + x * 3 + 2] = data[source];
    }
  }
  return file;
};

/** An installer image: the mark on white, at a given place and size within the canvas. */
const banner = (width, height, mark) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <rect width="${width}" height="${height}" fill="#FFFFFF"/>
       <svg x="${mark.x}" y="${mark.y}" width="${mark.size}" height="${mark.size}" viewBox="0 0 1024 1024">
         ${background(PALETTES.stable, { radius: 232 })}${glyph('#FFFFFF')}
       </svg>
     </svg>`,
  );

const web = async () => {
  const dev = PALETTES.dev;
  await write(out('public/favicon.ico'), await ico(tile(), [16, 32, 48]));
  await write(out('public/favicon-32x32.ico'), await ico(tile(), [32]));
  await write(out('public/favicon-dev.ico'), await ico(tile(dev), [16, 32, 48]));
  await write(out('public/favicon-32x32-dev.ico'), await ico(tile(dev), [32]));
  for (const status of ['done', 'error', 'progress']) {
    await write(
      out(`public/favicon-${status}.ico`),
      await ico(statusTile(status, PALETTES.stable), [16, 32, 48]),
    );
    await write(
      out(`public/favicon-${status}-dev.ico`),
      await ico(statusTile(status, dev), [16, 32, 48]),
    );
    await write(
      out(`public/favicon-32x32-${status}.ico`),
      await ico(statusTile(status, PALETTES.stable), [32]),
    );
    await write(
      out(`public/favicon-32x32-${status}-dev.ico`),
      await ico(statusTile(status, dev), [32]),
    );
  }
  // Replaced by favicon-32x32-error.ico, the name the app requests.
  await rm(out('public/favicon-32x-32-error.ico'), { force: true });
  await write(out('public/apple-touch-icon.png'), await png(square(), 180));
  // The default assistant's avatar: the inbox and the other built-in agents name this file, and so
  // may agents saved with it, so it keeps its upstream name
  await write(out('public/avatars/lobe-ai.png'), await png(tile(), 512));
  for (const size of [192, 512]) {
    await write(out(`public/icons/icon-${size}x${size}.png`), await png(tile(), size));
    // Maskable icons keep the mark inside the 80% safe zone.
    await write(
      out(`public/icons/icon-${size}x${size}.maskable.png`),
      await png(square(PALETTES.stable, 0.8), size),
    );
  }
};

const desktop = async () => {
  const variants = {
    '': PALETTES.stable,
    '-beta': PALETTES.beta,
    '-dev': PALETTES.dev,
    '-nightly': PALETTES.nightly,
  };
  for (const [suffix, palette] of Object.entries(variants)) {
    await write(out(`apps/desktop/build/icon${suffix}.png`), await png(macTile(palette), 1024));
    await write(
      out(`apps/desktop/build/icon${suffix}.ico`),
      await ico(tile(palette), [16, 24, 32, 48, 64, 128, 256]),
    );
    // Release channels ship a macOS icon; development builds use the PNG.
    if (suffix !== '-dev') {
      await write(out(`apps/desktop/build/Icon${suffix}.icns`), await icns(macTile(palette)));
    }
  }
  // Liquid Glass icon catalogs come from Xcode and held the previous brand; the build falls back
  // to the .icns icon without them.
  for (const name of ['Icon', 'Icon-beta', 'Icon-dev', 'Icon-nightly']) {
    await rm(out(`apps/desktop/build/${name}.Assets.car`), { force: true });
  }

  await write(
    out('apps/desktop/build/nsis-header.bmp'),
    await bmp(banner(150, 57, { size: 41, x: 101, y: 8 }), 150, 57),
  );
  await write(
    out('apps/desktop/build/nsis-sidebar.bmp'),
    await bmp(banner(164, 314, { size: 96, x: 34, y: 48 }), 164, 314),
  );

  // macOS menu bar template: black glyph on transparent, recolored by the system.
  const template = svg(glyph('#000000', 1.45));
  await write(out('apps/desktop/resources/trayTemplate.png'), await png(template, 18));
  await write(out('apps/desktop/resources/trayTemplate@2x.png'), await png(template, 36));
  await write(out('apps/desktop/resources/tray.png'), await png(tile(), 32));
};

const mobile = async () => {
  await write(out('apps/mobile/assets/icon.png'), await png(square(), 1024));
  await write(out('apps/mobile/assets/splash-icon.png'), await png(tile(), 1024));
  await write(out('apps/mobile/assets/favicon.png'), await png(tile(), 48));
  // Android adaptive icons: the system masks the background and keeps the foreground inside the
  // central 66% safe zone.
  await write(
    out('apps/mobile/assets/android-icon-background.png'),
    await png(svg(background(PALETTES.stable)), 512),
  );
  await write(
    out('apps/mobile/assets/android-icon-foreground.png'),
    await png(svg(glyph('#FFFFFF', 0.6)), 512),
  );
  await write(
    out('apps/mobile/assets/android-icon-monochrome.png'),
    await png(svg(glyph('#000000', 0.6)), 432),
  );
};

await web();
await desktop();
await mobile();
