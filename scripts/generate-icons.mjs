// Renders the PWA icons from the SVG sources: `npm run icons`.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import ico from 'sharp-ico';

const rounded = await readFile(new URL('../public/favicon.svg', import.meta.url));
// Maskable and Apple icons are full-bleed; the platform applies its own shape.
const fullBleed = await readFile(new URL('./icon-full-bleed.svg', import.meta.url));

const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;
const render = (svg, size) => sharp(svg, { density: 300 }).resize(size, size).png();

await render(rounded, 64).toFile(out('pwa-64x64.png'));
await render(rounded, 192).toFile(out('pwa-192x192.png'));
await render(rounded, 512).toFile(out('pwa-512x512.png'));
await render(fullBleed, 512).toFile(out('maskable-icon-512x512.png'));
await render(fullBleed, 180).toFile(out('apple-touch-icon-180x180.png'));
await ico.sharpsToIco([render(rounded, 48)], out('favicon.ico'));
console.log('Icons written to public/');
