import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const files = [
  '.gitattributes',
  'ios/.xcode.env',
  'ios/Podfile',
  'ios/Podfile.properties.json',
  'ios/Talentix.xcodeproj/project.pbxproj',
];

let changed = 0;

for (const file of files) {
  const path = resolve(file);
  if (!existsSync(path)) {
    continue;
  }

  const input = readFileSync(path, 'utf8');
  const output = input.replace(/\r\n?/g, '\n');

  if (output !== input) {
    writeFileSync(path, output, 'utf8');
    changed += 1;
  }
}

console.log(`Verified LF line endings for iOS build files${changed ? ` (${changed} normalized)` : ''}.`);
