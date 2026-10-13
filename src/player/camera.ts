import { Vector3 } from 'three';
import { Spring, Spring3 } from '../core/springs';
import { defineTunables } from '../dev/tuning';
import { MOVE, type PlayerController } from './controller';

/** Camera feel: eye height transitions, FOV kicks, roll, landing dip, bob. Angles in degrees. */
export const CAM = defineTunables(
  'camera',
  {
    standEye: 1.62,
    crouchEye: 1.0,
    slideEye: 0.8,
    eyeRate: 14,
    stepSmoothRate: 16,
    sprintFov: 4,
    tacSprintFov: 9,
    slideFov: 7,
    fovFrequency: 3,
    slideRoll: 4,
    strafeRoll: 0.8,
    rollFrequency: 4,
    landDipPerSpeed: 0.012,
    landDipMax: 0.16,
    dipFrequency: 6,
    dipDamping: 0.45,
    bobAmount: 0.012,
    bobSprintMul: 1.8,
    bobStride: 2.6,
    mantlePitch: 5,
    hurtKick: 2.2,
  },
  {
    bobAmount: [0, 0.08, 0.001],
    landDipPerSpeed: [0, 0.05, 0.001],
    slideRoll: [-15, 15, 0.5],
    strafeRoll: [0, 5, 0.1],
  },
);

export interface CameraPose {
  /** Eye height above the feet, including dip/bob/step smoothing. */
  eyeY: number;
  roll: number;
  pitchOffset: number;
  fovDelta: number;
}

export class CameraRig {
  private eye = CAM.standEye;
  private stepSmooth = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private readonly fov = new Spring(CAM.fovFrequency, 1);
  private readonly roll = new Spring(CAM.rollFrequency, 1);
  private readonly dip = new Spring(CAM.dipFrequency, CAM.dipDamping);
  /** Hit flinch: x = pitch, z = roll (degrees). */
  private readonly hurtSpring = new Spring3(7, 0.4);
  readonly current: CameraPose = { eyeY: CAM.standEye, roll: 0, pitchOffset: 0, fovDelta: 0 };
  readonly previous: CameraPose = { ...this.current };

  reset() {
    this.eye = CAM.standEye;
    this.stepSmooth = 0;
    this.fov.reset();
    this.roll.reset();
    this.dip.reset();
    this.hurtSpring.reset();
  }

  /** Getting shot: a short flinch away from the attacker. `fromDir` = world direction to the attacker. */
  hurt(fromDir: Vector3, yaw = 0) {
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const side = fromDir.lengthSq() > 0 ? fromDir.clone().normalize().dot(right) : 0;
    const w = 2 * Math.PI * 7;
    this.hurtSpring.impulse(CAM.hurtKick * w * 0.6, 0, -side * CAM.hurtKick * w);
  }

  /** Call once per sim step, after the controller stepped. */
  update(dt: number, ctrl: PlayerController, yaw: number) {
    Object.assign(this.previous, this.current);
    this.fov.frequency = CAM.fovFrequency;
    this.roll.frequency = CAM.rollFrequency;
    this.dip.frequency = CAM.dipFrequency;
    this.dip.damping = CAM.dipDamping;

    const state = ctrl.state;
    const eyeTarget =
      ctrl.posture === 'slide'
        ? CAM.slideEye
        : ctrl.posture === 'crouch'
          ? CAM.crouchEye
          : CAM.standEye;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-CAM.eyeRate * dt));

    // Step-ups move the feet instantly; let the eye catch up smoothly.
    this.stepSmooth -= ctrl.stepDelta;
    this.stepSmooth *= Math.exp(-CAM.stepSmoothRate * dt);

    if (ctrl.landedSpeed > 2)
      this.dip.impulse(-Math.min(ctrl.landedSpeed * CAM.landDipPerSpeed * 10, CAM.landDipMax * 10));
    this.dip.step(dt);
    this.hurtSpring.step(dt);

    this.fov.target =
      state === 'tacSprint'
        ? CAM.tacSprintFov
        : state === 'sprint'
          ? CAM.sprintFov
          : state === 'slide'
            ? CAM.slideFov
            : 0;
    this.fov.step(dt);

    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const lateral = ctrl.velocity.dot(right) / MOVE.walkSpeed;
    this.roll.target = (state === 'slide' ? CAM.slideRoll : 0) - lateral * CAM.strafeRoll;
    this.roll.step(dt);

    // Bob: phase advances with distance travelled, fades in/out with ground speed.
    const moving = ctrl.grounded && ctrl.posture !== 'slide' && !ctrl.mantle;
    const speedK = moving ? Math.min(ctrl.horizontalSpeed / MOVE.walkSpeed, 2) : 0;
    this.bobWeight += (speedK - this.bobWeight) * (1 - Math.exp(-10 * dt));
    this.bobPhase += (ctrl.horizontalSpeed * dt * 2 * Math.PI) / CAM.bobStride;
    const sprintMul = state === 'sprint' || state === 'tacSprint' ? CAM.bobSprintMul : 1;
    const bob = Math.sin(this.bobPhase * 2) * CAM.bobAmount * this.bobWeight * sprintMul;

    const m = ctrl.mantle;
    this.current.pitchOffset =
      (m ? -Math.sin(m.t * Math.PI) * CAM.mantlePitch : 0) + this.hurtSpring.value.x;
    this.current.eyeY = this.eye + this.stepSmooth + this.dip.value * 0.1 + bob;
    this.current.roll = this.roll.value + this.hurtSpring.value.z;
    this.current.fovDelta = this.fov.value;
  }

  /** Interpolated pose for rendering. */
  pose(alpha: number, out: CameraPose): CameraPose {
    const a = this.previous;
    const b = this.current;
    out.eyeY = a.eyeY + (b.eyeY - a.eyeY) * alpha;
    out.roll = a.roll + (b.roll - a.roll) * alpha;
    out.pitchOffset = a.pitchOffset + (b.pitchOffset - a.pitchOffset) * alpha;
    out.fovDelta = a.fovDelta + (b.fovDelta - a.fovDelta) * alpha;
    return out;
  }
}
