// Kestrel Yard: the map. A 46 x 34 m yard with three lanes and two bombsites.
// Vanguard (the player) attacks from the south; Raiders defend the north.
// Site A "Foundry" sits north-west, Site B "Silo" north-east, Mid runs between them.
// Every box is a collider for players and bots and a surface bullets stop on.
// Waypoints form a graph bots route over with BFS; zones name the HUD's location readout.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = { minX: -23, maxX: 23, minZ: -17, maxZ: 17 };
export const SITES = {
  A: { name: 'Site A — Foundry', cx: -16, cz: -11, x0: -21, x1: -11, z0: -15, z1: -7, color: PALETTE.siteA },
  B: { name: 'Site B — Silo', cx: 16, cz: -11, x0: 11, x1: 21, z0: -15, z1: -7, color: PALETTE.siteB },
};
export const SPAWNS = {
  vanguard: [[-3, 13.5], [0, 14.5], [3, 13.5]],
  raider: [[-4, -14.5], [0, -15.2], [4, -14.5]],
};

// Waypoint graph: [x, z] nodes, edges by index. Bots BFS over this.
export const WAYPOINTS = [
  [0, 13.5], [-16, 6], [16, 6], [0, 6], [0, 0], [0, -4],
  [-18, 6], [-18, 0], [-18, -5], [-16, -11], [-20, -11],
  [18, 6], [18, 0], [18, -5], [16, -11], [20, -11],
  [0, -14.5], [-12, -9], [12, -9],
];
export const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 6], [2, 11], [3, 4], [3, 6], [3, 11],
  [4, 5], [4, 7], [4, 12], [5, 17], [5, 18], [6, 7], [7, 8], [8, 9],
  [8, 10], [9, 10], [11, 12], [12, 13], [13, 14], [13, 15], [14, 15],
  [16, 17], [16, 18], [16, 5], [17, 9], [18, 14],
];

export function zoneAt(x, z) {
  if (x >= SITES.A.x0 && x <= SITES.A.x1 && z >= SITES.A.z0 && z <= SITES.A.z1) return SITES.A.name;
  if (x >= SITES.B.x0 && x <= SITES.B.x1 && z >= SITES.B.z0 && z <= SITES.B.z1) return SITES.B.name;
  if (z >= 10) return 'Vanguard Spawn';
  if (z <= -13.5) return 'North Yard';
  if (x <= -12) return 'A Lane';
  if (x >= 12) return 'B Lane';
  if (z >= 4) return 'Connector';
  if (Math.abs(x) < 6 && z >= -6) return 'Mid';
  return 'North Yard';
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  const wallRects = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      wallRects.push({ x0: x - width / 2, x1: x + width / 2, z0: z - depth / 2, z1: z + depth / 2 });
    }
    shootables.push(mesh);
    return mesh;
  }

  // Floor and outer walls (46 x 34, 4.6 m high, open sky). The floor is the
  // lighter surface tone so the yard reads at a glance, even in shadow.
  box(46.4, 0.4, 34.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.6, 34.4, -23.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 34.4, 23.2, 2.3, 0, 'surface');
  box(46.4, 4.6, 0.4, 0, 2.3, -17.2, 'surface');
  box(46.4, 4.6, 0.4, 0, 2.3, 17.2, 'surface');

  // Lane dividers: full-height walls with a gap at z -4..2 so lanes join Mid.
  box(0.6, 3.4, 12, -10, 1.7, -10, 'surface');
  box(0.6, 3.4, 12, 10, 1.7, -10, 'surface');
  // North wall between the sites: Mid passes through its centre gap.
  box(6, 3.4, 0.6, -7, 1.7, -6, 'surface');
  box(6, 3.4, 0.6, 7, 1.7, -6, 'surface');
  // South connector wall: the mid gap is the fast route out of spawn.
  box(16, 3.4, 0.6, -15, 1.7, 4, 'surface');
  box(16, 3.4, 0.6, 15, 1.7, 4, 'surface');
  // Mid kiosk: splits Mid into two sightlines.
  box(4, 2.4, 2.4, 0, 1.2, -2, 'hairline');
  // Site A: furnace block and crates.
  box(3.2, 2.6, 2.4, -20, 1.3, -13.5, 'hairline');
  box(1.6, 1.1, 1.6, -14, 0.55, -13, 'hairline');
  box(1.6, 1.1, 1.6, -18, 0.55, -8.5, 'hairline');
  box(1.2, 2.2, 1.2, -12.5, 1.1, -9, 'hairline');
  // Site B: silo block and crates.
  box(3.2, 3.0, 3.2, 19.5, 1.5, -13.5, 'hairline');
  box(1.6, 1.1, 1.6, 14, 0.55, -13, 'hairline');
  box(1.6, 1.1, 1.6, 17.5, 0.55, -8.5, 'hairline');
  box(1.2, 2.2, 1.2, 12.5, 1.1, -9, 'hairline');
  // Lane cover: crouch-height crates to peek over.
  box(1.6, 1.1, 1.6, -17, 0.55, 2, 'hairline');
  box(1.6, 1.1, 1.6, -15, 0.55, -4, 'hairline');
  box(1.6, 1.1, 1.6, 17, 0.55, 2, 'hairline');
  box(1.6, 1.1, 1.6, 15, 0.55, -4, 'hairline');
  // Mid cover.
  box(2.4, 1.1, 1.2, -3.2, 0.55, 1.5, 'hairline');
  box(2.4, 1.1, 1.2, 3.2, 0.55, -0.5, 'hairline');
  // Spawn cover.
  box(2.4, 1.1, 1.2, -6, 0.55, 10, 'hairline');
  box(2.4, 1.1, 1.2, 6, 0.55, 10, 'hairline');

  // Plant-zone pads: coloured floor inlays that mark where the bomb goes.
  for (const site of [SITES.A, SITES.B]) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(site.x1 - site.x0, site.z1 - site.z0),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(site.color), roughness: 0.9, transparent: true, opacity: 0.16 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.cx, 0.02, site.cz);
    pad.receiveShadow = true;
    group.add(pad);
  }

  // Site letters: canvas textures, no external assets.
  function sign(letter, color, x, y, z, ry) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e2228';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    group.add(mesh);
  }
  sign('A', PALETTE.siteA, -16, 3.2, -16.9, 0);
  sign('B', PALETTE.siteB, 16, 3.2, -16.9, 0);

  // Light: a warm key from the front right, a cool fill from behind, and a sky/ground
  // gradient. The sky colour is the pale ink tone, so the yard lifts out of the
  // dark canvas instead of sinking into it.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.ink), new THREE.Color(PALETTE.hairline), 1.0);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.6);
  key.position.set(12, 18, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.8);
  fill.position.set(-10, 12, 12);
  scene.add(fill);
  // Warm pools of light over the two sites, so each reads at a glance.
  for (const site of [SITES.A, SITES.B]) {
    const lamp = new THREE.PointLight(new THREE.Color(site.color), 22, 16, 1.8);
    lamp.position.set(site.cx, 3.4, site.cz);
    scene.add(lamp);
  }

  return { colliders, shootables, group, wallRects };
}
