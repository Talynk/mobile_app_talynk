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
const output = join(root, 'assets', 'images', 'app-icon-square.png');

if (!existsSync(input)) {
  console.error('Input not found:', input);
  process.exit(1);
}

try {
  await sharp(input)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toFile(output);
  console.log('Created square icon:', output);
} catch (err) {
  console.error(err);
  process.exit(1);
}
