// Room link previews. Firebase Hosting rewrites /room/** here so that a
// room link pasted into iMessage / WhatsApp shows the room code and the
// card image instead of the bare app title (an SPA serves one index.html
// for every URL, so the preview tags have to be filled in per request).
// Browsers get the same index.html the CDN serves, with the tags swapped,
// so the app itself is unchanged. The game itself never touches this.
import { onRequest } from 'firebase-functions/v2/https';

const ORIGIN = 'https://wizard-multiplayer.web.app';
// Same alphabet as the room codes (no 0/O/1/I/L).
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

let cached = { html: null, at: 0 };
// Short in-memory cache: a deploy changes the hashed asset names inside
// index.html, and a stale copy would point at assets that no longer exist.
const HTML_TTL_MS = 30_000;

async function loadIndex() {
  if (cached.html && Date.now() - cached.at < HTML_TTL_MS) return cached.html;
  const res = await fetch(`${ORIGIN}/index.html`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`index.html ${res.status}`);
  const html = await res.text();
  cached = { html, at: Date.now() };
  return html;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function setMeta(html, attr, name, value) {
  const re = new RegExp(`(<meta\\s+${attr}="${name}"\\s+content=")[^"]*(")`);
  return re.test(html) ? html.replace(re, `$1${esc(value)}$2`) : html;
}

export const roomPage = onRequest(
  { region: 'us-central1', memory: '128MiB', maxInstances: 3, cpu: 1 },
  async (req, res) => {
    const m = /^\/room\/([^/?#]+)/.exec(req.path || '');
    const code = m ? decodeURIComponent(m[1]).toUpperCase() : '';
    let html;
    try {
      html = await loadIndex();
    } catch (err) {
      console.error('roomPage: could not load index.html', err);
      res.redirect(302, `${ORIGIN}/`);
      return;
    }
    if (CODE.test(code)) {
      const title = `Wizard · Room ${code}`;
      const desc = `Tap to join the table. Room code ${code}.`;
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
      html = setMeta(html, 'property', 'og:title', title);
      html = setMeta(html, 'property', 'og:description', desc);
      html = setMeta(html, 'property', 'og:url', `${ORIGIN}/room/${code}`);
      html = setMeta(html, 'name', 'description', desc);
      html = setMeta(html, 'name', 'twitter:title', title);
      html = setMeta(html, 'name', 'twitter:description', desc);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    // The CDN may hold it for a minute (link previews and the tap that
    // follows hit the same URL); browsers always revalidate.
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60');
    res.status(200).send(html);
  },
);
