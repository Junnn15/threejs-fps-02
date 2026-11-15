// The view model: one gun per weapon definition, swapped on the fly, with a muzzle
// flash, kick, reload dip and an aim-down-sights pose. It owns the gun's look and
// timing; main.js owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE, shade } from './palette.js';
import { WEAPONS } from './weapons.js';

function buildModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade('accent')), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  // Length and bulk scale with the weapon's role: sniper long and thin, SMG short.
  const len = def.id === 'longbow' ? 0.62 : def.id === 'hornet' ? 0.34 : def.id === 'p9' ? 0.26 : 0.44;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, len), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, len * 0.85), grip);
  barrel.position.set(0, 0.025, -len * 0.55);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
  stock.position.set(0, -0.02, len * 0.55);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, len * 0.5), accent);
  stripe.position.set(0, 0.055, 0);
  model.add(receiver, barrel, stock, stripe);
  if (def.id === 'longbow') {
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), grip);
    scope.position.set(0, 0.1, 0.05);
    model.add(scope);
  }
  if (def.id === 'hornet') {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), grip);
    mag.position.set(0, -0.12, -0.02);
    model.add(mag);
  }
  model.position.set(0.28, -0.24, -0.5);
  model.scale.setScalar(0.7);
  return model;
}

export function createWeapon(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let current = WEAPONS.vk47;
  const state = {
    mag: current.mag, reserve: current.reserve, cooldown: 0,
    reloadLeft: 0, flash: 0, kick: 0, aiming: false, aimAmount: 0,
  };

  function equip(id, keepAmmo) {
    models[current.id].visible = false;
    current = WEAPONS[id];
    models[current.id].visible = true;
    if (!keepAmmo) {
      state.mag = current.mag;
      state.reserve = current.reserve;
    }
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
  }
  models[current.id].visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.aimAmount += ((state.aiming ? 1 : 0) - state.aimAmount) * Math.min(1, dt * 10);
    const model = models[current.id];
    model.position.z = -0.5 + state.kick;
    model.position.x = 0.28 - state.aimAmount * 0.28;
    model.position.y = -0.24 + state.aimAmount * 0.05;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (current.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = current.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    current() { return current; },
    setAiming(on) { state.aiming = on; },
    aimAmount() { return state.aimAmount; },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = current.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === current.mag || state.reserve === 0) return;
      state.reloadLeft = current.reloadTime;
    },
    spread(speed) {
      const base = state.aiming ? current.spreadAim : current.spreadStill;
      const move = state.aiming ? current.spreadMove * 0.4 : current.spreadMove;
      return base + Math.min(1, speed / 5.2) * move;
    },
    refill() {
      state.mag = current.mag;
      state.reserve = current.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
