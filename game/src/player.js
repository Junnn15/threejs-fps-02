// Player movement on the shared physics body: acceleration, friction, gravity,
// crouch and jump. The keys here are the only input this module reads; main.js owns
// the shooting, the rounds and everything else.
import { createBody } from './physics.js';

export function createPlayer(colliders) {
  const mover = createBody(colliders, {
    x: 0,
    z: 13.5,
    yaw: 0,
    standHeight: 1.72,
    crouchHeight: 1.12,
    standEye: 1.6,
    crouchEye: 1.02,
    walkSpeed: 5.2,
    crouchSpeed: 2.4,
    groundAccel: 42,
    airAccel: 9,
    friction: 9,
    jumpSpeed: 6.2,
  });
  const player = mover.body;
  player.pitch = 0;

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    mover.step(dt, forward, strafe, crouch, keys.has('Space'));
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed: mover.groundSpeed,
  };
}
