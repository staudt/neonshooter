# NEON — browser stage-clear FPS (three.js)

## Context

Empty repo at `/home/ricardo/git/shooter` (Node 26, Arch/Omarchy, no Blender). Goal: a fast,
Halo-style "walk in and clear it" FPS with MW-style movement and gunfeel. Playability first,
near-zero manual modeling, a stylized look that reads expensive from cheap effects.

**Decisions made**

- Look: **neon brutalism** — white/grey concrete geometry, heavy AO, emissive strips, bloom, fog.
- Enemies: **procedural robots/drones** (built from primitives in code, procedural motion).
- Maps: **TrenchBroom** (.map brush editor) + custom loader, hot-reloaded in the browser.
- Movement must-haves: walk/crouch/jump, **sprint + tac-sprint, slide + slide-cancel, mantle**.
- Enemy fire: **visible, dodgeable projectiles** (glowing bolts).
- Weapons v1: **AR (full-auto) + pistol (semi)**, data-driven so more are cheap later.
- Health: **regen + checkpoints**, death → instant (<1 s) respawn at last checkpoint.

## Feasibility verdict

- **Gunfeel: high.** Recoil, ADS, sway, bob, sprint pose and reload are all procedural
  (springs + curves), so no animation authoring. Audio is ~50% of feel; free/CC0 libraries suffice.
- **Weapon models: good.** CC0 low-poly guns (Quaternius _Ultimate Guns_, Kenney _Blaster Kit_)
  fit the stylized look. Floating gun, no arms. Placeholder guns built from boxes until assets land.
- **Enemies: high.** Procedural robots need zero rigging; weak-point "core" = headshot.
- **Maps: high.** TrenchBroom is the fastest way to block out vertical arenas; the .map
  format is plain text (~300 LOC to parse brushes → meshes).
- **Risk areas:** movement collision robustness (slopes/steps/ledges) and AI that is fun
  rather than dumb — both get dedicated milestones + a live tuning panel.

## Tech stack

- Vite + TypeScript + three.js (WebGL2).
- `three-mesh-bvh`: capsule-vs-world collision, hitscan, LOS and projectile sweeps.
- Custom Quake/Source-style movement (accel/friction/air-control) — full control of feel.
- `recast-navigation` (WASM): navmesh generated at load from level geometry.
- `postprocessing` (pmndrs) + `n8ao`: AO, bloom, SMAA, vignette, chromatic aberration.
- `lil-gui` dev tuning panel; `vitest` for parser/math tests.
- Fixed-timestep sim (120 Hz) with render interpolation; raw-input pointer lock.

## Project layout

```
src/
  main.ts                 boot, loop (fixed-step sim + interpolated render)
  core/                   input.ts, time.ts (timeScale for slow-mo), pool.ts, springs.ts
  world/                  mapParser.ts (.map → brushes/entities), brushGeometry.ts
                          (plane intersection → polygons, Z-up→Y-up, 32 units = 1 m),
                          level.ts (meshes, merged BVH collider, entity dispatch), materials.ts
  player/                 controller.ts (movement state machine), collision.ts (capsule
                          vs BVH, step-up, ground snap), camera.ts (FOV kick, tilt, dip), health.ts
  weapons/                defs.ts (data), weapon.ts (fire/ADS/reload state), recoil.ts,
                          viewmodel.ts (separate scene+camera, own FOV), hitscan.ts
  ai/                     navmesh.ts, enemy.ts (base + perception), archetypes/{grunt,drone}.ts,
                          projectiles.ts (pooled instanced bolts, swept spheres), director.ts
  fx/                     post.ts, particles.ts, decals.ts (instanced ring buffer),
                          tracers.ts, dissolve.ts (death shader), muzzle.ts
  audio/                  audio.ts (WebAudio, pitch randomization, layering, pooling)
  ui/                     hud.ts (crosshair spread, hitmarkers, damage dir, ammo), screens.ts
  dev/                    tuning.ts (lil-gui bound to all feel params, localStorage + JSON export)
trenchbroom/              GameConfig.cfg, neon.fgd, textures/*.png (material names)
maps/*.map                levels (served by Vite; HMR reloads level, keeps player pose)
public/assets/            CC0 glb + audio
```

## Key designs

**Movement state machine** — `walk | sprint | tacSprint | crouch | slide | air | mantle`.

- Sprint: hold/toggle Shift; tac-sprint: double-tap, limited duration + cooldown; weapon
  lowered, sprint-to-fire delay per weapon.
- Slide: crouch while sprinting → speed impulse, low friction decaying over ~0.8 s, camera
  lowered + rolled; jump during slide = slide-cancel (keeps momentum); slope-aware.
- Mantle: when airborne/jumping into a wall, shapecast forward at chest height, find ledge top
  within reach + capsule clearance → scripted 0.3 s curve onto ledge.
- Quality-of-life: coyote time, jump buffer, step-up, ground snapping, landing dip.

**Gunfeel** (all values in `weapons/defs.ts`, live-editable):

- rpm, damage + falloff, weak-point multiplier, mag/reload, hip/ADS spread, ADS time + FOV.
- Recoil = per-shot pattern (vertical climb + horizontal random) applied to a camera spring
  (persistent climb, partial recovery) + viewmodel spring (kick back/up/roll, fast recovery).
- Viewmodel: sway from mouse delta, bob from speed, inertia on land/jump, sprint pose, ADS
  pose lerp, procedural reload (tilt, mag drop/insert), muzzle flash + point light pulse.
- Feedback: tracers, sparks + decals by surface, hitmarker (white; red for kill), hit/kill
  sounds, light screen shake, crosshair bloom.
- Viewmodel rendered in a second pass after N8AO so it isn't occluded or AO'd by the world.

**Enemies (art pivot 2026-10-13: demons replace robots)**

All enemies share one *corruption shader* (`src/fx/corruption.ts`): near-black skin, fresnel rim, glowing red
cracks from 3D noise (no UVs), glowing eyes, and a chest **sigil = weak point** (hit part `'head'`, like the old
core). It hides low-poly/mismatched sources and makes them read as one set in fog.

- **Flying demon** (replaces the drone; keeps its orbit/avoid/telegraph AI): procedural skull mass + jaw +
  code-animated tentacles (sine chains). Floats, so no rig.
- **Caster** (replaces the grunt; keeps navmesh repositioning + charge telegraph): CC0 rigged humanoid, hand
  ignites → fireball volley.
- **Possessed** (corrupted human): melee rusher — charge, lunge, telegraphed swipe you can slide out of.
  CC0 humanoid + code-built spikes/horns, additive bone offsets (hunch, broken neck), noise head-twitch.
- **Hound**: CC0 quadruped, procedural leap pounce (ballistic root motion + one pose).
- Later: big demons from Quaternius monster packs; fallback AI image-to-3D + auto-rig (shader hides roughness).
- Perception: view cone + LOS raycast, alerts propagate to nearby squad, hears gunfire.
- Death: graphic — blood mist, raycast splatter decals, flesh gibs (death-debris system), growing pools, fixed
  decal budget; last enemy of an encounter → 0.6 s slow-mo.

**Level pipeline (TrenchBroom)**

- Custom game config + `neon.fgd` entities: `info_player_start`, `info_checkpoint`,
  `enemy_grunt`, `enemy_drone`, `trigger_encounter` (spawns waves, locks doors until clear),
  `func_door`, `trigger_stage_end`, `light_point`.
- Texture names = material keys: `concrete`, `concrete_dark`, `metal`, `neon_cyan`,
  `neon_magenta`, `clip` (invisible collider), `trigger` (not rendered).
- Save in TrenchBroom → Vite HMR → level rebuilt in-browser in <1 s.

**Look: "Ember Noir"** (art pivot 2026-10-13)

The concept art is photoreal; what sells it is cheap: palette, silhouettes, depth layers, signage, wet light.

1. **Two-light rule.** Cold human light (fluorescent white, sodium, teal ads) vs **hell red** (emissive veins,
   embers, sky). Everything else is desaturated concrete/rust. Enemies are the reddest things on screen.
   Deeper into a stage = redder.
2. **Silhouette over detail.** The corruption shader (above) on every enemy.
3. **Depth layers.** Playable space = Quake brushwork. Beyond the railings: a non-colliding procedural
   backdrop (`src/world/backdrop.ts`: instanced towers + window-grid shader + ad billboards, hell-spire +
   sky ring shader, layered fog, drifting flyer lights), enabled per map by worldspawn keys.
4. **Text is free worldbuilding.** `info_sign` entities → canvas-rendered metro signs, Korvex ads, graffiti.

| Asset | Method |
| --- | --- |
| Architecture, stairs, pillars, trains | TrenchBroom brushes + reusable groups |
| Surfaces | Procedural triplanar layers (grime, rust, panel lines, wet puddle mask → low roughness), optional CC0 PBR sets (ambientCG / Poly Haven) per palette entry |
| Cables, pipes, railings | Code-generated point entities (later) |
| Clutter | Kenney / Quaternius CC0 packs |
| Signs / ads / graffiti | `info_sign` → CanvasTexture decal |
| Skyline, spire, sky | `backdrop.ts`, procedural + shaders |
| Enemies | see Enemies |
| Guns | floating viewmodel; Quaternius guns later |

- Post: N8AO → viewmodel pass → bloom → grade (AgX) → vignette + grain; chromatic aberration on damage;
  height fog. Ember/ash GPU particles. Fixed lights only (no runtime add/remove).

## Dev workflow: memory, agents, hooks (set up in milestone 1)

**`CLAUDE.md`** (concise, loaded every session) holds: a short pitch, the decisions above
(plus a dated decision log appended as we go), conventions (Y-up, 32 map units = 1 m,
120 Hz fixed step, feel values live only in `defs.ts`/tuning JSON), commands, layout, a
**milestone status checklist** kept current, the agent delegation policy, and what the hooks do.
The full design moves to `docs/PLAN.md`. CLAUDE.md links to it rather than importing it, so it
isn't loaded into every session. `git init` at scaffold time (commits only when you ask).

**Subagents** (`.claude/agents/*.md`, with `model:` set in frontmatter):

| agent            | model  | used for                                                                                                            |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `scout`          | haiku  | read-only lookups: find code, check lib APIs/docs, summarize files                                                  |
| `verifier`       | haiku  | run `npm run verify` + smoke, return only failures + screenshot path                                                |
| `implementer`    | sonnet | well-specified, self-contained tasks from a written spec: .map parser, fgd/config, HUD, pools, asset loading, tests |
| `asset-wrangler` | haiku  | inspect/organize/convert glb + audio, write manifests                                                               |

The main session (Opus) keeps the feel-critical and design work itself: movement,
recoil/viewmodel, AI behaviour, shaders/post, integration. It also reviews whatever the agents
return. The policy goes in CLAUDE.md so later sessions follow it too.

**Hooks** (`.claude/settings.json` + `.claude/hooks/*.sh`). These form the test loop before
anything is handed to you:

- `PostToolUse` (Edit|Write): runs prettier on the file. If the path is under
  `src/|maps/|trenchbroom/`, it touches `.claude/.dirty`. No typecheck per edit, because edits in
  the middle of a change cause noisy transient errors.
- `Stop` + `SubagentStop`: if `.claude/.dirty` exists, runs `npm run verify` (`tsc --noEmit` +
  vitest + headless smoke). On failure it exits 2 and sends the errors back, so Claude keeps
  fixing instead of delivering. A counter caps this at 3 blocked attempts, after which it lets
  the stop through and the failure is reported to you. On success it clears the dirty flag.
  Pure Q&A turns aren't slowed down.
- **Headless sim tests (vitest)**: the fixed-step sim is decoupled from rendering, so the player
  controller runs against parsed test maps with scripted inputs. Examples: "climbs stairs
  without snagging", "slide-cancel keeps ≥90% speed", "mantles a 1.2 m ledge", "bolt at 15 m is
  dodgeable by strafing", "recoil pattern is deterministic".
- **Smoke test** (Playwright + headless Chromium, `npm run smoke`): loads
  `?test=smoke` on the test course, runs a scripted walk/slide/fire sequence, and fails on console
  errors or very low FPS. It saves a screenshot to scratch so I can look at the result.

## Milestones

1. **Scaffold + workflow**: Vite/TS/three, fixed-step loop, pointer lock, input, dev tuning
   panel, stats; CLAUDE.md, docs/PLAN.md, agents, hooks, vitest + Playwright smoke wired up.
2. **Map pipeline** — TrenchBroom config/fgd/textures, .map parser + brush geometry
   (vitest: cube/wedge brushes → correct verts), BVH collider, entities, HMR. Ship a
   movement test course map. _(Done first so you can block out levels while I build movement.)_
3. **Movement** — capsule collision, full state machine, camera effects. Tuning pass together.
4. **Weapons** — AR + pistol with box placeholder viewmodels, hitscan, recoil, ADS, reload,
   all feedback FX, synthesized placeholder sounds → then swap to CC0 models/sounds.
5. **Enemies & loop** — navmesh, Grunt + Drone, projectiles, player health regen, damage
   indicators, death → checkpoint respawn, encounter triggers.
6. **Look pass / art pivot** — post stack, Ember Noir materials, backdrop, signs, corruption shader,
   flying demon, fireballs, on the `station_slice` look-slice map.
   6b. **Demons** — rigged-enemy pipeline, caster, Possessed, Hound, graphic gore.
7. **First stage** — one 5–8 min level with 3–4 encounters, stage-clear screen + time.

## Assets you'll need to grab (CC0 / royalty-free; downloads aren't scriptable)

- TrenchBroom (AUR `trenchbroom-bin` or AppImage).
- Quaternius _Ultimate Guns_ (or Kenney _Blaster Kit_) → `public/assets/guns/`.
- Kenney _Sci-Fi Sounds_ + _Impact Sounds_; optional Sonniss GDC bundle for real gun layers.
- Art pivot (milestone 6b): Quaternius rigged humanoid + animation library and an animated quadruped
  (wolf/dog) → `public/assets/enemies/`; optional CC0 PBR sets (ambientCG / Poly Haven, 1K: concrete,
  rusted metal, grate, tiles) → `public/assets/textures/<name>/`.
  Until then everything runs on procedural placeholders, so no milestone blocks on assets.

## Verification

- `npm run dev` → play in browser; the dev panel shows speed/state/FPS for movement tuning.
- `npm run verify` (tsc + vitest + smoke) runs automatically through the Stop hook. Covers
  the .map parser, brush geometry, spring/recoil math and the headless movement sim tests.
- `npm run build` clean at each milestone; CLAUDE.md milestone checklist updated.
- Per-milestone playtest checklist (e.g. M3: slide-cancel chain keeps speed, mantle works on
  every ledge in the test course, no snagging on stairs/slopes; M4: recoil pattern learnable,
  ADS feels snappy at 144 Hz; M5: bolts dodgeable by strafing at ~15 m).
- Performance target: steady 144 fps on a desktop GPU, 60 fps on integrated graphics.
