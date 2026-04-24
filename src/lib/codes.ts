// Room code alphabet excludes ambiguous chars (0, O, 1, I, L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateRoomCode(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== 4) return false;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
