# Building levels in TrenchBroom

## One-time setup
1. Install TrenchBroom (Arch: `yay -S trenchbroom-bin`, or the AppImage from GitHub releases).
2. `npm run tb:install` — symlinks `trenchbroom/config` to `~/.TrenchBroom/games/Neon`.
3. In TrenchBroom: **Preferences → Games → Neon → Game Path** = `<repo>/trenchbroom`.
4. New map → game **Neon**, format **Valve**. Save into `maps/<name>.map`.

## Workflow
- `npm run dev`, open `http://localhost:5173/?map=<name>` (default: `stage1`).
- Save in TrenchBroom → the level rebuilds in the browser in place (player keeps position).
  Parse errors show a red toast and the old level stays loaded.
- Grid: **32 units = 1 m**. Player is ~1.8 m (56 units) tall. Good defaults: doors 3 m (96),
  corridors ≥ 3 m wide, step height ≤ 0.4 m (12 u), mantle-able ledges ≤ 2.0 m (64 u).

## Materials
Texture name = game material (`src/world/palette.ts`; editor PNGs are generated from it with
`npm run textures`). Add a material there, rerun `npm run textures`, refresh TrenchBroom's texture browser.

| material | use |
|---|---|
| `concrete`, `concrete_dark` | walls: board-formed concrete (seams, tie holes, rain streaks) |
| `concrete_floor` | floors: concrete + **wet puddles** on up-facing faces (mirror the lights) |
| `tile` | metro wall tiles (grout, chipped/missing tiles) — use as a dado below concrete |
| `metal`, `rust`, `grate`, `train` | panel metal with rust bleed, corroded metal, floor grating, vehicle body |
| `hazard` | yellow tactile platform-edge strip |
| `hellcrack` | corruption: dark rock/flesh with glowing, pulsing cracks (emissive) |
| `black` | voids (tunnel mouths), undercarriages |
| `neon_white`, `neon_red`, `neon_cyan`, `neon_magenta`, `neon_orange`, `window_lit` | emissive strips (bloom) — thin brushes on edges/ledges; `window_lit` = soft lit windows |

All detail is procedural in world space (no UV work): the brush texture only picks the material. Ember Noir rule:
keep surfaces desaturated, spend red on corruption/danger and cold white on human light.
| `clip` | invisible collision (smooth stairs, block exploits) |
| `trigger` | trigger volumes (auto-applied to `trigger_*` brush entities) |
| `skip` | faces never seen (not rendered, still collide) |

## Entities (`trenchbroom/config/Neon.fgd`)
| entity | type | keys |
|---|---|---|
| `info_player_start` | point | `angle` |
| `info_checkpoint` | point | `targetname`, `angle` — respawn point |
| `trigger_checkpoint` | brush | `target` → an `info_checkpoint` (same as a `trigger_once` targeting it) |
| `trigger_encounter` | brush | `targetname`; `target` → used when cleared (doors among them stay shut while active); `start_target` → used on start; `message` |
| `enemy_grunt`, `enemy_drone`, `enemy_possessed`, `enemy_hound` | point | `encounter` + `wave` (encounter waves) **or** `targetname` (ambush: spawns alerted when used) **or** neither (placed, waits); `angle` |
| `func_door` | brush | `targetname`, `move` ("x y z" units), `speed`, `toggle` (1 = used again closes) |
| `trigger_stage_end` | brush | — |
| `light_point` | point | `_color` (0–1), `intensity`, `range` (m), `targetname` (used = toggled), `style` (`flicker` / `pulse`), `start_off` |
| `trigger_once` / `trigger_multiple` | brush | `target`, `delay`, `message`; multiple: `wait` (s) |
| `trigger_relay` | point | `targetname`, `target`, `delay`, `message` — chains and timers |
| `target_sound` | point | `targetname`, `sound` (demon_growl, possessed_shriek, hound_snarl, demon_death, …), `volume` |
| `info_sign` | point | `text` (`\|` = new line), `style` (`metro`, `metro_badge`, `ad`, `ad_red`, `graffiti`, `floor`), `width`/`height` (m), `angle` = facing, `arrow` (`left`/`right`). Origin = center of the face, ~2 cm off the wall |
| `worldspawn` | — | `backdrop` (`city` = burning skyline beyond the level, `none`), `corruption` (0–1 sky redness/embers), `spire_angle` (deg, where the hell-spire stands) |
| `func_detail`, `func_group` | brush | treated as world |

### Wiring (Quake-style `targetname` / `target`)
Anything with a `targetname` can be **used**; triggers, relays and encounters use their `target`s (several allowed,
comma/space separated), optionally after a `delay`. What "used" means per class:
door → opens (or toggles), light → toggles, `target_sound` → plays, `info_checkpoint` → becomes the respawn point,
enemy with a `targetname` → spawns alerted, `trigger_relay` → shows its `message`, uses its targets.
There is **no per-map code**: a scripted moment is entities + keys. Recipes:
- *Ambush*: `trigger_once` → `target ambush1`; place enemies with `targetname ambush1` out of sight.
- *Lights die as you enter*: `trigger_once` → `target hall_lights`; `light_point`s named `hall_lights`.
- *Sequence*: `trigger_once` → relay A (`delay 1`, `message "…"`) → relay B (`delay 2`) → door + sound.
- *Lock-in fight*: `trigger_encounter` `target exit_door` (shut while active, opens when cleared),
  `start_target slam_sound`.
- `message` text: `\n` = new line.

### Who owns a map (pairing)
Maps written by a generator (`scripts/gen-*.ts`: test_course, arena_test, station_slice, stage1) are **overwritten** when
the script runs — edit the script, or stop regenerating it once someone edits the `.map` in TrenchBroom. Maps built
in TrenchBroom are hand-owned: block out the structure (brushes + palette textures), and the rest — lights, signs,
encounters, waves, wiring, cover — can be added on top as plain entities (Claude edits the `.map` text directly).

### How encounters play
- Entering a `trigger_encounter` spawns its **wave 0** (every enemy whose `encounter` = its targetname and `wave` 0),
  already alerted. When a wave is dead, the next wave spawns 1.4 s later. When the last wave dies the area is
  cleared: doors listed in the trigger's `target` open, time slows briefly, "AREA CLEARED".
- Enemies with no `encounter` (and no `targetname`) are placed at load and wake up when they see/hear you.
- `func_door` gated by an encounter stays shut until it's cleared; any other door opens when you walk up to it.
- Dying respawns you at the last `info_checkpoint` reached via a `trigger_checkpoint`. The encounter you were in
  resets; cleared areas stay cleared.
- `trigger_stage_end` finishes the stage only when every encounter is cleared. `worldspawn` `message` = the title on
  the stage-clear screen.
- Ground enemies (grunt, possessed, hound) need navmesh-walkable floor (≥ ~1 m wide, slopes ≤ 40°, steps ≤ 0.6 m; stairs of 0.25 m rise bake fine). Drones fly anywhere.

### Backdrop and open sides
With `backdrop` = `city`, whatever the player can see past the level's edges is the skyline: leave sides or roofs
open (columns, railings + a `clip` wall) instead of closing every room. The key light (red, from `spire_angle`)
casts shadows, so openings toward the spire throw red light shafts inside. Towers stay ~140 m beyond the level
bounds; near ones top out below the level, so elevated levels look out over the city.

### Example
`maps/arena_test.map` (generated by `npm run gen:arena`) has two encounters, doors, checkpoints and a stage end.
Open it at `?map=arena_test`. `maps/station_slice.map` (`npm run gen:station`) is the Ember Noir look slice:
tunnel → elevated metro hall (platform, track bed + train, mezzanine, catwalk open to the skyline) → exit.

## Test course
`maps/test_course.map` is generated by `npm run gen:course` (`scripts/gen-test-course.ts`). Its
dimensions are asserted by tests, so don't hand-edit it — copy it to a new name to play with.
