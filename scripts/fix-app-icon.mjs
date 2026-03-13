#!/usr/bin/env node
/**
 * Generates a square app icon (1024x1024) from the current logo.
 * Run: npm run fix:icon
 * Requires: npm install --save-dev sharp
 */
import sharp from 'sharp';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const input = join(root, 'assets', 'images', 'mobile-app-logo.png');
const squareOutput = join(root, 'assets', 'images', 'app-icon-square.png');
const adaptiveOutput = join(root, 'assets', 'images', 'adaptive-icon.png');
const splashOutput = join(root, 'assets', 'images', 'mobile-app-logo-1024.png');

const androidIconTargets = {
  mdpi: { launcher: 48, foreground: 108 },
  hdpi: { launcher: 72, foreground: 162 },
  xhdpi: { launcher: 96, foreground: 216 },
  xxhdpi: { launcher: 144, foreground: 324 },
  xxxhdpi: { launcher: 192, foreground: 432 },
};

if (!existsSync(input)) {
  console.error('Input not found:', input);
  process.exit(1);
}

try {
  const squareBuffer = await sharp(input)
    .resize(620, 620, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: squareBuffer, gravity: 'center' }])
    .png()
    .toFile(squareOutput);

  const adaptiveBuffer = await sharp(input)
    .resize(540, 540, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: adaptiveBuffer, gravity: 'center' }])
    .png()
    .toFile(adaptiveOutput);

  const splashBuffer = await sharp(input)
    .resize(700, 700, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: splashBuffer, gravity: 'center' }])
    .png()
    .toFile(splashOutput);

  await Promise.all(
    Object.entries(androidIconTargets).flatMap(([density, sizes]) => {
      const mipmapDir = join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
      return [
        sharp(squareOutput)
          .resize(sizes.launcher, sizes.launcher, { fit: 'cover' })
          .webp()
          .toFile(join(mipmapDir, 'ic_launcher.webp')),
        sharp(squareOutput)
          .resize(sizes.launcher, sizes.launcher, { fit: 'cover' })
          .webp()
          .toFile(join(mipmapDir, 'ic_launcher_round.webp')),
        sharp(adaptiveOutput)
          .resize(sizes.foreground, sizes.foreground, { fit: 'cover' })
          .webp()
          .toFile(join(mipmapDir, 'ic_launcher_foreground.webp')),
      ];
    }),
  );

  console.log('Created square icon:', squareOutput);
  console.log('Created adaptive icon:', adaptiveOutput);
  console.log('Created splash icon:', splashOutput);
} catch (err) {
  console.error(err);
  process.exit(1);
}
