// The economy: dollars between rounds, in the Counter-Strike shape. Win pays well,
// losses pay less but a losing streak adds a bonus, kills pay a bounty, and planting
// the bomb pays the whole team. The buy menu spends it during the freeze phase.
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE, ARMOR_POINTS } from './weapons.js';

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const MAX_LOSS_STREAK_BONUS = 1500;
export const PLANT_REWARD = 300;

export function createEconomy() {
  const state = {
    money: START_MONEY,
    armor: 0,
    grenades: 0,
    owned: { p9: true },
    lossStreak: 0,
  };

  function canAfford(price) {
    return state.money >= price;
  }

  function buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def || state.owned[id]) return false;
    if (!canAfford(def.price)) return false;
    state.money -= def.price;
    state.owned[id] = true;
    return true;
  }

  function buyArmor() {
    if (state.armor >= ARMOR_POINTS || !canAfford(ARMOR_PRICE)) return false;
    state.money -= ARMOR_PRICE;
    state.armor = ARMOR_POINTS;
    return true;
  }

  function buyGrenade() {
    if (state.grenades >= 2 || !canAfford(GRENADE_PRICE)) return false;
    state.money -= GRENADE_PRICE;
    state.grenades += 1;
    return true;
  }

  function onKill() {
    state.money += KILL_REWARD;
  }

  function onPlant() {
    state.money += PLANT_REWARD;
  }

  function onRoundEnd(won) {
    if (won) {
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.money += LOSS_REWARD + Math.min(state.lossStreak * LOSS_STREAK_BONUS, MAX_LOSS_STREAK_BONUS);
      state.lossStreak += 1;
    }
  }

  function resetMatch() {
    state.money = START_MONEY;
    state.armor = 0;
    state.grenades = 0;
    state.owned = { p9: true };
    state.lossStreak = 0;
  }

  return { state, canAfford, buyWeapon, buyArmor, buyGrenade, onKill, onPlant, onRoundEnd, resetMatch };
}
