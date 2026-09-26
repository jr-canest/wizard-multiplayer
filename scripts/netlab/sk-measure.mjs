// Measure page height vs content height on the live scorekeeper at a few device sizes.
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] || 'https://wizard-scorekeeper.web.app/?test';
const out = process.argv[3];
const sizes = [['iPhone 13', 390, 844, true], ['iPhone Pro Max', 430, 932, true], ['iPad', 820, 1180, true], ['desktop', 1440, 900, false]];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
for (const [name, w, h, mobile] of sizes) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  // The dev server shows a dev-only "Demo scenarios" panel the live site
  // hides; drop it so dev and live measure the same content.
  await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('#root *')].find((e) => e.children.length === 0 && /Demo scenarios/.test(e.textContent || ''));
    const card = leaf && leaf.closest('[class*="rounded"]');
    if (card && card.id !== 'root' && !card.querySelector('#root')) card.remove();
  });
  await new Promise((r) => setTimeout(r, 200));
  const m = await page.evaluate(() => {
    const zoom = getComputedStyle(document.body).getPropertyValue('--ui-zoom').trim();
    const root = document.getElementById('root');
    const kids = [...root.querySelectorAll('*')];
    let contentBottom = 0;
    for (const el of kids) { const r = el.getBoundingClientRect(); if (r.height > 0 && r.width > 0) contentBottom = Math.max(contentBottom, r.bottom + window.scrollY); }
    const foot = [...document.querySelectorAll('#root *')].filter((e) => /^v20\d\d\./.test((e.textContent || '').trim()) && e.children.length === 0).pop(); const footBottom = foot ? Math.round(foot.getBoundingClientRect().bottom + scrollY) : null; return { zoom, innerH: innerHeight, scrollH: document.scrollingElement.scrollHeight, bodyH: Math.round(document.body.getBoundingClientRect().height), contentBottom: footBottom ?? Math.round(contentBottom) };
  });
  console.log(`${name.padEnd(15)} ${w}x${h}  zoom ${m.zoom}  viewport ${m.innerH}  page ${m.scrollH}  last line (version footer) at ${m.contentBottom}  scrollable past it ${m.scrollH - m.contentBottom}px`);
  if (out) await page.screenshot({ path: `${out}/sk-${name.replace(/\s+/g, '-')}.png`, fullPage: true });
  await page.close();
}
await browser.close();
