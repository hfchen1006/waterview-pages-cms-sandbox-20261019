import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Deterministic color blocks generated from raw pixels: no photographs or downloads.
const uploads = fileURLToPath(new URL('../src/assets/uploads/', import.meta.url));
await mkdir(uploads, { recursive: true });
const names = ['published-property', 'published-studio', 'draft-property', 'hidden-property', 'published-guide', 'draft-guide', 'hidden-guide'];
for (const [index, name] of names.entries()) {
  const pixels = Buffer.alloc(160 * 100 * 3);
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 160; x++) {
      const offset = (y * 160 + x) * 3;
      pixels[offset] = (index * 29 + x + (y % 20 < 10 ? 60 : 0)) % 256;
      pixels[offset + 1] = (index * 47 + y * 2) % 256;
      pixels[offset + 2] = (200 - index * 19 + x % 24) % 256;
    }
  }
  await sharp(pixels, { raw: { width: 160, height: 100, channels: 3 } }).png()
    .toFile(`${uploads}${name}.png`);
}
console.log(`Generated ${names.length} synthetic PNG fixtures inside the POC.`);
