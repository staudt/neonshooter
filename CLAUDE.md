# NEON — browser stage-clear FPS

Halo-style "walk in, clear it, retry from checkpoint" shooter with MW-style movement and gunfeel,
in three.js + TypeScript. Setting: a dystopian transit megacity overrun by demons and corrupted
humans (Doom-like), levels in the Quake/old-Doom spirit — tactical yet fast area clearing, non-boxy, not open-world. **Playability first**; minimal manual modeling; stylized look from cheap
effects. Full design: [docs/PLAN.md](docs/PLAN.md) — read the relevant section before starting a milestone.

## Decisions (keep current; append to the log below when one changes)

- Look: **Ember Noir** — desaturated concrete/rust brutalism; *two-light rule*: cold human light (fluorescent,
  sodium, teal ads) vs **hell red** (emissive veins, embers, sky). Enemies are the reddest things on screen.
  Depth from a procedural skyline backdrop + fog; canvas signage/ads/graffiti as worldbuilding. AO + bloom.
- Enemies: **demons + corrupted humans**. One shared *corruption shader* (near-black skin, rim light, glowing
  cracks, chest sigil = weak point) unifies all sources: CC0 rigged packs (Quaternius) + code-built horror bits,
  procedural fliers. No manual modeling. Robots are retired.
- Enemy fire: **visible, dodgeable projectiles** (fireballs). Gore: **graphic** (blood decals, gibs) with a fixed budget.
- Maps: **TrenchBroom** `.map` files → custom parser → meshes + BVH; Vite HMR reloads the level.
- Movement v1: walk/crouch/jump, sprint + tac-sprint, slide + slide-cancel, mantle. (No prone/lean/dive.)
- Weapons v1: AR (full-auto) + pistol (semi), data-driven. Floating viewmodel, no arms.
- Health: regen + checkpoints; death → respawn at last checkpoint in <1 s.
- Stack: Vite, TS (strict), three, three-mesh-bvh, postprocessing + n8ao, lil-gui, vitest, Playwright.

### Decision log

- 2026-10-13: Initial plan approved (all of the above).
- 2026-10-13: Slide-cancel = crouch again during slide (MW3 style); jump during slide = slide-jump (keeps
  momentum). Sprint/crouch default to toggle (setting). Test course tunnel is 1.2 m (crouch 1.15 fits, stand doesn't).
- 2026-10-13: Weapons: partial recoil recovery (MW-like) with learnable horizontal pattern; FOV-relative ADS
  sensitivity; reload continues while sprinting (MW3-style); auto-reload when the mag runs dry; procedural
  placeholder guns + synthesized audio.
- 2026-10-13 (playtest 1): slide slightly longer than the original (friction 1.35, 1.1 s → ~5.5 m; ~8 m was too
  far); ADS-in slower when moving / straight out of sprint / out of tac sprint (per-weapon `adsTime*Mul`);
  ADS sensitivity multiplier setting (default 0.85); more recoil — playtest: recoil feels very good, keep.
- 2026-10-13 (playtest 2): fixed tracers never retiring; MW-style pulsing "[R] RELOAD" prompt at per-gun
  `lowAmmoFraction` (AR 0.2, pistol 0.25 — CoD's exact threshold unconfirmed); stronger reload animation
  (`VM.reloadIntensity`).
- 2026-10-13: Enemies are hover robots (no leg animation); grunts use Recast navmesh + crowd; bolts at 26–30 m/s
  are dodgeable by strafing at 15 m; doors are real movers with dynamic collision; on death only the in-progress
  encounter resets (Halo-style).
- 2026-10-13 (playtest 3): drones 2× size (`DRONE.scale`, hit volumes scale with the model), drone bolts 18 m/s;
  slide snappier: boost 12, ends at 5 m/s (≈0.7 s, ≈5.7 m) and pops straight back into a sprint while forward is
  held (crouch only if released or no headroom) — the old crawl-out felt like it killed momentum.
- 2026-10-13: **Art pivot** (concept: ruined metro platform, demon hounds, red hell-spire over a cyber skyline):
  look → Ember Noir; enemies → demons (flying demon replaces drone, fireball caster replaces grunt, plus
  Possessed melee rusher + Hound); CC0 rigged packs + corruption shader (not AI-3D, not pure procedural);
  graphic gore; look slice (`maps/station_slice.map`) first. Plan: docs/PLAN.md "Look" / "Enemies".
- 2026-10-13: ADS sensitivity default = flat 0.9 (≈10% slower), FOV-relative scaling **off** by default (it stacked
  to a ~37% cut on the AR). Tone mapping ACES (AgX bleached hell reds pink).

## Conventions

- Y-up, meters. TrenchBroom/Quake is Z-up: convert in the parser; **32 map units = 1 m**.
- Simulation: fixed **120 Hz** step (`src/core/loop.ts`) with render interpolation; slow-mo via `loop.timeScale`.
  Sim code must not touch the DOM or renderer, so it can run headless in vitest.
- Mouse look is applied per render frame; everything else reads `InputState` per sim step.
- Input goes through `InputSource` (`BrowserInput` / `ScriptedInput` in `src/core/input.ts`) — tests and smoke use scripts.
- **Player settings** (sensitivity, ADS sensitivity multiplier + relative mode, FOV, invert Y, sprint/crouch toggle,
  volume) live in `src/settings.ts` (`SETTINGS`) — the future options menu edits that object. Keep preference there,
  design feel in tunables.
- **Feel values are never hard-coded**: use `defineTunables(group, defaults, ranges)` (`src/dev/tuning.ts`) or the
  weapon defs. Read the returned object every step. Dev panel: backquote key. Overrides persist in localStorage;
  "copy overrides JSON" exports them so good values can be baked back into defaults.
- Springs for anything procedural (recoil, sway, camera): `Spring` / `Spring3` in `src/core/springs.ts`.
- Debug text overlay: `debug(key, value)` from `src/dev/stats.ts`.

## Commands

- `npm run dev` — play at http://localhost:5173 (click to lock pointer)
- `npm run verify` — typecheck + vitest + headless smoke (what the Stop hook runs)
- `npm run smoke` — Playwright boots `?test=smoke` on each map in `scripts/smoke.mjs` RUNS (test course movement +
  arena combat), runs the scripts in `src/test/smokeScript.ts`; fails on errors or any false
  `checks` in main's smoke report. Screenshots: `test-results/smoke-fp.png` (ADS + firing), `smoke-reload.png` (mid reload) and
  `test-results/smoke.png` (fixed overview). Look at them after visual changes.
- `npm run shots` — full-res look stills (`?shot=x,y,z,yaw,pitch`, free camera, no HUD; `&enc=x,y,z` parks the
  player in a trigger so enemies spawn, `&track=m` follows the nearest enemy) → `test-results/look-*.png`.
  `SHOT=<name>`, `SHOT_MAP=<map>`, `TUNE='{"look: post":{...}}'` + `SUFFIX=-x` for A/B. Use it for look work
  (smoke renders at half res on SwiftShader and is for correctness). ~45–60 s per still.
- `npm run build` (`BASE_PATH=/neonshooter/` for the Pages layout)
- Deploy: every push to `main` runs `.github/workflows/pages.yml` (typecheck + tests + build) and publishes to
  https://staudt.github.io/neonshooter/ — default map there is `arena_test`; start screen links switch maps.
- `npm run textures` — regenerate TrenchBroom PNGs from `src/world/palette.ts`; `npm run gen:course` / `gen:arena` /
  `gen:station` — regenerate the generated maps
- `npm run tb:install` — link the TrenchBroom game config. Level authoring guide: [docs/LEVELS.md](docs/LEVELS.md)

## Workflow: agents & hooks

**Delegate cheap work to save tokens** (`.claude/agents/`):

- `scout` (haiku): read-only lookups, library API checks, "where is X".
- `verifier` (haiku): run checks and report failures only.
- `implementer` (sonnet): self-contained tasks with a written spec (parsers, configs, HUD, pools, loaders, tests).
- `asset-wrangler` (haiku): organizing/converting/inspecting assets, CREDITS.md.
- **Main session keeps feel-critical work**: movement, recoil/viewmodel, AI behaviour, shaders/post, integration,
  and reviews whatever agents return. Don't spawn agents for things answerable in one or two tool calls.

**Hooks** (`.claude/settings.json`):

- PostToolUse Edit|Write → prettier on the file; touches `.claude/.dirty` for game files.
- Stop / SubagentStop (implementer only) → if dirty, `npm run verify`; failure exits 2 and feeds errors back
  (max 3 attempts, then the stop is allowed with a message). Don't fight it — fix the errors.

## Milestones (update as they complete)

- [x] 1. Scaffold + workflow (loop, input, tuning panel, stats, CLAUDE.md, agents, hooks, vitest, smoke)
- [x] 2. Map pipeline (TrenchBroom config/fgd/textures, .map parser, BVH, entities, HMR, test course)
- [x] 3. Movement (capsule collision, state machine, camera feel) + headless sim tests — needs a hands-on tuning pass
- [x] 4. Weapons (AR + pistol, hitscan, recoil, ADS, reload, FX, placeholder audio) — needs a hands-on feel pass
- [x] 5. Enemies & loop (navmesh, Grunt + Drone, projectiles, health regen, checkpoints, encounters) — needs a combat feel pass
- [ ] 6. Look pass / art pivot (post stack, materials, backdrop, signs, corruption shader, flying demon, fireballs)
- [ ] 6b. Demons (rigged-enemy pipeline, caster, Possessed rusher, Hound, graphic gore)
- [ ] 7. First stage (5–8 min, 3–4 encounters, stage-clear screen)

## Map pipeline (src/world/)

`mapParser.ts` (text → entities/brushes, Quake space) → `brushGeometry.ts` (planes → convex polygons,
Z-up→Y-up via `toWorld`, `angleToYaw`) → `level.ts` (`buildLevelData` = pure/headless: render geometry per
material, collision geometry with `boundsTree` BVH, entities, movers; `createLevel` = scene objects).
Materials are named by `palette.ts`; `clip`/`trigger`/`skip` are tool materials (not rendered).
Maps are served by the `neon-maps` Vite plugin (vite.config.ts), which also emits `neon:map-changed` for hot reload.

## Player (src/player/)

- `collision.ts`: capsule (feet-anchored) vs static BVH — `depenetrate` (push-out + contact normals), `overlaps`,
  `probeGround` (walkable-only; ledge edges count as flat ground), `raycast`.
- `controller.ts`: `PlayerController` + `MOVE` tunables. Quake-style friction/accelerate; postures stand/crouch/slide
  (`fitPosture` = capsule actually in the world; growing needs headroom); sprint levels 0/1/2 (toggle by default:
  Shift = sprint, Shift again = tac sprint); slide = crouch while sprinting (boost, slope gravity, steer); slide-jump
  keeps momentum; crouch during slide = slide-cancel into sprint; mantle = jump near a ledge or hold forward into one
  mid-air (scripted rise-then-forward, clearance checked up front); step-up + ground snap; coyote time + jump buffer.
  Per-step events (`landedSpeed`, `jumped`, `slideStarted`, `mantleStarted`, `stepDelta`) feed camera/audio/weapons.
  `sprintBlocked` is the hook for weapons (firing/ADS stops sprint).
- `camera.ts`: `CameraRig` + `CAM` tunables — eye height per posture, FOV kicks, slide/strafe roll, landing dip spring,
  bob, mantle pitch; stepped in sim, interpolated in render.
- `tests/movement.test.ts` runs the controller headless on `maps/test_course.map` with `ScriptedInput` — add a test
  for every movement bug fixed or mechanic added.
- Dev: V toggles noclip (`debugFly.ts`).

## Weapons (src/weapons/, src/fx/, src/audio/, src/ui/hud.ts)

- `defs.ts`: `AR`, `PISTOL` — all stats are tunables (panel folders "weapon: AR" / "weapon: pistol").
- `weapon.ts`: `WeaponSystem` — pure logic (headless-testable): fire timing (rpm, auto/semi + click buffer),
  ammo/reload (ammo added at `reloadAddAt`), ADS 0..1, swap phases, sprint-out delay, spread (hip/ADS/move/air/bloom),
  aim recoil = `punchPitch/Yaw` springs on top of the view; after a spray the punch eases to the non-recovered
  remainder and is _folded_ into the base view (`foldPitch/Yaw` → main adds to pitch/yaw). Horizontal recoil follows
  a fixed per-weapon pattern (`patternH`) so sprays are learnable. Events per step for audio/viewmodel.
- `viewmodel.ts`: separate scene + camera rendered after the world (depth cleared); pose blend hip→ADS (sight line
  aligned to screen center via `sightHeight`/`adsDistance`), sprint/tac/reload/swap poses, sway, bob, kick springs,
  muzzle flash; `cameraShake` = visual-only shake. `models.ts` = procedural placeholder guns (anchors: muzzle, mag).
- `combat.ts`: glue — preStep (sprint block, ADS move speed) → step (fire → `traceBullet` → damage/hitmarker/FX/sfx;
  movement sounds) → render (viewmodel, tracers, impacts, HUD, ADS FOV + FOV-relative sensitivity).
- `hitscan.ts`: `Hittable` interface (enemies implement it), `traceBullet` (world BVH + targets; world surface via
  `LevelData.surfaceAt`). `src/world/dummy.ts`: `target_dummy` entity.
- FX: `fx/tracers.ts` (pooled streaks), `fx/impacts.ts` (instanced sparks/dust/decals+embers, fixed budget).
  Never add/remove lights at runtime (shader recompiles) — pulse intensity of fixed lights instead.
- Audio: `audio/synth.ts` = pure procedural sound recipes (`SYNTHS`), `audio/audio.ts` = `sfx.play(name)`;
  `sfx.registerFiles(name, urls)` swaps in real samples later. Unlocked + prewarmed on the click-to-play.

## Enemies & stage flow (src/ai/, src/game/, src/world/doors.ts, src/player/health.ts)
- `game/session.ts`: `GameWorld` = everything per loaded level (level, doors, enemies + navmesh, stage, dummies);
  rebuilt on load/hot reload. `world.colliders` = [static, dynamic doors] — pass it (not the static collider) to
  anything that collides; the array is mutated in place as doors move.
- `game/stage.ts`: `Stage` — encounters from `trigger_encounter` (enter → wave 0 alerted; wave cleared → next after
  1.4 s; last cleared → doors in `target` open + slow-mo + toast), `trigger_checkpoint`→`info_checkpoint`, free doors
  (not gated by an encounter) open on approach, `trigger_stage_end` only when all cleared. `resetToCheckpoint()` on
  death: in-progress encounters despawn + go idle; cleared ones (and their doors) stay.
- `ai/navigation.ts`: Recast navmesh baked from collision at load (WASM; `initNavigation()` first), DetourCrowd for
  grunts. Works headless in vitest.
- `ai/enemy.ts`: `Enemy` base (Hittable: body capsule + core weak point → part 'head'), flash, flinch/stagger
  (damage burst interrupts attacks), throttled LOS. `ai/grunt.ts` (navmesh repositioning by LOS/range score, turret
  aim with partial lead, charge telegraph → 3-bolt burst), `ai/drone.ts` (orbit steering + raycast avoidance, single
  telegraphed bolts). `ai/enemies.ts`: spawn/despawn, squad alert on hit, gunfire hearing, death debris.
  Tunables: "enemy: grunt", "enemy: drone".
- `ai/projectiles.ts`: pooled bolts swept per step vs world (raycast) and player capsule (segment–segment distance).
- `player/health.ts`: regen after `regenDelay`; death cam → respawn at checkpoint after `deathTime`; spawn protection.
- `ai/models.ts`: procedural robot models (per-instance materials for hit flash; shared geometry).
- Maps: `maps/arena_test.map` (`npm run gen:arena`, `scripts/gen-arena.ts` via `scripts/mapgen.ts` MapBuilder) is
  the combat test stage. Play it with `?map=arena_test`.

## Look (src/render/, src/world/materials.ts, backdrop.ts, signs.ts, src/fx/corruption.ts, embers.ts)

- `render/pipeline.ts`: `RenderPipeline` (postprocessing composer): backdrop pass (own scene + camera, near 5 m /
  far 9 km) → world pass (depth-only clear, `ignoreBackground`) → N8AO → viewmodel pass (depth cleared) → bloom +
  hue/sat + contrast + vignette + tone map (**ACES** default; `POST.toneMapper`, AgX bleaches reds pink) → CA (damage)
  + grain → SMAA. Tunables "look: post". Renderer tone mapping is off (the effect does it).
- Lighting (main.ts, "look: lighting"): cold hemisphere fill + a red **key** DirectionalLight from `spire_angle` with
  a **static shadow map** (`shadowMap.autoUpdate = false`, `needsUpdate` on level load) so red only enters through
  openings; FogExp2; env map = PMREM of the backdrop scene (wet floors reflect the burning sky).
- `world/materials.ts`: palette `style` → `onBeforeCompile` world-space procedural layer (formwork concrete, puddles,
  tiles, panels/rust, grate, hazard dots, hell cracks) + bump; shared uniforms via `updateSurfaceUniforms(time)`;
  `NOISE_GLSL` is shared by every procedural shader. Tunables "look: surfaces".
- `world/backdrop.ts`: sky dome (gradient, clouds, burning ring around the spire), ~900 instanced towers (window
  grid shader, neon edges, haze), rails, spire cones, lower-city ground, billboards (`adTexture`), traffic +
  blink lights (GPU-animated points). Deterministic PRNG. `backdropOptionsFor(worldProps, bounds)`.
- `world/signs.ts`: `info_sign` → CanvasTexture planes (skipped headless). `fx/embers.ts`: camera-wrapped GPU embers.
- `fx/corruption.ts`: `corruptionMaterial()` — the demon skin (object-space veins, rim, pulse, charred skin);
  per instance (hit flash writes `emissive`); `updateCorruptionUniforms(time)` per frame. Tunables "look: corruption".
- Enemy art: `ai/models.ts` `buildDrone()` = flying demon "Maw" (skull, jaw = telegraph, cyclops eye = weak point,
  ribs, tentacles via `animateFlyer`); `buildBolt()` = HDR additive fireball (flickered in `projectiles.ts`). The
  grunt is still the robot placeholder until the rigged-enemy pipeline (milestone 6b).

## Controls

WASD move · Mouse look · Space jump/mantle · Shift sprint (again = tac sprint) · C / Ctrl crouch (while sprinting = slide;
during slide = cancel) · LMB fire · RMB ADS · R reload · Q swap · 1/2 weapons · F interact · ` tuning panel · V noclip (dev)

## Status notes

- Subagents defined in `.claude/agents/` load at session start; in the session that created them, use
  `general-purpose` with a `model` override instead.
- Assets the user still needs to download (not scriptable): TrenchBroom, Quaternius Ultimate Guns / Kenney Blaster Kit,
  Kenney Sci-Fi + Impact sounds. Everything runs on procedural placeholders until then.
