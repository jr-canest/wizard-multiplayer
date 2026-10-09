/**
 * A name short enough for a tight spot (table tiles, the graph, banners).
 * Names can be 20 characters ("jake thewizardwinner", 2026-10-09), which
 * tiles cut to "jake th…". A long name shows its first word instead, unless
 * another player at the table shares that first word; whatever is still
 * longer than `max` is cut with an ellipsis. Full names stay on the
 * scoreboards and in History.
 */
export function shortName(name: string, all: readonly string[], max = 10): string {
  if (name.length <= max) return name;
  const first = (s: string) => s.trim().split(/\s+/)[0];
  const word = first(name);
  const clashes = all.some(
    (o) => o !== name && first(o).toLowerCase() === word.toLowerCase(),
  );
  const base = word.length >= 2 && !clashes ? word : name;
  return base.length <= max ? base : `${base.slice(0, max - 1).trimEnd()}…`;
}
