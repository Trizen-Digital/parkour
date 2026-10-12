# Parkour demo

`@trizendigital/parkour-demo`: the game at [parkour.trizen.dev](https://parkour.trizen.dev/), built on
[`@trizendigital/parkour`](../parkour/README.md), with everything behind it: the Y Bot, the courses, the QA replay player,
the benchmark, the tools and the tests.


A third-person parkour game in the browser. The Y Bot runs, jumps, vaults, hops onto walls, catches and climbs ledges,
runs along walls, swings on bars and ropes, climbs pipes and ladders, slides down poles, rides ziplines, barges through
doors, turns valves and presses buttons, flips and rolls, and goes limp into a ragdoll when it falls too far, across
graybox courses built from a few kinds of block. The runner steps at a fixed 120
Hz whatever the frame rate, so the same input always makes the same run: that is what lets a QA replay or a golden tape
run again to the bit. Its moves come from motion capture through a pose graph written in code, the camera follows it
over the shoulder or rides its head, and the physics runs on box3d.js (the default) or on Rapier. Courses come from files or from a
generator, and a validator checks them against the level metrics. Easy mode hands the timing of jump, grab and precision
to a pilot that looks ahead.

Built on three.js 0.186.1 (WebGPU, with a WebGL2 fallback), Rapier 0.21.0 and box3d.js 0.1.1, with Vite 8.

## Running it

Three ways, each with the QA replay library (V to capture, L for the library):

| Where | How | Replays are kept |
| --- | --- | --- |
| [parkour.trizen.dev](https://parkour.trizen.dev/) | open it | in the browser, until shared |
| Installed | `npx @trizendigital/parkour-demo` (http://localhost:5412/) | in `./qa/` where it runs |
| A clone | `npm install`, then `npm run dev` from the repo's root (http://localhost:5410/) | in `qa/` here |

The page opens on `test_basic`. Click the view to capture the mouse; Esc opens the menu. The address takes three
options:

| Option | What it does |
| --- | --- |
| `?course=test_gaps` | starts on another course (any file in `public/courses/`, or `generated`) |
| `?engine=rapier` | runs on Rapier instead of box3d |
| `?easy=1` | starts in Easy mode |

`npm run dev:nohmr` serves the same game on http://localhost:5411/ with hot reload off, for tests in a background tab
that an edit must not reload. `npm run build` writes the hosted build into `dist/` (what parkour.trizen.dev serves;
`npm run preview:hosted` builds and serves it on http://localhost:5413/), and `npm run build:package` the installed
one into `app/` (`npm pack` runs it).

## Playing it

| Action | Keyboard and mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Run | W A S D | left stick | the stick, under the left thumb wherever it lands |
| Look | mouse | right stick | drag on the right |
| Sprint | Shift (held) | R2 | the stick pushed to its edge |
| Jump | Space: held on the ground it charges, the jump goes when it is let go | south (A / ✕) | Jump |
| Roll on landing | Space held in the air | east (B / ○) | Jump held (Easy mode rolls a hard one) |
| Grab: vault, hop, catch a ledge, wall run, take a bar, rope, pole, pipe, ladder or zipline | left button | L2 | Grab (Easy mode grabs in the air) |
| Precision: crouch and aim a precision jump; land on a perch. In front of a door, a valve or a button (Interact): kick it open, turn it, press it | E | L1 | Easy mode aims; Kick, Turn or Press shows where Interact works |
| Flip: side flips, vortex, spin, back cork; kick off a ledge or a wall | F | west (X / □) | Flip |
| Wheel: cartwheel, front flips | R | north (Y / △) | Wheel |
| Dive: dive roll; drop from a ledge or a pipe | T | east (B / ○) | Dive |
| Back flip | G | | Back Flip |
| Spin dive | F, then T within half a second | west, then east | Flip, then Dive |
| Slide | X | L1 + east | Slide |
| Slow motion (a toggle; quarter speed, eased in and out over 0.15 s) | right button | R1 | |
| First person | C | d-pad right | |
| Turn the view while falling | middle button held | | drag on the right |
| Field of view | wheel | R1 + d-pad up / down | |
| Go limp (the ragdoll) | 4 | R3 | |
| Stand up, while limp | Space | south | Jump |
| Restart the course | Backspace | View (select) | the menu's Restart |
| The menu (pauses the run) | Esc or P | Menu (start) | the pause button, top right |
| Set a mark, back to the mark | numpad 2, numpad 3 | d-pad down, up | |
| Easy mode | B | | always on |
| Capture the last seconds for QA, the replay library | V, L | | |
| The benchmark (QA) | K | | |
| Hide the UI | H | | |

In the air the mouse, or a flick of the left stick (the touch stick too), points the trick: which way decides which flip a
trick button does.
While limp, holding a direction pushes the body along it.

**Doors** open away from the runner. Run at a shut one (2.5 m/s or faster) and the shoulder barge bursts it open
without slowing; walk up to one and press E to kick it open. A valve (E: turned with both hands) or a button (E: pressed
side-on, with the hand on the side the runner was heading) opens the shut doors within 4 m of it. An open door swings
shut 4 s later, once the runner is clear of it.
**Ropes** are caught in the air with grab held, from any direction. The body swings from the anchor: the stick pumps
the swing back and forth or steers it round; let go of jump to leap off with a kick, or of grab to drop. **Ladders**
work like pipes: grab at the foot (or in the air), the stick climbs and slides down the rails, jump leaps off, T drops,
and at the top the runner climbs out onto the floor there.

**Easy mode** (B, or *Settings › Game › Easy Mode*): you steer, sprint and press jump; a pilot holds jump for the right
time, grabs at the right moment, aims a precision jump when you are walking or standing with the stick pushed, and rolls
a hard landing. It presses the keys through the input as you would, so whatever you hold of jump, grab and precision
still counts, and a QA capture records its presses like yours.

**Touch controls** come on when the screen is touched, as the keyboard and the pad take over when they are used (a phone
or a tablet starts on them), and go off at a key, the mouse or a pad. They play in Easy mode, so they have only what it
leaves to the player: the stick (pushed to its edge, it sprints), a drag on the right to look (the view turns in the
air too), Jump, Grab, Slide, Dive, the three tricks, and a button that shows only where Interact works something.
They press the same keys and a pad's stick through the input (src/touch/), so a run played by touch replays exactly.

**First person** (C) puts the camera at the Y Bot's eyes. Tricks stay in first person; the view turns with the body
through them.

**Game Mode** opens on the first visit and from the menu: the *Tutorial* (sixteen lessons on one path, a card on the HUD
for each and a flag to go back to), the *Sandbox* on a course (the Foundry, the family test courses, or one generated
from a seed) and the *Benchmark*. `?mode=tutorial`, `?mode=sandbox` or `?mode=bench` skips it.

**The menu** (Esc, P or the pad's Menu button) pauses the run and holds it while it is open: *Resume*, *Restart*,
*Game Mode*, *Replays*, *Settings* and *Controls*. It is a game menu (src/ui/, in Svelte): the keyboard
(arrows or W A S D, Enter, Esc, Q and E for the tabs), the mouse or a pad (d-pad or stick, A, B, LB and RB) moves
through it. Letting go of the mouse in play (Esc in pointer lock) opens it too. *Settings* has a tab each:

- *Game*: Easy mode, camera lag, the head camera in first person, tricks in first person.
- *Video*: the quality (Auto finds, at each load, the best tier that holds 60 frames a second; or a tier, or Custom),
  the render scale (up to 1.5 pixels per screen pixel), global illumination, the course's look (Runner Vision full by
  default, or on, off, or the graybox), brightness, the sky's light, motion blur, and the illumination's strengths.
- *HUD*: the jump meter, the frame rate, the runner's state (debug info), the course markers (the route's moves).
- *Controls* and *Controller*: the player's preferences (inverted look, sprint and slow motion held or toggled, look
  speed) and every binding, read from the action table. Like a tuning change, a preference change is recorded on a QA
  capture as a setting.
- *Tuning*: every number a designer adjusts while playing (speeds, jumps, traversal, the ragdoll, the camera, the
  input), angles in degrees. Values are saved in the browser.
- *Course*: generate a course from a seed, validate the loaded one and list what it finds, draw its route, show the
  reach envelope, preview Runner Vision from the free camera.
- *Debug*: the **physics engine** (Rapier or box3d; each run is built on one engine, and choosing the other builds the
  run again on the same course; `?engine=rapier` starts on Rapier), the free camera (orbit with the mouse, fly with
  W A S D, Q and E down and up), the capsule, the affordance and volume overlays, the replay buffer and its length.

Restore Default (R, or the pad's Y) puts a tab back to its defaults. The demo's own options (the HUD, the look) are
kept in the browser.

**QA replays**: V pauses and opens the editor on the last 20 seconds, to trim, annotate and file; L (or the menu's
*Replays*) opens the library. A saved replay is run again on a fresh simulation to check it replays exactly. Share (F)
packs a replay as a `.qa.zip` and opens a GitHub issue for it; `npm run qa:open -- <zip>` runs one again at its own
commit. [qa/README.md](qa/README.md) is the guide.

**The benchmark** (K, Game Mode's *Benchmark*, or `?bench=1`): an autopilot plays every move and trick, most at four
sizes, along one course of 190 stations, through the keys and mouse as a player would; you watch it in third or first
person on either physics engine, scrub to any moment exactly, play it at 0.25× to 16×, and pin comments (which may
overlap) to stretches of it, saying which view and engine each is about. The comments go to `qa/bench/comments.json` (kept in
your copy, not in git) for an agent to rewatch and act on. [qa/README.md](qa/README.md) (The benchmark) is the guide.

The HUD shows the jump's charge while it builds, Easy mode when it is on, and the prompts. *Settings › HUD* adds the
frame rate and the debug info: the runner's state, speed, the move playing, how it is moving, Easy mode, the input
device, the physics engine and how much there is to capture.

## Checks

| Command | What it proves |
| --- | --- |
| `npm test` | the node tests (`tests/*.test.mjs`): the clock, the runner and its systems, the pose graph and the moves, the mover and the physics contract on both engines, the ragdoll, input, the camera, courses, the simulation shell and QA replays |
| `npm run golden` | every golden tape (`tests/golden/tapes/`) run headless with the Y Bot on box3d gives its trace in `tests/golden/box3d/` bit for bit |
| `npm run golden -- --engine rapier` | the same on Rapier, against `tests/golden/rapier/` (the engines find contacts each their own way, so each has its own traces) |
| `npm run golden:bless` (`-- --engine rapier`) | writes those traces again: only after a change meant to alter the game, with the reason in the commit |
| `npm run purity` (`-- --engine rapier`) | the simulation reads no pose: every tape run with the timing-only figure gives the Y Bot's golden trace, except where the ragdoll has the body or the first-person camera rides the head |
| `npm run snapshots` (`-- --engine rapier`) | a snapshot puts a run back exactly: each tape restored halfway after three seconds of other input goes on bit for bit as played straight |
| `npm run lanes` | every jump lane of the family courses, driven by hand (the jump tapped 0.6 m early) and in Easy mode: how many each makes |
| `npm run bench` (`-- --engine all --view all`) | the benchmark headless: every station played by the autopilot, which pass, and the run's fingerprint (`--comment <id>` prints a comment's stretch; `--dump <station>` a station's frames) |
| `npm run reach` | every route link on every authored course, by hand and in Easy mode: which the runner makes, which only Easy makes, which it has no move for |
| `npm run moves:build` | builds `public/data/moves.json` and the clips built from captures from the move specs in `tools/moves/families/` |
| `npm run moves:check` | the shipped motion data is exactly what the specs build |
| `npm run moves:captures` | lists the placeholder takes waiting for a capture |
| `npm run qa:open -- <zip>` | a shared replay at its own commit and on the code now: exact, or the first frame that differs |
| `npm run build` | the game bundles |

`node tools/headless/run.mjs <tape.json> <trace.json> [ybot|stub] [rapier|box3d]` runs one tape and writes its trace;
`node tools/headless/golden.mjs tapes` writes the golden tapes again from their scripts
(`tools/headless/scenarios.mjs`). The golden, purity and snapshot tools take a name filter
(`npm run golden -- wallrun`); lanes and reach take `--engine rapier`. Every tool runs on box3d unless told.

The repo's [AGENTS.md](../../AGENTS.md) says which of these to run for which kind of change. Run them from the repo's
root (`npm test`, `npm run golden -- --engine rapier`) or from here.

## Layout

The runner (the simulation, the runner's systems, the motion and pose graph, the figure, the physics contract, the
world, the camera, the input, the pilot and the replay format) is the core package, `@trizendigital/parkour`
(`packages/parkour/src/`, [its README](../parkour/README.md)); the engines are `@trizendigital/parkour-box3d` and
`@trizendigital/parkour-rapier`. This package is the rest:

| Where | What |
| --- | --- |
| `src/main.js`, `src/app/`, `src/stage/` | the game page and the player; rendering (the sky, shadows, global illumination) |
| `src/engines.js` | the physics engines by name, box3d (the default) first |
| `src/world/fromCourse.js` | the demo's world adapter: a course turned into the world description the core takes |
| `src/figure/YBotFigure.js`, `src/data/` | the Y Bot: the core's `RiggedFigure` with its rig (`ybot.json`) and ragdoll (`ybot-ragdoll.json`) |
| `src/course/` | courses: primitives, derived edges and walls, the route, the validator, the generator, the family test courses, Runner Vision |
| `src/qa/` | QA replays: the recorder, replays, the editor, the library, the store's clients (files and browser), sharing, lanes |
| `src/bench/` | the benchmark: its stations (`stations/`), its course, the autopilot, a run worked out and keyframed, comments, the page |
| `public/data/` | the takes and moves (`moves.json`) and each take's clip (`takes/`), built by `npm run moves:build` |
| `public/courses/`, `public/models/`, `public/env/` | the authored courses, the Y Bot, the sky |
| `public/qa-console.js` | helpers for reviewing replays from the browser's console (on the dev server) |
| `assets/mocap/` | the motion capture the takes are cut from (not loaded by the game) |
| `bin/parkour-demo.mjs` | the installed demo's server: the built game and the QA store on `./qa/` |
| `tools/headless/` | the game in node: tapes, traces, the golden, purity and snapshot checks |
| `tools/moves/` | the move builder: the family specs, build, check, the capture list; the tools that reshape a kept take (`rekey`, `stride`, `tuck`, `reshape`) and read one (`limbs`) |
| `tools/reach/`, `tools/easy/` | what the runner makes on the courses, by hand and in Easy mode |
| `tools/bench/` | the benchmark headless |
| `tools/qa/` | `check.mjs` runs a replay headless; `open.mjs` is `npm run qa:open` |
| `tools/sheet/` | contact sheets of takes on the Y Bot, screenshots and their comparison |
| `tools/courses/` | writes the family test courses from `src/course/families.js` |
| `tools/qa-store.js`, `tools/build-info.mjs` | the store that keeps QA replays in `qa/`; what a build is (its commit and versions), which replays record |
| `tests/` | the node tests; `tests/golden/` the golden tapes and their traces per engine |
| `qa/` | QA replays (curated in `replays/`, yours in `local/`, shared with you in `incoming/`), their categories, the benchmark's comments (`bench/`), and the guide |
| `docs/` | how the game works, its motion data, its feel in numbers, and the level metrics |

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the game works, for a developer arriving.
- [docs/MOVES.md](docs/MOVES.md): the takes and moves, the move builder, and the captures still to make.
- [docs/DESIGN.md](docs/DESIGN.md): the runner's feel in numbers, measured from the game.
- [docs/METRICS.md](docs/METRICS.md): the level metrics courses are built to.
- [qa/README.md](qa/README.md): QA replays.

Contact sheets: run `node tools/sheet/receiver.mjs` (it listens on the sheet tools' port, 5998, `tools/sheet/port.js`,
and saves into `tools/sheet/out/`), open the game, then in its console `await import( '/tools/sheet/sheet.js' )` and
`await __sheet( { cells: [ [ take, time ], … ] } )`.
