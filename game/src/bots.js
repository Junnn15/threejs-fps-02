// The bots: two Vanguard teammates who follow the player, and three Raider defenders
// who hold the sites, rotate to a planted bomb and defuse it. Each bot is a small
// state machine over a waypoint graph: it routes with BFS, peeks and strafes in a
// fight, and takes cover when hurt. Shooting is a burst model with a reaction time
// and an aim error that grows with distance, so bots are threatening but beatable.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './physics.js';
import { WAYPOINTS, EDGES, SITES } from './world.js';
import { BOT_WEAPON } from './weapons.js';

const BOT_SPEED = 4.4;
const DEFUSE_SECONDS = 5;
const SENSE_EVERY = 0.12;
const TRACE_COUNT = 24;

const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function bfsPath(start, goal) {
  if (start === goal) return [goal];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of ADJ[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === goal) {
        const path = [goal];
        let node = goal;
        while (node !== start) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [goal];
}

function makeHealthBar(scene, group) {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0x14161a, depthTest: false }));
  bg.scale.set(0.62, 0.08, 1);
  bg.position.set(0, 1.98, 0);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0x7dd069, depthTest: false }));
  fg.scale.set(0.6, 0.05, 1);
  fg.position.set(0, 1.98, 0);
  group.add(bg, fg);
  return { bg, fg };
}

function makeBotMesh(team) {
  const color = team === 'vanguard' ? PALETTE.vanguard : PALETTE.raider;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.55 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.95, 10), bodyMat);
  torso.position.y = 0.98;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), headMat);
  head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.06), darkMat);
  visor.position.set(0, 1.64, -0.15);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.62), darkMat);
  gun.position.set(0.2, 1.15, -0.3);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), darkMat);
  legs.position.y = 0.25;
  group.add(torso, head, visor, gun, legs);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  const bar = makeHealthBar(group, group);
  return { group, torso, head, bar, bodyMat };
}

export function createBots(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const dir = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const eyePos = new THREE.Vector3();
  const tracers = [];
  for (let i = 0; i < TRACE_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  function fireTracer(from, to, color) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACE_COUNT;
    t.line.material.color.setHex(color);
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.material.opacity = 0.85;
    t.life = 0.09;
  }

  const bots = [];
  const hitMeshes = [];

  function addBot(team, name, spawn, holdSite) {
    const mover = createBody(world.colliders, {
      x: spawn[0], z: spawn[1], walkSpeed: BOT_SPEED, groundAccel: 30, friction: 8,
    });
    const mesh = makeBotMesh(team);
    scene.add(mesh.group);
    const bot = {
      team, name, mover, mesh, holdSite,
      health: 100, alive: true, fall: 0,
      route: [], routeIndex: 0, repathAt: 0,
      target: null, reactAt: 0, burstLeft: 0, burstAt: 0, restUntil: 0,
      strafeDir: 1, strafeAt: 0, senseAt: 0, coverUntil: 0,
      defuseProgress: 0, guardPoint: null, seenAt: 0,
    };
    mesh.torso.userData.bot = bot;
    mesh.torso.userData.part = 'torso';
    mesh.head.userData.bot = bot;
    mesh.head.userData.part = 'head';
    hitMeshes.push(mesh.torso, mesh.head);
    bots.push(bot);
    return bot;
  }

  function spawnAll(round) {
    // Teammates: Juno and Mara. Defenders: Vex (A), Rook (B), Hale (Mid).
    bots.length = 0;
    hitMeshes.length = 0;
    const v = [[-3, 13.5], [3, 13.5]];
    const r = [[-4, -14.5], [4, -14.5], [0, -15.2]];
    addBot('vanguard', 'Juno', v[0], null);
    addBot('vanguard', 'Mara', v[1], null);
    addBot('raider', 'Vex', r[0], 'A');
    addBot('raider', 'Rook', r[1], 'B');
    addBot('raider', 'Hale', r[2], null);
    void round;
  }

  function resetRound() {
    for (const bot of bots) {
      const spawn = bot.team === 'vanguard'
        ? (bot.name === 'Juno' ? [-3, 13.5] : [3, 13.5])
        : (bot.name === 'Vex' ? [-4, -14.5] : bot.name === 'Rook' ? [4, -14.5] : [0, -15.2]);
      bot.mover.body.position.set(spawn[0], 0, spawn[1]);
      bot.mover.body.velocity.set(0, 0, 0);
      bot.mover.body.yaw = bot.team === 'vanguard' ? 0 : Math.PI;
      bot.health = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.route = [];
      bot.routeIndex = 0;
      bot.target = null;
      bot.burstLeft = 0;
      bot.defuseProgress = 0;
      bot.mesh.group.rotation.set(0, bot.mover.body.yaw, 0);
      bot.mesh.group.visible = true;
      bot.mesh.bar.bg.visible = true;
      bot.mesh.bar.fg.visible = true;
    }
  }

  function losClear(from, to) {
    toTarget.subVectors(to, from);
    const dist = toTarget.length();
    if (dist < 0.01) return true;
    dir.copy(toTarget).normalize();
    raycaster.set(from, dir);
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  function setRoute(bot, goalIdx) {
    const start = nearestWaypoint(bot.mover.body.position.x, bot.mover.body.position.z);
    bot.route = bfsPath(start, goalIdx);
    bot.routeIndex = 0;
  }

  function routeTarget(bot) {
    if (bot.routeIndex >= bot.route.length) return null;
    const node = WAYPOINTS[bot.route[bot.routeIndex]];
    const dx = node[0] - bot.mover.body.position.x;
    const dz = node[1] - bot.mover.body.position.z;
    if (dx * dx + dz * dz < 0.36) {
      bot.routeIndex += 1;
      return routeTarget(bot);
    }
    return node;
  }

  // One shot from a bot at its target: an angular error decides hit or miss, so
  // distance and a moving target matter. Returns 'hit' | 'head' | 'miss'.
  function botShoot(bot, targetPos, targetSpeed, ctx) {
    const from = eyePos.set(
      bot.mover.body.position.x,
      bot.mover.body.position.y + 1.5,
      bot.mover.body.position.z,
    );
    const dist = from.distanceTo(targetPos);
    const maxErrDeg = BOT_WEAPON.aimDeg10 + (BOT_WEAPON.aimDeg25 - BOT_WEAPON.aimDeg10)
      * Math.min(1, Math.max(0, (dist - 10) / 15));
    const maxErr = (maxErrDeg * Math.PI) / 180 * (1 + targetSpeed * 0.08);
    // Triangular-ish error: three uniforms, centred.
    const err = ((Math.random() + Math.random() + Math.random()) - 1.5) / 1.5 * maxErr;
    const torsoAngle = Math.atan2(0.28, dist);
    const headAngle = Math.atan2(0.12, dist);
    const hitPoint = targetPos.clone();
    hitPoint.x += (Math.random() * 2 - 1) * 0.4;
    hitPoint.y += (Math.random() * 2 - 1) * 0.5;
    hitPoint.z += (Math.random() * 2 - 1) * 0.4;
    fireTracer(from, hitPoint, bot.team === 'vanguard' ? 0x4aa3ff : 0xff5a4e);
    ctx.audio.distantShot();
    if (Math.abs(err) < headAngle && Math.random() < 0.5) return 'head';
    if (Math.abs(err) < torsoAngle) return 'hit';
    return 'miss';
  }

  function damageBot(bot, amount, ctx) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.defuseProgress = 0;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fall = 0;
      return true;
    }
    if (bot.health < 35 && ctx.time > bot.coverUntil) {
      bot.coverUntil = ctx.time + 1.6;
    }
    return false;
  }

  function stepBot(bot, dt, ctx) {
    const body = bot.mover.body;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.mesh.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    const now = ctx.time;

    // Senses: refresh the visible-enemy list a few times a second.
    if (now >= bot.senseAt) {
      bot.senseAt = now + SENSE_EVERY;
      bot.target = null;
      const eye = eyePos.set(body.position.x, body.position.y + 1.5, body.position.z);
      const candidates = [];
      if (ctx.playerAlive) candidates.push({ kind: 'player', pos: ctx.playerChest, speed: ctx.playerSpeed });
      for (const other of bots) {
        if (!other.alive || other.team === bot.team) continue;
        candidates.push({
          kind: 'bot', bot: other,
          pos: new THREE.Vector3(other.mover.body.position.x, other.mover.body.position.y + 1.2, other.mover.body.position.z),
          speed: other.mover.groundSpeed(),
        });
      }
      let bestD = Infinity;
      for (const cand of candidates) {
        const d = eye.distanceTo(cand.pos);
        if (d > BOT_WEAPON.range || d >= bestD) continue;
        if (!losClear(eye, cand.pos)) continue;
        bestD = d;
        bot.target = cand;
        if (bot.reactAt === 0) bot.reactAt = now + BOT_WEAPON.reactMin + Math.random() * (BOT_WEAPON.reactMax - BOT_WEAPON.reactMin);
      }
      if (!bot.target) bot.reactAt = 0;
    }

    // Objective: where the bot wants to be when it is not fighting.
    let goalIdx = null;
    let guard = false;
    if (ctx.bombPlanted) {
      const site = ctx.bombSite === 'A' ? SITES.A : SITES.B;
      if (bot.team === 'raider') {
        // Defenders rotate to the planted site and defuse when it is safe.
        const bombD = Math.hypot(site.cx - body.position.x, site.cz - body.position.z);
        if (bombD < 2.5 && !bot.target) {
          bot.defuseProgress += dt;
          if (bot.defuseProgress >= DEFUSE_SECONDS) ctx.onDefused(bot);
          goalIdx = null;
          guard = true;
        } else {
          goalIdx = nearestWaypoint(site.cx, site.cz);
        }
      } else {
        goalIdx = nearestWaypoint(site.cx + (bot.name === 'Juno' ? -2 : 2), site.cz + 2);
        guard = true;
      }
    } else if (bot.team === 'raider') {
      if (bot.holdSite === 'A') goalIdx = nearestWaypoint(SITES.A.cx, SITES.A.cz);
      else if (bot.holdSite === 'B') goalIdx = nearestWaypoint(SITES.B.cx, SITES.B.cz);
      else goalIdx = nearestWaypoint(0, -4); // Hale holds Mid.
      guard = true;
    } else {
      // Teammates shadow the player at an offset, so they fight beside you.
      const px = ctx.playerPos.x + (bot.name === 'Juno' ? -2.5 : 2.5);
      const pz = ctx.playerPos.z + 2.5;
      goalIdx = nearestWaypoint(px, pz);
    }
    if (goalIdx !== null && now >= bot.repathAt) {
      bot.repathAt = now + 1.0;
      setRoute(bot, goalIdx);
    }

    // Movement: fight in place (strafe) or walk the route.
    let forward = 0;
    let strafe = 0;
    if (bot.target && now >= bot.reactAt) {
      const t = bot.target.pos;
      body.yaw = Math.atan2(-(t.x - body.position.x), -(t.z - body.position.z));
      if (now >= bot.strafeAt) {
        bot.strafeAt = now + 0.6 + Math.random() * 0.7;
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      strafe = bot.strafeDir * 0.55;
      forward = 0.15;
    } else if (bot.target) {
      // Reacting: face the enemy, hold still.
      const t = bot.target.pos;
      body.yaw = Math.atan2(-(t.x - body.position.x), -(t.z - body.position.z));
    } else if (!guard || bot.route.length) {
      const node = routeTarget(bot);
      if (node) {
        body.yaw = Math.atan2(-(node[0] - body.position.x), -(node[1] - body.position.z));
        forward = bot.coverUntil > now ? 0 : 1;
        if (bot.coverUntil > now) {
          // Hurt: back away from the fight for a moment.
          body.yaw += Math.PI;
          forward = 1;
        }
      }
    }
    bot.mover.step(dt, forward, strafe, false, false);

    // Shooting: bursts with a rest between them.
    if (bot.target && now >= bot.reactAt && now >= bot.restUntil) {
      if (bot.burstLeft === 0) {
        bot.burstLeft = BOT_WEAPON.burstMin + Math.floor(Math.random() * (BOT_WEAPON.burstMax - BOT_WEAPON.burstMin + 1));
        bot.burstAt = now;
      }
      if (now >= bot.burstAt) {
        bot.burstAt = now + BOT_WEAPON.burstGap;
        bot.burstLeft -= 1;
        const result = botShoot(bot, bot.target.pos, bot.target.speed, ctx);
        if (result !== 'miss') {
          const dmg = result === 'head' ? BOT_WEAPON.damage * 2 : BOT_WEAPON.damage;
          if (bot.target.kind === 'player') ctx.onPlayerDamage(dmg, bot);
          else {
            const killed = damageBot(bot.target.bot, dmg, ctx);
            if (killed) ctx.onKill(bot.name, bot.target.bot.name, result === 'head', bot.team);
          }
        }
        if (bot.burstLeft === 0) bot.restUntil = now + BOT_WEAPON.restGap * (0.7 + Math.random() * 0.6);
      }
    }

    // Sync the mesh and the health bar.
    bot.mesh.group.position.set(body.position.x, body.position.y, body.position.z);
    bot.mesh.group.rotation.y = body.yaw;
    const frac = Math.max(0, bot.health / 100);
    bot.mesh.bar.fg.scale.x = 0.6 * frac;
    bot.mesh.bar.fg.material.color.setHex(frac > 0.5 ? 0x7dd069 : frac > 0.25 ? 0xf0a830 : 0xff5a4e);
  }

  function step(dt, ctx) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      }
    }
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  spawnAll(1);
  return {
    bots,
    hitMeshes,
    step,
    resetRound,
    // A tracer line from the player: same pool the bots use, so every shot reads.
    addTracer(from, to, color) {
      fireTracer(from, to, color);
    },
    damage(bot, amount, time = 0) {
      return damageBot(bot, amount, { time });
    },
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
  };
}
