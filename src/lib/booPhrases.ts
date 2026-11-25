// Shame-point announcements, the scorekeeper's list (utils/booPhrases.js)
// without the emoji. {NAME} becomes the shamed player's name in capitals.
// Kept short so they fit a phone screen in big letters.
const PHRASES = [
  'BOOOO, {NAME}!',
  'SHAME ON {NAME}!',
  'BOO BOO {NAME}!',
  '{NAME}, WHAT WAS THAT?!',
  '{NAME} GETS THE DUNCE CAP',
  'EVEN THE JESTERS ARE LAUGHING, {NAME}',
  '{NAME}, THAT HURT TO WATCH',
  '{NAME} JUST BROKE THE PROPHECY',
  'THE WIZARDS ARE EMBARRASSED BY {NAME}',
  '{NAME}, GO SIT WITH THE JESTERS',
  'SHAAAME! SHAAAAME! {NAME}!',
  'BOOOO {NAME}, BOOOO!',
  '{NAME} EARNED THAT SHAME POINT',
  'THE CROWD TURNS ON {NAME}',
  '{NAME}, YOUR WAND IS BROKEN',
  'PACK IT UP, {NAME}',
  '{NAME} DID A WHOOPSIE',
  'TELL ME HOW, {NAME}, TELL ME HOW',
  'THE JESTER LIVES IN {NAME} NOW',
  'NOT LIKE THAT, {NAME}!',
];

/** `seed` picks the phrase, so every phone at the table shows the same one. */
export function booPhrase(name: string, seed: number): string {
  let h = seed * 31;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return PHRASES[h % PHRASES.length].replace('{NAME}', (name || 'PLAYER').toUpperCase());
}
