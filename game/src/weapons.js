// The armoury: every weapon's numbers in one table, so balance is data, not code.
// Damage is per body hit; headshots multiply by headMult. Spread is in radians of
// cone half-angle; moving widens it, aiming (right mouse) tightens it. Prices are
// the buy menu's prices, in the same dollars the economy hands out.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 1, price: 0, auto: false,
    damage: 26, headMult: 4, mag: 12, reserve: 36, fireGap: 0.16,
    reloadTime: 1.4, spreadStill: 0.004, spreadMove: 0.03, spreadAim: 0.0015,
    recoilPitch: 0.006, recoilYaw: 0.003, range: 60, tracer: 0xe9e6df,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', slot: 2, price: 1500, auto: true,
    damage: 22, headMult: 4, mag: 25, reserve: 100, fireGap: 0.075,
    reloadTime: 1.9, spreadStill: 0.004, spreadMove: 0.035, spreadAim: 0.002,
    recoilPitch: 0.007, recoilYaw: 0.004, range: 55, tracer: 0xf0a830,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', slot: 2, price: 2700, auto: true,
    damage: 34, headMult: 4, mag: 30, reserve: 90, fireGap: 0.1,
    reloadTime: 2.2, spreadStill: 0.0022, spreadMove: 0.028, spreadAim: 0.001,
    recoilPitch: 0.011, recoilYaw: 0.004, range: 80, tracer: 0xf0a830,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', slot: 3, price: 4750, auto: false,
    damage: 95, headMult: 4, mag: 5, reserve: 15, fireGap: 1.1,
    reloadTime: 3.0, spreadStill: 0.0008, spreadMove: 0.06, spreadAim: 0.0002,
    recoilPitch: 0.03, recoilYaw: 0.008, range: 90, tracer: 0x4aa3ff,
  },
};

export const ARMOR_PRICE = 650;
export const GRENADE_PRICE = 300;
export const ARMOR_POINTS = 100;

export const BUY_MENU = [
  { kind: 'weapon', id: 'p9' },
  { kind: 'weapon', id: 'hornet' },
  { kind: 'weapon', id: 'vk47' },
  { kind: 'weapon', id: 'longbow' },
  { kind: 'armor' },
  { kind: 'grenade' },
];

// Bot rifles use the same table: a defender's rifle is a VK-47 with its own numbers.
export const BOT_WEAPON = {
  damage: 24, headMult: 4, range: 55,
  burstMin: 3, burstMax: 5, burstGap: 0.11, restGap: 0.9,
  reactMin: 0.35, reactMax: 0.7, aimDeg10: 2.2, aimDeg25: 4.5,
};
