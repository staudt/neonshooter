import { Vector3 } from 'three';
import type { InputState } from '../core/input';
import { defineTunables } from '../dev/tuning';

/** Temporary noclip controller used until the real movement lands (milestone 3). */
export const FLY = defineTunables(
  'debugFly',
  { speed: 8, sprintMul: 2.5 },
  { speed: [1, 30, 0.5] },
);

export class DebugFly {
  readonly position = new Vector3(0, 1.7, 6);
  readonly prevPosition = this.position.clone();

  step(dt: number, input: InputState, yaw: number, pitch: number) {
    this.prevPosition.copy(this.position);
    const fwd = new Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new Vector3();
    if (input.down.has('forward')) move.add(fwd);
    if (input.down.has('back')) move.sub(fwd);
    if (input.down.has('right')) move.add(right);
    if (input.down.has('left')) move.sub(right);
    if (input.down.has('jump')) move.y += 1;
    if (input.down.has('crouch')) move.y -= 1;
    if (move.lengthSq() > 0) move.normalize();
    const speed = FLY.speed * (input.down.has('sprint') ? FLY.sprintMul : 1);
    this.position.addScaledVector(move, speed * dt);
  }
}
