// The look plan, in one place. Six values and one accent hue; the lighting makes every
// shade the game needs, so no other colour appears in the code. The same six names are
// the CSS custom properties in index.html. Team colours sit beside them: Vanguard blue
// for the player's squad, Raider red for the defenders.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  vanguard: '#4aa3ff',
  raider: '#ff5a4e',
  siteA: '#f0a830',
  siteB: '#7dd069',
};

export function shade(name) {
  return PALETTE[name];
}
