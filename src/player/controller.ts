import { Vector3 } from 'three';
import type { InputState } from '../core/input';
import { defineTunables } from '../dev/tuning';
import { SETTINGS } from '../settings';
import {
  depenetrate,
  overlaps,
  probeGround,
  raycast,
  type Capsule,
  type Colliders,
  type Contact,
} from './collision';

/**
 * All movement feel values. Speeds m/s, accelerations m/s², times s, lengths m.
 * Friction/accel follow Quake/Source semantics (accel is "fraction of target speed per second").
 */
export const MOVE = defineTunables(
  'movement',
  {
    walkSpeed: 5.0,
    backwardMul: 0.8,
    sprintSpeed: 7.2,
    tacSprintSpeed: 8.8,
    crouchSpeed: 2.6,
    groundAccel: 12,
    groundFriction: 7,
    stopSpeed: 2.0,
    airAccel: 2.0,
    gravity: 20,
    jumpHeight: 1.0,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    doubleTapWindow: 0.3,
    tacSprintDuration: 3.0,
    tacSprintCooldown: 2.5,

    slideMinSpeed: 5.5,
    slideBoost: 12,
    slideFriction: 1.2,
    slideMaxTime: 1.1,
    /** Slide ends at about sprint pace so you flow straight back into running. */
    slideExitSpeed: 5.0,
    slideCooldown: 0.8,
    slideSteer: 1.2,
    slideQueueTime: 0.35,

    mantleMaxHeight: 2.1,
    mantleAirMaxAbove: 1.7,
    mantleReach: 0.6,
    mantleTimeBase: 0.18,
    mantleTimePerMeter: 0.12,
    mantleExitSpeed: 3.0,

    radius: 0.35,
    standHeight: 1.8,
    crouchHeight: 1.15,
    slideHeight: 1.0,
    stepHeight: 0.45,
    maxSlopeDeg: 46,
    groundSnap: 0.4,
  },
  {
    walkSpeed: [1, 12, 0.1],
    sprintSpeed: [1, 15, 0.1],
    tacSprintSpeed: [1, 18, 0.1],
    groundAccel: [1, 40, 0.5],
    groundFriction: [0, 20, 0.25],
    airAccel: [0, 20, 0.25],
    gravity: [5, 50, 0.5],
    jumpHeight: [0.2, 3, 0.05],
    slideBoost: [3, 20, 0.1],
    slideFriction: [0, 8, 0.05],
    maxSlopeDeg: [20, 70, 1],
  },
);

export type Posture = 'stand' | 'crouch' | 'slide';
/** 0 = not sprinting, 1 = sprint, 2 = tactical sprint. */
export type SprintLevel = 0 | 1 | 2;

export interface MantleState {
  from: Vector3;
  to: Vector3;
  t: number;
  duration: number;
  endPosture: Posture;
}

const UP = new Vector3(0, 1, 0);

function heightOf(p: Posture) {
  return p === 'stand' ? MOVE.standHeight : p === 'crouch' ? MOVE.crouchHeight : MOVE.slideHeight;
}

export class PlayerController {
  readonly position = new Vector3();
  readonly prevPosition = new Vector3();
  readonly velocity = new Vector3();
  readonly groundNormal = new Vector3(0, 1, 0);
  grounded = false;
  posture: Posture = 'stand';
  sprint: SprintLevel = 0;
  mantle: MantleState | null = null;
  /** Set by weapons (firing, ADS) to stop sprinting. */
  sprintBlocked = false;
  /** Set by weapons: ground speed multiplier (ADS walk). */
  speedMul = 1;

  // --- per-step events for camera/audio/weapons (valid until the next step) ---
  landedSpeed = 0;
  jumped = false;
  slideStarted = false;
  mantleStarted = false;
  /** Height change from a step-up/down this step (camera smooths it out). */
  stepDelta = 0;

  private crouchWanted = false;
  /** Posture whose capsule is actually in the world (what collision uses). */
  private fitPosture: Posture = 'stand';
  private preMoveVy = 0;
  private slideTime = 0;
  private slideCooldownT = 0;
  private slideQueuedT = 0;
  private tacTime = 0;
  private tacCooldownT = 0;
  private lastSprintPress = -1;
  private coyoteT = 0;
  private jumpBufferT = 0;
  private time = 0;

  constructor(private collider: Colliders) {}

  setCollider(collider: Colliders) {
    this.collider = collider;
  }

  teleport(feet: Vector3) {
    this.position.copy(feet);
    this.prevPosition.copy(feet);
    this.velocity.set(0, 0, 0);
    this.mantle = null;
    this.posture = this.fitPosture = 'stand';
    this.sprint = 0;
    this.crouchWanted = false;
    const ground = probeGround(this.collider, feet, MOVE.radius, 0.05, this.minGroundNormalY);
    this.grounded = !!ground;
    if (ground) this.position.y -= ground.distance;
  }

  get height() {
    return heightOf(this.fitPosture);
  }

  get capsule(): Capsule {
    return { radius: MOVE.radius, height: this.height };
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Coarse state for debug / weapons / audio. */
  get state(): string {
    if (this.mantle) return 'mantle';
    if (!this.grounded) return 'air';
    if (this.posture === 'slide') return 'slide';
    if (this.posture === 'crouch') return 'crouch';
    return this.sprint === 2 ? 'tacSprint' : this.sprint === 1 ? 'sprint' : 'walk';
  }

  private get minGroundNormalY() {
    return Math.cos((MOVE.maxSlopeDeg * Math.PI) / 180);
  }

  step(dt: number, input: InputState, yaw: number) {
    this.prevPosition.copy(this.position);
    this.time += dt;
    this.landedSpeed = 0;
    this.jumped = this.slideStarted = this.mantleStarted = false;
    this.stepDelta = 0;
    this.slideCooldownT = Math.max(0, this.slideCooldownT - dt);
    this.tacCooldownT = Math.max(0, this.tacCooldownT - dt);
    this.coyoteT = Math.max(0, this.coyoteT - dt);
    this.jumpBufferT = Math.max(0, this.jumpBufferT - dt);
    this.slideQueuedT = Math.max(0, this.slideQueuedT - dt);

    if (this.mantle) {
      this.updateMantle(dt, yaw);
      return;
    }

    const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const fwdInput = (input.down.has('forward') ? 1 : 0) - (input.down.has('back') ? 1 : 0);
    const sideInput = (input.down.has('right') ? 1 : 0) - (input.down.has('left') ? 1 : 0);
    const wish = new Vector3().addScaledVector(forward, fwdInput).addScaledVector(right, sideInput);
    if (wish.lengthSq() > 1) wish.normalize();

    if (input.pressed.has('jump')) this.jumpBufferT = MOVE.jumpBuffer;
    this.handleSprint(input, fwdInput, dt);
    this.handleCrouch(input);
    this.resolvePosture();

    // Jump (or mantle when there's a ledge in front).
    const canJump = this.grounded || this.coyoteT > 0;
    if (this.jumpBufferT > 0 && canJump) {
      this.jumpBufferT = 0;
      if (!this.tryMantle(forward, true)) this.jump();
      if (this.mantle) return;
    } else if (!this.grounded && fwdInput > 0 && this.tryMantle(forward, false)) {
      return;
    }

    if (this.grounded) {
      if (this.posture === 'slide') this.slidePhysics(dt, wish, fwdInput);
      else this.groundPhysics(dt, wish, fwdInput);
      // Move along the ground plane (keeps speed consistent on ramps, no bouncing).
      this.velocity.projectOnPlane(this.groundNormal);
    } else {
      this.velocity.y -= MOVE.gravity * dt;
      this.accelerate(wish, MOVE.walkSpeed * Math.min(1, wish.length()), MOVE.airAccel, dt);
    }

    this.preMoveVy = this.velocity.y;
    this.move(dt);
    this.updateGround();
  }

  // ---------------------------------------------------------------------------
  // Input → state

  private handleSprint(input: InputState, fwdInput: number, dt: number) {
    const pressed = input.pressed.has('sprint');
    const forwardHeld = fwdInput > 0;
    if (pressed) {
      const doubleTap = this.time - this.lastSprintPress < MOVE.doubleTapWindow;
      this.lastSprintPress = this.time;
      if (forwardHeld && this.posture !== 'slide') {
        if (this.sprint === 1 && (SETTINGS.sprintToggle || doubleTap) && this.tacCooldownT <= 0) {
          this.sprint = 2;
          this.tacTime = MOVE.tacSprintDuration;
        } else if (this.sprint === 0) {
          this.sprint = SETTINGS.sprintToggle || !doubleTap || this.tacCooldownT > 0 ? 1 : 2;
          if (this.sprint === 2) this.tacTime = MOVE.tacSprintDuration;
          if (this.posture === 'crouch') {
            this.crouchWanted = false; // sprinting stands you up
            this.posture = 'stand';
          }
        }
      }
    }
    if (!SETTINGS.sprintToggle && !input.down.has('sprint')) this.endSprint();
    if (!forwardHeld || this.sprintBlocked || this.posture === 'crouch') this.endSprint();
    if (this.sprint === 2) {
      this.tacTime -= dt;
      if (this.tacTime <= 0) {
        this.sprint = 1;
        this.tacCooldownT = MOVE.tacSprintCooldown;
      }
    }
  }

  private endSprint() {
    if (this.sprint === 2) this.tacCooldownT = MOVE.tacSprintCooldown;
    this.sprint = 0;
  }

  private handleCrouch(input: InputState) {
    if (input.pressed.has('crouch')) {
      if (this.posture === 'slide') {
        // Slide cancel: stand straight back into a sprint, momentum intact.
        this.posture = 'stand';
        this.crouchWanted = false;
        this.sprint = 1;
      } else if (this.sprint > 0 && this.grounded && this.horizontalSpeed >= MOVE.slideMinSpeed) {
        this.startSlide();
      } else if (this.sprint > 0 && !this.grounded) {
        this.slideQueuedT = MOVE.slideQueueTime; // slide on landing
      } else {
        this.crouchWanted = SETTINGS.crouchToggle ? !this.crouchWanted : true;
      }
    }
    if (!SETTINGS.crouchToggle && input.released.has('crouch') && this.posture !== 'slide')
      this.crouchWanted = false;
    if (this.posture !== 'slide') this.posture = this.crouchWanted ? 'crouch' : 'stand';
  }

  /**
   * Make the capsule fit. Shrinking always works; growing (stand up, slide → crouch) needs
   * headroom. Standing falls back to crouching, otherwise we keep the current fitted posture.
   */
  private resolvePosture() {
    const prev = this.fitPosture;
    const candidates: Posture[] = this.posture === 'stand' ? ['stand', 'crouch'] : [this.posture];
    for (const c of candidates) {
      const h = heightOf(c);
      if (
        h <= heightOf(prev) ||
        !overlaps(this.collider, this.position, { radius: MOVE.radius, height: h })
      ) {
        this.posture = this.fitPosture = c;
        return;
      }
    }
    this.posture = prev;
  }

  private startSlide() {
    const speed = this.horizontalSpeed;
    const dir = new Vector3(this.velocity.x, 0, this.velocity.z).normalize();
    const boosted = this.slideCooldownT <= 0 ? Math.max(speed, MOVE.slideBoost) : speed;
    this.velocity.x = dir.x * boosted;
    this.velocity.z = dir.z * boosted;
    this.posture = 'slide';
    this.fitPosture = 'slide';
    this.slideTime = 0;
    this.slideCooldownT = MOVE.slideCooldown;
    this.sprint = 0;
    this.slideStarted = true;
  }

  private jump() {
    if (this.posture === 'slide' || this.posture === 'crouch') {
      // Slide-jump / crouch-jump: stand up if there's room, keep horizontal momentum.
      if (
        !overlaps(this.collider, this.position, { radius: MOVE.radius, height: MOVE.standHeight })
      ) {
        if (this.posture === 'slide') this.sprint = 1;
        this.posture = 'stand';
        this.crouchWanted = false;
        this.fitPosture = 'stand';
      }
    }
    this.velocity.y = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
    this.grounded = false;
    this.coyoteT = 0;
    this.jumped = true;
  }

  // ---------------------------------------------------------------------------
  // Physics

  private targetSpeed(fwdInput: number) {
    if (this.posture === 'crouch') return MOVE.crouchSpeed * this.speedMul;
    if (this.sprint === 2) return MOVE.tacSprintSpeed;
    if (this.sprint === 1) return MOVE.sprintSpeed;
    return (fwdInput < 0 ? MOVE.walkSpeed * MOVE.backwardMul : MOVE.walkSpeed) * this.speedMul;
  }

  private groundPhysics(dt: number, wish: Vector3, fwdInput: number) {
    this.velocity.y = 0;
    this.friction(MOVE.groundFriction, dt);
    const len = wish.length();
    if (len > 0)
      this.accelerate(
        wish.clone().divideScalar(len),
        this.targetSpeed(fwdInput) * len,
        MOVE.groundAccel,
        dt,
      );
  }

  private slidePhysics(dt: number, wish: Vector3, fwdInput: number) {
    this.slideTime += dt;
    this.friction(MOVE.slideFriction, dt);
    // Gravity along the slope: downhill accelerates, uphill slows.
    const along = new Vector3(0, -MOVE.gravity, 0).projectOnPlane(this.groundNormal);
    this.velocity.addScaledVector(along, dt);
    // Gentle steering toward the input direction.
    const speed = this.horizontalSpeed;
    if (wish.lengthSq() > 0 && speed > 0.1) {
      const cur = Math.atan2(this.velocity.x, this.velocity.z);
      const want = Math.atan2(wish.x, wish.z);
      let delta = want - cur;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const turn = Math.max(-MOVE.slideSteer * dt, Math.min(MOVE.slideSteer * dt, delta));
      const a = cur + turn;
      this.velocity.x = Math.sin(a) * speed;
      this.velocity.z = Math.cos(a) * speed;
    }
    const downhill = along.dot(this.velocity) > 0.5 * speed;
    if (speed < MOVE.slideExitSpeed || (this.slideTime > MOVE.slideMaxTime && !downhill)) {
      // Holding forward: pop up straight into a sprint (keeps momentum). Otherwise end crouched.
      // resolvePosture() falls back to crouch if there's no headroom.
      const run = fwdInput > 0;
      this.posture = run ? 'stand' : 'crouch';
      this.crouchWanted = !run;
      if (run) this.sprint = 1;
    }
  }

  /** Quake friction: constant deceleration with a floor (stopSpeed) so you actually stop. */
  private friction(amount: number, dt: number) {
    const speed = this.horizontalSpeed;
    if (speed < 1e-4) {
      this.velocity.x = this.velocity.z = 0;
      return;
    }
    const drop = Math.max(speed, MOVE.stopSpeed) * amount * dt;
    const k = Math.max(speed - drop, 0) / speed;
    this.velocity.x *= k;
    this.velocity.z *= k;
  }

  /** Quake accelerate: only adds speed along `dir` up to `wishSpeed`; never brakes momentum. */
  private accelerate(dir: Vector3, wishSpeed: number, accel: number, dt: number) {
    if (wishSpeed <= 0 || dir.lengthSq() === 0) return;
    const d = dir.clone().normalize();
    const current = this.velocity.x * d.x + this.velocity.z * d.z;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const a = Math.min(accel * wishSpeed * dt, add);
    this.velocity.x += d.x * a;
    this.velocity.z += d.z * a;
  }

  // ---------------------------------------------------------------------------
  // Collision

  /** Move by velocity*dt, pushing out of geometry and clipping velocity. Returns contacts. */
  private slideMove(dt: number): Contact[] {
    const disp = this.velocity.length() * dt;
    const n = Math.max(1, Math.ceil(disp / (MOVE.radius * 0.4)));
    const cap = this.capsule;
    const contacts: Contact[] = [];
    for (let i = 0; i < n; i++) {
      this.position.addScaledVector(this.velocity, dt / n);
      const before = contacts.length;
      depenetrate(this.collider, this.position, cap, contacts);
      for (let c = before; c < contacts.length; c++) {
        const nrm = contacts[c].normal;
        // Ground contacts while grounded are handled by ground snapping; don't let them kill speed.
        if (this.grounded && nrm.y >= this.minGroundNormalY) continue;
        const into = this.velocity.dot(nrm);
        if (into < 0) this.velocity.addScaledVector(nrm, -into);
      }
    }
    return contacts;
  }

  private move(dt: number) {
    const start = this.position.clone();
    const startVel = this.velocity.clone();
    const contacts = this.slideMove(dt);

    const minY = this.minGroundNormalY;
    const blocked = contacts.some((c) => c.normal.y < minY && c.normal.y > -0.3);
    if (!this.grounded || !blocked || startVel.y > 0.5) return;

    // Step-up attempt: lift, move, drop. Keep it if it got us further horizontally.
    const aPos = this.position.clone();
    const aVel = this.velocity.clone();
    const lifted = start.clone();
    lifted.y += MOVE.stepHeight;
    if (overlaps(this.collider, lifted, this.capsule)) return;
    this.position.copy(lifted);
    this.velocity.copy(startVel).setY(0);
    this.slideMove(dt);
    const ground = probeGround(
      this.collider,
      this.position,
      MOVE.radius,
      MOVE.stepHeight + 0.05,
      minY,
    );
    const progressA = Math.hypot(aPos.x - start.x, aPos.z - start.z);
    const progressB = Math.hypot(this.position.x - start.x, this.position.z - start.z);
    if (ground && progressB > progressA + 1e-4) {
      this.position.y -= ground.distance;
      this.stepDelta = this.position.y - aPos.y;
      // Stair edges clip velocity; if we mostly got where we wanted, keep the momentum.
      const intended = Math.hypot(startVel.x, startVel.z) * dt;
      if (progressB > 0.5 * intended) this.velocity.copy(startVel);
      this.velocity.y = 0;
    } else {
      this.position.copy(aPos);
      this.velocity.copy(aVel);
    }
  }

  private updateGround() {
    const wasGrounded = this.grounded;
    const minY = this.minGroundNormalY;
    if (this.jumped || (!wasGrounded && this.velocity.y > 0)) {
      this.grounded = false;
      return;
    }
    const snap = wasGrounded ? MOVE.groundSnap : 0.02;
    const ground = probeGround(this.collider, this.position, MOVE.radius, snap, minY);
    if (ground) {
      this.position.y -= ground.distance;
      if (wasGrounded) this.stepDelta += -ground.distance;
      this.groundNormal.copy(ground.normal);
      if (!wasGrounded) {
        this.landedSpeed = Math.max(0, -Math.min(this.velocity.y, this.preMoveVy));
        this.velocity.y = 0;
        if (this.slideQueuedT > 0 && this.horizontalSpeed >= MOVE.slideMinSpeed) {
          this.slideQueuedT = 0;
          this.startSlide();
        }
      }
      this.grounded = true;
    } else {
      if (wasGrounded) this.coyoteT = MOVE.coyoteTime;
      this.grounded = false;
      this.groundNormal.copy(UP);
    }
  }

  // ---------------------------------------------------------------------------
  // Mantle

  /**
   * Look for a ledge in front: a wall within reach, a walkable top no higher than the mantle
   * limit, and room to stand (or crouch) on it. Starts the mantle and returns true if found.
   */
  private tryMantle(facing: Vector3, fromGround: boolean): boolean {
    const r = MOVE.radius;
    const feet = this.position;
    const reach = r + MOVE.mantleReach;
    const maxH = fromGround ? MOVE.mantleMaxHeight : MOVE.mantleAirMaxAbove;

    // 1. A wall in front, somewhere between step height and the max ledge height.
    let wallDist = Infinity;
    for (let h = MOVE.stepHeight + 0.05; h <= maxH; h += 0.2) {
      const hit = raycast(this.collider, new Vector3(feet.x, feet.y + h, feet.z), facing, reach);
      if (hit && Math.abs(hit.normal.y) < 0.3) wallDist = Math.min(wallDist, hit.distance);
    }
    if (!Number.isFinite(wallDist)) return false;

    // 2. Nothing blocking at max height (otherwise it's a wall taller than our reach).
    const topOrigin = new Vector3(feet.x, feet.y + maxH + 0.1, feet.z);
    if (raycast(this.collider, topOrigin, facing, wallDist + r + 0.3)) return false;

    // 3. Find the ledge top by casting down just beyond the wall face.
    const probe = topOrigin.clone().addScaledVector(facing, wallDist + 0.3);
    const down = raycast(this.collider, probe, new Vector3(0, -1, 0), maxH + 0.1 - MOVE.stepHeight);
    if (!down || down.normal.y < this.minGroundNormalY) return false;
    const ledgeY = down.point.y;
    const h = ledgeY - feet.y;
    // On the ground, low lips are just steps. In the air, catch any ledge above the feet.
    if (h <= (fromGround ? MOVE.stepHeight : 0.1)) return false;

    // 4. Room on top: stand if possible, else crouch.
    const to = new Vector3(feet.x, ledgeY + 0.01, feet.z).addScaledVector(
      facing,
      wallDist + r + 0.05,
    );
    let endPosture: Posture = 'stand';
    if (overlaps(this.collider, to, { radius: r, height: MOVE.standHeight })) {
      if (overlaps(this.collider, to, { radius: r, height: MOVE.crouchHeight })) return false;
      endPosture = 'crouch';
    }
    // And room to rise in place before moving forward.
    const risen = new Vector3(feet.x, ledgeY + 0.01, feet.z);
    if (overlaps(this.collider, risen, { radius: r, height: MOVE.crouchHeight })) return false;

    this.mantle = {
      from: feet.clone(),
      to,
      t: 0,
      duration: MOVE.mantleTimeBase + MOVE.mantleTimePerMeter * h,
      endPosture,
    };
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.mantleStarted = true;
    this.slideQueuedT = 0;
    return true;
  }

  private updateMantle(dt: number, yaw: number) {
    const m = this.mantle!;
    m.t = Math.min(1, m.t + dt / m.duration);
    const rise = 1 - Math.pow(1 - Math.min(1, m.t / 0.65), 3); // ease-out
    const f = Math.max(0, (m.t - 0.35) / 0.65);
    const fwd = f * f * (3 - 2 * f); // smoothstep
    this.position.set(
      m.from.x + (m.to.x - m.from.x) * fwd,
      m.from.y + (m.to.y - m.from.y) * rise,
      m.from.z + (m.to.z - m.from.z) * fwd,
    );
    if (m.t >= 1) {
      this.mantle = null;
      this.posture = m.endPosture;
      this.fitPosture = m.endPosture;
      this.crouchWanted = m.endPosture === 'crouch';
      const facing = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      this.velocity.copy(facing).multiplyScalar(MOVE.mantleExitSpeed);
      this.updateGround();
      this.grounded = true;
    }
  }
}
