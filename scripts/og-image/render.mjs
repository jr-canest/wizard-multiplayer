// Renders public/og-card.png (1200x630) from card.html with the system Chrome.
//   node scripts/og-image/render.mjs
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(here, 'card.html'), { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const out = path.join(here, '..', '..', 'public', 'og-card.png');
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log('wrote', out);
