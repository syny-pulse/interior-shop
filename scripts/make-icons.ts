/**
 * Generates the PWA icon set into public/icons/.
 *
 *   npm run icons
 *
 * There is no brand asset in this repo, so the mark is drawn here from the
 * app's own accent (--primary #BE185D, the only pink that carries white text
 * at AA — see app/globals.css). To replace it with a real logo, either swap the
 * SVG below or just overwrite the PNGs; nothing reads this script at runtime.
 *
 * Two variants are produced on purpose:
 *
 *   icon-512          full-bleed, for launchers that draw the icon as-is.
 *   icon-maskable-512 the same mark inside the central 80%, because Android
 *                     crops maskable icons to whatever shape the launcher
 *                     uses. Artwork outside that safe zone loses its corners.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(process.cwd(), 'public', 'icons');

const PRIMARY = '#be185d';
const INK = '#ffffff';

/**
 * @param inset Fraction of the canvas to leave empty around the mark.
 *              0 for full-bleed, 0.1 for the maskable safe zone.
 */
function markSvg(size: number, inset: number): string {
  const pad = size * inset;
  const box = size - pad * 2;
  // Rounded square at the app's card radius, scaled to the icon.
  const radius = box * 0.22;
  const fontSize = box * 0.42;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${PRIMARY}"/>
  <rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${radius}" fill="${PRIMARY}"/>
  <text
    x="${size / 2}"
    y="${size / 2}"
    fill="${INK}"
    font-family="Geist, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    font-size="${fontSize}"
    font-weight="600"
    letter-spacing="${-fontSize * 0.03}"
    text-anchor="middle"
    dominant-baseline="central"
  >SB</text>
</svg>`;
}

async function png(name: string, size: number, inset: number) {
  const buffer = await sharp(Buffer.from(markSvg(size, inset))).png().toBuffer();
  await writeFile(join(OUT, name), buffer);
  console.log(`  ${name}  ${size}x${size}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('Writing icons to public/icons/');

  await png('icon-192.png', 192, 0);
  await png('icon-512.png', 512, 0);
  // 10% inset each side leaves the mark inside the maskable safe zone.
  await png('icon-maskable-512.png', 512, 0.1);
  // iOS ignores the manifest icons and reads this one from <link rel="apple-touch-icon">.
  await png('apple-touch-icon-180.png', 180, 0);

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
