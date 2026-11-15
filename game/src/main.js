// SANDLINE: a round-based tactical FPS. Boot and the one loop: a fixed 60 Hz
// simulation feeding a render at the display's rate. Vanguard (you + two bots)
// attack; Raiders (three bots) defend two bombsites. Rounds are won by wiping the
// other squad, or by planting the bomb and letting it blow — or defusing it.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, zoneAt } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEconomy, PLANT_REWARD } from './economy.js';
import { WEAPONS, BUY_MENU } from './weapons.js';
import { overlapsAt } from './physics.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const FREEZE_TIME = 12;
const PLANT_TIME = 3.5;
const BOMB_FUSE = 35;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bots = createBots(scene, world);
const weapon = createWeapon(camera);
const hud = createHud();
const audio = createAudio();
const economy = createEconomy();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const playerChest = new THREE.Vector3();

// --- Match state, kept in one place. ---
const match = {
  phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
  round: 1,
  scoreV: 0,
  scoreR: 0,
  timer: FREEZE_TIME,
  hp: 100,
  alive: true,
  bombPlanted: false,
  bombSite: null,
  bombPos: null,
  bombFuse: 0,
  plantProgress: 0,
  plantSite: null,
  lastBeepSecond: -1,
  roundEndAt: 0,
  elapsed: 0,
  kills: 0,
};
let buyOpen = false;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let minimapAt = 0;
const grenades = [];
const effects = [];

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;

// The bomb: a small device with a blinking light, placed where it was planted.
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.24, 0.3),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.raider) }),
);
bombLight.position.y = 0.16;
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

hud.buildBuy(onBuy);
hud.setAmmo(weapon.state.mag, weapon.state.reserve);
hud.setWeapon(weapon.current().name.toUpperCase());
hud.setHealth(match.hp, economy.state.armor);
hud.setMoney(economy.state.money);
hud.setScore(0, 0, 1);
hud.setTimer(FREEZE_TIME, 'freeze');
hud.onPlay(() => {
  if (shot) return;
  audio.ensure();
  if (match.phase === 'menu') startMatch();
  else if (match.phase === 'matchEnd') startMatch();
  else if (match.phase === 'roundEnd') { /* next round starts on its own timer */ }
  input.requestLock();
});

function onBuy(kind, id) {
  if (match.phase !== 'freeze') return;
  let ok = false;
  if (kind === 'weapon') ok = economy.buyWeapon(id);
  else if (kind === 'armor') ok = economy.buyArmor();
  else if (kind === 'grenade') ok = economy.buyGrenade();
  if (ok) {
    audio.buy();
    hud.setMoney(economy.state.money);
    hud.showBuy(economy.state.money, economy.state.owned);
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (match.phase === 'freeze') {
      buyOpen = true;
      hud.showBuy(economy.state.money, economy.state.owned);
    }
  } else if (match.phase === 'live' || match.phase === 'freeze') {
    hud.showOverlay('paused');
    hud.hideBuy();
    buyOpen = false;
  }
}

function startMatch() {
  match.scoreV = 0;
  match.scoreR = 0;
  match.round = 1;
  match.kills = 0;
  economy.resetMatch();
  hud.setMoney(economy.state.money);
  startRound();
}

function startRound() {
  match.phase = 'freeze';
  match.timer = FREEZE_TIME;
  match.bombPlanted = false;
  match.bombSite = null;
  match.bombPos = null;
  match.bombFuse = 0;
  match.plantProgress = 0;
  match.plantSite = null;
  match.lastBeepSecond = -1;
  match.hp = 100;
  match.alive = true;
  bombMesh.visible = false;
  grenades.length = 0;
  body.position.set(0, 0, 13.5);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  // Keep the weapon you own; fall back to the sidearm.
  const cur = weapon.current();
  if (!economy.state.owned[cur.id]) weapon.equip('p9');
  weapon.refill();
  bots.resetRound();
  hud.setHealth(match.hp, economy.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.current().name.toUpperCase());
  hud.setScore(match.scoreV, match.scoreR, match.round);
  hud.setTimer(FREEZE_TIME, 'freeze');
  hud.hideBanner();
  hud.setPlant(null, null);
  if (started) {
    buyOpen = true;
    hud.showBuy(economy.state.money, economy.state.owned);
  }
}

function endRound(winner, reason) {
  if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  match.phase = 'roundEnd';
  match.roundEndAt = match.elapsed;
  const won = winner === 'vanguard';
  if (won) match.scoreV += 1;
  else match.scoreR += 1;
  economy.onRoundEnd(won);
  hud.setMoney(economy.state.money);
  hud.hideBuy();
  buyOpen = false;
  hud.setPlant(null, null);
  audio.roundEnd(won);
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, won, 4200);
  hud.setScore(match.scoreV, match.scoreR, match.round);
  if (document.pointerLockElement) document.exitPointerLock();
}

function endMatch() {
  match.phase = 'matchEnd';
  const won = match.scoreV > match.scoreR;
  audio.matchEnd(won);
  hud.showOverlay('match', won
    ? `Vanguard takes the yard ${match.scoreV}–${match.scoreR}. ${match.kills} eliminations on your record.`
    : `Raiders hold the yard ${match.scoreR}–${match.scoreV}. Run it back?`);
  if (document.pointerLockElement) document.exitPointerLock();
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function playerShoot() {
  const def = weapon.current();
  if (!weapon.takeRound()) {
    audio.dryClick();
    weapon.reload();
    return false;
  }
  camera.getWorldDirection(direction);
  const spread = weapon.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const endPoint = hit
    ? hit.point.clone()
    : camera.position.clone().addScaledVector(direction, def.range);
  bots.addTracer(camera.position, endPoint, def.tracer);
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const head = hit.object.userData.part === 'head';
    const dmg = head ? def.damage * def.headMult : def.damage;
    const killed = bots.damage(bot, dmg, match.elapsed);
    if (killed) {
      match.kills += 1;
      economy.onKill();
      hud.setMoney(economy.state.money);
      hud.killfeed('YOU', bot.name, head, 'vanguard');
      audio.hit(true);
    } else {
      audio.hit(false);
    }
    hud.hitMarker(killed, markerHoldMs);
  }
  weapon.pullTrigger();
  audio.shot(def.id);
  player.recoil(def.recoilPitch + random() * 0.004, (random() * 2 - 1) * def.recoilYaw);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function onPlayerDamage(amount, bot) {
  if (shot) return; // Captures are staged: the player never dies in a screenshot.
  if (!match.alive || match.phase !== 'live') return;
  const absorbed = Math.min(economy.state.armor, amount * 0.5);
  economy.state.armor -= absorbed;
  match.hp -= (amount - absorbed);
  hud.setHealth(match.hp, economy.state.armor);
  hud.damageFlash();
  audio.hurt();
  if (match.hp <= 0) {
    match.hp = 0;
    match.alive = false;
    hud.setHealth(0, economy.state.armor);
    hud.killfeed(bot.name, 'YOU', false, 'raider');
    hud.banner('YOU ARE DOWN', 'Your squad fights on.', false, 2500);
    checkElimination();
  }
}

function checkElimination() {
  if (match.phase !== 'live') return;
  const raiders = bots.aliveCount('raider');
  const vanguard = bots.aliveCount('vanguard') + (match.alive ? 1 : 0);
  if (raiders === 0) endRound('vanguard', 'Raider squad wiped.');
  else if (vanguard === 0 && !match.bombPlanted) endRound('raider', 'Vanguard squad wiped.');
}

function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return key;
  }
  return null;
}

function plantBomb() {
  const site = SITES[match.plantSite];
  match.bombPlanted = true;
  match.bombSite = match.plantSite;
  match.bombPos = { x: body.position.x, z: body.position.z };
  match.bombFuse = BOMB_FUSE;
  match.plantProgress = 0;
  match.plantSite = null;
  bombMesh.position.set(match.bombPos.x, 0.12, match.bombPos.z);
  bombMesh.visible = true;
  economy.onPlant();
  hud.setMoney(economy.state.money);
  hud.setPlant(null, null);
  audio.beep(1500);
  hud.banner('BOMB PLANTED', `${site.name} — hold the site for ${BOMB_FUSE}s.`, true, 3000);
}

function explodeBomb() {
  const pos = new THREE.Vector3(match.bombPos.x, 0.6, match.bombPos.z);
  spawnExplosion(pos, 7);
  audio.explosion();
  match.bombPlanted = false;
  bombMesh.visible = false;
  endRound('vanguard', 'The bomb detonated.');
}

function spawnExplosion(pos, radius) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 }),
  );
  mesh.position.copy(pos);
  scene.add(mesh);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 18, 1.5);
  light.position.copy(pos);
  scene.add(light);
  effects.push({ mesh, light, life: 0.5, max: 0.5, radius });
  // Blast damage: bots caught in the open take the brunt of it.
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.mover.body.position.x - pos.x, bot.mover.body.position.z - pos.z);
    if (d < radius) {
      const dmg = Math.round(120 * (1 - d / radius) + 10);
      const killed = bots.damage(bot, dmg, match.elapsed);
      if (killed) hud.killfeed('BOMB', bot.name, false, 'vanguard');
    }
  }
  if (match.alive) {
    const d = Math.hypot(body.position.x - pos.x, body.position.z - pos.z);
    if (d < radius) onPlayerDamage(Math.round(90 * (1 - d / radius) + 10), { name: 'BOMB' });
  }
}

function throwGrenade() {
  if (economy.state.grenades <= 0 || match.phase !== 'live' || !match.alive) return;
  economy.state.grenades -= 1;
  audio.grenadePin();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.4, metalness: 0.6 }),
  );
  camera.getWorldDirection(direction);
  mesh.position.copy(camera.position).addScaledVector(direction, 0.5);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: 1.8,
    armed: false,
  });
}

function stepGrenade(g, dt) {
  g.fuse -= dt;
  g.vel.y -= 18 * dt;
  const prev = g.mesh.position.clone();
  g.mesh.position.addScaledVector(g.vel, dt);
  // A grenade that hits something arms itself and blows half a second later,
  // so a throw at someone's feet lands on them instead of sailing past.
  function arm() {
    if (!g.armed) {
      g.armed = true;
      g.fuse = Math.min(g.fuse, 0.45);
    }
  }
  if (g.mesh.position.y < 0.09) {
    g.mesh.position.y = 0.09;
    g.vel.y *= -0.4;
    g.vel.x *= 0.7;
    g.vel.z *= 0.7;
    arm();
  }
  if (overlapsAt(world.colliders, g.mesh.position.x, g.mesh.position.y, g.mesh.position.z, 0.18, 0)) {
    g.mesh.position.copy(prev);
    g.vel.multiplyScalar(-0.3);
    arm();
  }
  if (g.fuse <= 0) {
    spawnExplosion(g.mesh.position.clone(), 6);
    audio.explosion();
    scene.remove(g.mesh);
    return false;
  }
  return true;
}

function botContext() {
  playerChest.set(body.position.x, body.position.y + 1.2, body.position.z);
  return {
    time: match.elapsed,
    playerAlive: match.alive,
    playerPos: body.position,
    playerChest,
    playerSpeed: player.groundSpeed(),
    audio,
    bombPlanted: match.bombPlanted,
    bombSite: match.bombSite,
    onPlayerDamage,
    onKill(killer, victim, headshot, team) {
      hud.killfeed(killer, victim, headshot, team);
    },
    onDefused(bot) {
      hud.killfeed(bot.name, 'BOMB', false, 'raider');
      match.bombPlanted = false;
      bombMesh.visible = false;
      endRound('raider', 'The bomb was defused.');
    },
  };
}

function step(dt) {
  match.elapsed += dt;
  if (match.phase === 'freeze') {
    match.timer -= dt;
    hud.setTimer(Math.max(0, match.timer), 'freeze');
    if (match.timer <= 0) {
      match.phase = 'live';
      match.timer = ROUND_TIME;
      hud.hideBuy();
      buyOpen = false;
      hud.setTimer(ROUND_TIME, 'live');
    }
    return;
  }
  if (match.phase === 'roundEnd') {
    if (match.elapsed - match.roundEndAt > 4.5) {
      if (match.scoreV >= WIN_ROUNDS || match.scoreR >= WIN_ROUNDS || match.round >= MAX_ROUNDS) endMatch();
      else {
        match.round += 1;
        startRound();
      }
    }
    return;
  }
  if (match.phase !== 'live') return;

  // Round timer: the fuse takes over once the bomb is down.
  if (match.bombPlanted) {
    match.bombFuse -= dt;
    hud.setTimer(Math.max(0, match.bombFuse), 'live');
    const sec = Math.ceil(match.bombFuse);
    if (sec !== match.lastBeepSecond) {
      match.lastBeepSecond = sec;
      if (sec <= 10) audio.beep(sec <= 5 ? 1800 : 1200);
    }
    bombLight.material.color.setHex(Math.floor(match.elapsed * 4) % 2 === 0 ? 0xff5a4e : 0xf0a830);
    if (match.bombFuse <= 0) {
      explodeBomb();
      return;
    }
  } else {
    match.timer -= dt;
    hud.setTimer(Math.max(0, match.timer), 'live');
    if (match.timer <= 0) {
      endRound('raider', 'Time expired — Raiders hold the yard.');
      return;
    }
  }

  player.step(dt, input.state.keys);
  weapon.step(dt);
  weapon.setAiming(input.state.aiming && match.alive);
  const fovTarget = 74 - weapon.aimAmount() * 19;
  if (Math.abs(camera.fov - fovTarget) > 0.1) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  bots.step(dt, botContext());

  // Planting: hold E inside a site.
  if (match.alive && !match.bombPlanted && input.state.keys.has('KeyE')) {
    const site = siteAt(body.position.x, body.position.z);
    if (site) {
      if (match.plantSite !== site) {
        match.plantSite = site;
        match.plantProgress = 0;
      }
      match.plantProgress += dt / PLANT_TIME;
      hud.setPlant(`PLANTING — ${SITES[site].name}`, Math.min(1, match.plantProgress));
      if (match.plantProgress >= 1) plantBomb();
    } else {
      match.plantProgress = 0;
      match.plantSite = null;
      hud.setPlant(null, null);
    }
  } else if (match.plantProgress > 0) {
    match.plantProgress = 0;
    match.plantSite = null;
    hud.setPlant(null, null);
  }

  // Grenades and explosion effects.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    if (!stepGrenade(grenades[i], dt)) grenades.splice(i, 1);
  }
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const e = effects[i];
    e.life -= dt;
    const frac = Math.max(0, e.life / e.max);
    e.mesh.scale.setScalar(1 + (1 - frac) * e.radius);
    e.mesh.material.opacity = frac * 0.9;
    e.light.intensity = frac * 60;
    if (e.life <= 0) {
      scene.remove(e.mesh);
      scene.remove(e.light);
      effects.splice(i, 1);
    }
  }

  // HUD: zone, minimap, crosshair spread.
  hud.setZone(zoneAt(body.position.x, body.position.z));
  if (match.elapsed - minimapAt > 0.15) {
    minimapAt = match.elapsed;
    hud.drawMinimap(world.wallRects, body.position, body.yaw, bots.bots,
      match.bombPlanted ? { planted: true, x: match.bombPos.x, z: match.bombPos.z } : null);
  }
  hud.setCrosshairSpread(6 + weapon.spread(player.groundSpeed()) * 260);
  checkElimination();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (match.alive && (match.phase === 'live' || match.phase === 'freeze')) player.look(look.x, look.y);
    // Key taps: buy menu, grenade, weapon slots, reload.
    for (const code of input.takePressed()) {
      if (code === 'KeyB' && match.phase === 'freeze') {
        buyOpen = !buyOpen;
        if (buyOpen) hud.showBuy(economy.state.money, economy.state.owned);
        else hud.hideBuy();
      } else if (code === 'KeyG') {
        throwGrenade();
      } else if (code === 'KeyR') {
        weapon.reload();
        audio.reload();
      } else if (code === 'KeyQ') {
        const owned = Object.keys(WEAPONS).filter((id) => economy.state.owned[id]);
        const idx = owned.indexOf(weapon.current().id);
        const next = owned[(idx + 1) % owned.length];
        if (next && next !== weapon.current().id) {
          weapon.equip(next);
          hud.setWeapon(weapon.current().name.toUpperCase());
          hud.setAmmo(weapon.state.mag, weapon.state.reserve);
        }
      } else if (match.phase === 'freeze' && buyOpen && /^Digit[1-6]$/.test(code)) {
        const row = BUY_MENU[Number(code.slice(5)) - 1];
        if (row) onBuy(row.kind, row.id);
      } else if (match.phase === 'live' && /^Digit[123]$/.test(code)) {
        const want = code === 'Digit1' ? 'p9' : code === 'Digit2' ? 'vk47' : 'longbow';
        const id = want === 'vk47' && !economy.state.owned.vk47 && economy.state.owned.hornet ? 'hornet' : want;
        if (economy.state.owned[id] && id !== weapon.current().id) {
          weapon.equip(id);
          hud.setWeapon(weapon.current().name.toUpperCase());
          hud.setAmmo(weapon.state.mag, weapon.state.reserve);
        }
      }
    }
    // Firing: autos hold, semis need a fresh press.
    const firing = input.state.firing && match.alive && match.phase === 'live';
    const def = weapon.current();
    if (firing && weapon.ready()) {
      if (def.auto || !prevFiring) playerShoot();
    }
    prevFiring = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  body.pitch = 0;
  body.yaw = 0;
  match.phase = 'live';
  match.timer = ROUND_TIME;
  match.round = 1;
  started = true;
  if (name === 'start') {
    body.position.set(0.6, 0, 13.5);
    body.yaw = 0.15;
    settle(30);
    // Stage a teammate in frame so the menu shot shows the squad, not an empty yard.
    const juno = bots.bots.find((b) => b.name === 'Juno');
    if (juno) {
      juno.mover.body.position.set(-2.5, 0, 9.5);
      juno.mover.body.yaw = 0.2;
    }
    bots.step(0.05, botContext());
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.setScore(0, 0, 1);
    hud.setTimer(ROUND_TIME, 'live');
    hud.showOverlay('start');
  } else if (name === 'play') {
    // A Lane, looking north: clear sightline down the lane, one Raider down in
    // the open and one more in the sights. Staged after the settle so nothing
    // moves or shoots first.
    body.position.set(-16, 0, 2);
    settle(20);
    const hale = bots.bots.find((b) => b.name === 'Hale');
    const vex = bots.bots.find((b) => b.name === 'Vex');
    if (hale) {
      hale.mover.body.position.set(-14.5, 0, -1.5);
      bots.damage(hale, 200, match.elapsed);
      hale.fall = 1;
      hud.killfeed('YOU', 'Hale', true, 'vanguard');
    }
    if (vex) {
      vex.mover.body.position.set(-16, 0, -6);
      vex.mover.body.yaw = Math.PI;
    }
    bots.step(0.05, botContext());
    aimAt(new THREE.Vector3(-16, 1.2, -6));
    weapon.state.mag = 24;
    hud.setAmmo(24, 90);
    hud.setScore(0, 0, 1);
    hud.setTimer(87, 'live');
    hud.setMoney(1100);
    hud.hitMarker(true, 4000);
  } else {
    // end: a round just won, banner up, score on the board.
    body.position.set(-8, 0, 2);
    settle(20);
    const rook = bots.bots.find((b) => b.name === 'Rook');
    if (rook) {
      rook.mover.body.position.set(-12, 0, -8);
      bots.damage(rook, 200, match.elapsed);
      rook.fall = 1;
    }
    bots.step(0.05, botContext());
    aimAt(new THREE.Vector3(-14, 1.4, -10));
    match.scoreV = 3;
    match.scoreR = 2;
    hud.setScore(3, 2, 6);
    hud.setTimer(0, 'live');
    hud.banner('ROUND WON', 'Raider squad wiped — Site A is yours.', true, 60000);
  }
  hud.setHealth(match.hp, economy.state.armor);
  hud.setZone(zoneAt(body.position.x, body.position.z));
  hud.drawMinimap(world.wallRects, body.position, body.yaw, bots.bots, null);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
// A small debug handle for headless play-tests: move the player, read the match
// state, damage a bot. It changes nothing about the game itself.
window.__sandline = { match, body, bots, economy, weapon, startMatch, endRound, shoot: playerShoot, throwGrenade };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
