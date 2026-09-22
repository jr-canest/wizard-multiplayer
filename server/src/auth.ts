// Seat tokens: the client proves it owns a name by presenting the name + PIN
// once (checked against the shared Firestore `players` doc, the same hash
// the app has always used), and gets back an HMAC-signed token it presents
// on every socket. No Firebase Admin, no key file: the players collection
// is world-readable by rule, so a plain REST query with the web API key
// suffices, and the PIN never reaches the game server after this.

export type Env = {
  ROOMS: DurableObjectNamespace;
  FIREBASE_PROJECT: string;
  FIREBASE_API_KEY: string;
  ALLOWED_ORIGINS: string;
  SESSION_SECRET: string;
};

const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < u.length; i++) out += u[i].toString(16).padStart(2, '0');
  return out;
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

/** Look up a player by name (case-insensitive) in the shared Firestore. */
export async function lookupPlayer(env: Env, name: string): Promise<{ pinHash?: string; pinSalt?: string; name?: string } | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${env.FIREBASE_API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'players' }],
      where: { fieldFilter: { field: { fieldPath: 'nameLower' }, op: 'EQUAL', value: { stringValue: name.trim().toLowerCase() } } },
      limit: 1,
    },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`firestore ${res.status}`);
  const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, { stringValue?: string }> } }>;
  const doc = rows.find((r) => r.document)?.document;
  if (!doc?.fields) return null;
  return { pinHash: doc.fields.pinHash?.stringValue, pinSalt: doc.fields.pinSalt?.stringValue, name: doc.fields.name?.stringValue };
}

export type Session = { name: string; exp: number };

export async function mintToken(env: Env, name: string): Promise<string> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${name}|${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return btoa(payload) + '.' + sig;
}

export async function verifyToken(env: Env, token: string | null): Promise<Session | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  let payload: string;
  try { payload = atob(token.slice(0, dot)); } catch { return null; }
  const sig = token.slice(dot + 1);
  if ((await hmac(env.SESSION_SECRET, payload)) !== sig) return null;
  const bar = payload.lastIndexOf('|');
  const name = payload.slice(0, bar);
  const exp = Number(payload.slice(bar + 1));
  if (!name || !Number.isFinite(exp) || exp < Date.now()) return null;
  return { name, exp };
}
