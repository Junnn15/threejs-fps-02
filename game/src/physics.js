// Shared movement: one axis-separated AABB mover used by the player and every bot.
// A body is a vertical box (radius, height) that accelerates toward a wish direction,
// slides along walls, and lands on the floor. No per-frame allocation in the hot path:
// the probe box and the wish vector are reused module-wide.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;

const probe = new THREE.Box3();
const wish = new THREE.Vector3();

export function overlapsAt(colliders, x, y, z, height, lift) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// A body that moves through the world. `opts` sets stand/crouch heights and speeds;
// bots pass their own numbers, the player passes its own.
export function createBody(colliders, opts) {
  const body = {
    position: new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0),
    velocity: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    height: opts.standHeight ?? 1.72,
    eye: opts.standEye ?? 1.6,
    onGround: true,
    crouching: false,
  };
  const standHeight = opts.standHeight ?? 1.72;
  const crouchHeight = opts.crouchHeight ?? 1.12;
  const standEye = opts.standEye ?? 1.6;
  const crouchEye = opts.crouchEye ?? 1.02;
  const walkSpeed = opts.walkSpeed ?? 5.2;
  const crouchSpeed = opts.crouchSpeed ?? 2.4;
  const groundAccel = opts.groundAccel ?? 42;
  const airAccel = opts.airAccel ?? 9;
  const friction = opts.friction ?? 9;
  const jumpSpeed = opts.jumpSpeed ?? 6.2;

  function step(dt, forward, strafe, wantCrouch, wantJump) {
    const crouching = wantCrouch === true;
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = crouchHeight;
    } else if (!crouching && body.crouching
      && !overlapsAt(colliders, body.position.x, body.position.y, body.position.z, standHeight, 0.02)) {
      body.crouching = false;
      body.height = standHeight;
    }
    const eyeTarget = body.crouching ? crouchEye : standEye;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const speed = body.crouching ? crouchSpeed : walkSpeed;
    const blend = Math.min(1, (body.onGround ? groundAccel : airAccel) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (wantJump && body.onGround) {
      body.velocity.y = jumpSpeed;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlapsAt(colliders, nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlapsAt(colliders, body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlapsAt(colliders, body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return {
    body,
    step,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
  };
}
