# QA replays

The game's human-in-the-loop QA. You play; when something looks wrong you capture the last seconds, trim them, write
notes against the frames and file the replay in a category. An agent reading this folder can run any replay again
exactly (the same course, physics engine, settings, start and raw input, frame by frame, to the bit) and work from your
notes and the category's description. The code is `src/qa/`; the store is `tools/qa-store.js` (on the dev server and the
installed demo's server; the hosted demo at parkour.trizen.dev keeps replays in the browser instead).

Replays are also how issues are reported: **Share** packs one as a `.qa.zip` and opens a GitHub issue for it, and
`npm run qa:open -- <file>.qa.zip` runs it again at the commit it was recorded on (Sharing, below).

## Using it

In play:

- **V**: capture. The game pauses and the editor opens on the last 20 s (*Settings › Debug › Capture Length* sets the
  length, 5–60 s). It reaches back to the last respawn before then, which it needs to replay exactly; that part isn't
  shown.
- **L**, or the menu's *Replays*: the library.
- The HUD's debug info (*Settings › HUD › Debug Info*) has a `replay` line: how much there is to capture. A tape begins
  at a respawn (the course loading, a fall, the menu's *Restart*, a test's lane); with *Settings › Debug › Replay
  Buffer* off nothing is recorded.
- Capture is on the keyboard only.
- The pause menu holds the run too: nothing is recorded while it is open, and what was pressed in it is dropped when
  play goes on (the tape notes that as the input cleared). When the run paused itself (Esc or P), play goes on through
  the same key, pressed through the raw input, so the tape has both presses.

The editor:

- **Timeline**: states, moves, speed (red marks: pops, a joint a frame out of place), your presses as they reached the
  game (J jump, G grab, P precision, S slide, T W F tricks, O slow motion, V view, L limp, M K mark and
  back, ‖ pause, E Easy mode; bars under them while jump, grab or sprint are held; a green band where Easy mode was on;
  in Easy mode the pilot's presses are the ones shown), respawns (⟲), the input forgotten (∅, a blur or the mouse let
  go), setting changes (•) and note pins.
- **Scrub**: drag on the timeline. **Trim**: drag the bright window's ends, or **I** / **O** at the playhead. The frames
  outside the window stay in the file; trim back out any time.
- **Play**: space (looping over the window), with 0.1×–1× speeds. **←** / **→** steps a frame (shift: ten),
  **Home** / **End** jump to the window's ends.
- **Notes**: **N**, type, **Enter**. Each note is pinned to the playhead's frame and gets a still. Click a note's
  time to go there; edit its text in place.
- **Title**, an optional description of the whole replay, and a **category** (the arrows beside it; the library makes
  new ones).
- **Orbit** looks round the character at the frame you're on (left drag turns, right drag pans, wheel zooms).
- **Path** draws the character's path over the capture.
- **Play From Here** runs the replay to the playhead on the live game and hands it to you. Nothing moves until you press
  a key, a button or the stick, then the run goes on from exactly that state (speed, momentum, the move half done). The
  live game takes the replay's course and physics engine and keeps them. A capture later reaches back into it.
- **Save** (⌘S) writes it, then runs it again on a fresh simulation to check it replays exactly. The toast says so; if
  it doesn't, that's a determinism bug and worth reporting. **Discard** or **Esc** drops it. Either way the game waits,
  paused, until you move. On a saved replay, **Esc** goes back to the library.

The library:

- Categories are tabs, with the inbox first for anything not filed. **←** / **→** moves the selected replay into the
  category before or after; dragging a replay onto a tab files it there.
- **Enter** (or a click) opens a replay in the editor. It's run again first (a few seconds), on the physics engine it
  was played on, and the check says whether it still comes out as recorded. A replay played on another course shows
  that course while it's open. The side panel names the course (and lane), the device, the frame rate, Easy or Manual,
  the engine, any tuning off its defaults and the commit.
- *New Category* adds a tab. On a category: *Rename*, *Delete* (its replays go to the inbox); click its description to
  edit it, and say what belongs in it, since whoever reviews the replays reads that too.
- The details say where a replay is kept: **Yours** (`qa/local/`, your captures, not committed), **Shared**
  (`qa/incoming/`, opened from someone's `.qa.zip`, not committed) or **Curated** (`qa/replays/`, committed and run by
  the tests).
- **F** shares the selected replay, **P** promotes it into `qa/replays/` (commit it after), **X** moves it to
  `qa/trash/`.
- *Open File* (or dropping a `.qa.zip` on the library) opens a replay someone shared.
- **Esc** goes back to the pause menu and puts your own session back exactly as you left it (its course, the
  character, the camera).

## The folder

| Path | What |
|---|---|
| `categories.json` | `[ { id, name, description, color } ]`, in tab order (not in git: each person's own) |
| `replays/<id>.json` | A curated replay (below), committed and run by `tests/qa.test.mjs`. `<id>` is `YYYYMMDD-HHMMSS-<course>` |
| `replays/<id>.jpg` | Its thumbnail: the first note's frame, else the window's start |
| `replays/<id>.<note id>.jpg` | The still at each note |
| `courses/<name>-<hash>.json` | The course definition a curated replay was played on, kept as it was then (the files change) |
| `local/` | Your own captures, laid out the same (`local/<id>.json`, stills, `local/courses/`): where Save puts them (not in git) |
| `incoming/` | Replays others shared, opened from a `.qa.zip`, laid out the same (not in git) |
| `trash/` | Deleted replays (not in git) |
| `review/` | Stills and contact sheets made for a reviewer (not in git) |
| `bench/comments.json` | Comments on the benchmark's timeline, and `bench/<id>.jpg` their stills (The benchmark, below; not in git: each person's own) |

## A replay file (`format: "qa-replay/1"`)

Meta first, frames last. Times are seconds; frames index the file's frames (frame 0 follows the respawn at `start`).

- `title`, `description`, `category`, `notes: [ { id, f, t, text, still } ]`: `t` is seconds from the capture's start.
- `course: { name, title, hash, file, generated, lane }`: `generated` is `{ seed, length, difficulty }` for a generated
  course; `file` is its definition in `courses/`.
- `build: { commit, sha, branch, dirty, remote, pushed, how, url, version, packages, motion }`: the code it was
  recorded on (`tools/build-info.mjs`): the commit, whether tracked files had changed, whether it is on a remote, how
  the page ran (`dev`, `installed`, `hosted`), the demo's version, the versions of the packages a run depends on, and a
  hash of the motion data. Older replays have only `commit`, `dirty` and `branch`.
- `environment: { browser: { engine, name, version }, os: { name, version, arch }, display: { dpr }, ua }`: where it
  was played (`src/qa/environment.js`).
- `headless: { exact, divergedAt, fingerprint, node, platform, arch, commit }` (curated replays): how it ran in node
  when it was promoted. A replay played in a browser can come out differently in node from some frame on (the camera's
  field of view comes from `Math.tan`, whose last bit browsers and node may round differently), so the tests check that
  node still makes the run it made then (`fingerprint`, every frame's hash, `tools/qa/fingerprint.mjs`).
- `setup: { device, fps, easy }`: for reading it (the device used last, the display's rate, Easy mode at the start).
- `settings`: everything that changes a step, as it was at frame 0: `engine` (the physics engine it was played on,
  `rapier` or `box3d`; a replay is run on a simulation built on it; Rapier when it is left out), `tuning` (the tuning
  values), `preferences` (the player's preferences: inversion, toggles, …; the settings' *Controls* tab sets them),
  `aspect` (the camera's; the field of view follows it) and the random `seed`.
- `start: { position, yaw }`: the respawn it begins with (the capsule's centre).
- `range`: the frames captured (the editor's timeline; those before it lead up from the respawn). `window`: the trim,
  also as times `t0` / `t1`. `frames`, `duration`.
- `verified`: the check made as it was saved (`ok`, `at` s, `frame`, `commit`, `date`). `checked`: the latest run again,
  maybe on newer code (the same, and `dirty`: uncommitted changes).
- `summary`: what played in the window, in order (`flow`, `> move` lines), the `presses`, `pops`, `moves`, `maxAcc`.
- `events: [ { f, respawn | clear | settings, edges } ]`: what changed the run between frames, made at frame `f`'s start
  before its input: a respawn (`{ position, yaw }`), the input forgotten (a blur, the mouse captured or let go),
  settings changed (`{ tuning, preferences, aspect }`, only what changed: the settings' *Tuning* and *Controls* tabs
  set them between frames; the engine never changes within a recording). `edges` are the key edges queued before it.
- `input`: the raw input of every frame, as the input system took it in (`@trizendigital/parkour/input/deviceState.js`): `dt` (the
  frame's step), `mx` `my` `wheel` (the mouse's movement since the last frame), one entry per frame; `edges` as
  `[ frame, [ [ key, 'pressed' | 'released' ] ] ]` for the frames with any (a tap between two frames); `keys`,
  `buttons` (mouse), `pad` (`[ id, axes, buttons ]`, a button `0`/`1` or `[ pressed, value ]`), `enabled` (the mouse
  captured), `editing` (a text field focused) as runs, `[ frame, value ]` where the value changes. `"-0"` is −0.
- `trace`: what came of it, a column per field: `hash` (the frame's: every step's position, velocity, yaw, movement
  mode, state, move and its time, stunt and its time, markers, then the camera's place, rotation and field of view,
  the view's yaw and pitch, the frame's events), `x` `y` `z` in mm, `yaw` `cy` `cp` in mrad (facing, view yaw and
  pitch), `v` `vy` in cm/s, `tau` (ms into the move), `steps`, `acc` (peak joint acceleration, m/s²); `states`,
  `moves`, `modes`, `easys` as `[ frame, value ]` where they change.

## How it's exact

The simulation is deterministic: the same course, physics engine, settings, frame steps and raw input give the same
frames, to the bit. The engine is part of what a run is (the two find contacts each their own way), so a simulation is
built on one and a replay runs on the engine it was recorded on. A respawn starts everything a run carries again, as the
simulation was when it loaded (`Simulation.respawn`: the runner, the motion and its graph, the view and the follow
camera, the input's latched edges and combos, the mark, the random streams; the page's devices and preferences stay), so
a tape replays on a freshly loaded simulation. The tape records the raw input as it reached the simulation: under Easy
mode's pilot, whose presses are recorded like a device's (a replay never runs the pilot), and the gamepad frozen as
recorded for the frame. Anything else that changes the run between frames is an event at the next frame's start:
respawns (a fall too), the input forgotten, the tuning, the preferences, the window's aspect. A course change, or a
change of physics engine, is a new simulation, so a new tape.

A replay that comes out differently (a hash that doesn't match) means one of two things:

- **The code or the course changed since it was recorded.** Expected after a fix. What's shown is what the same inputs
  do now; Path shows both paths.
- **It didn't replay exactly even as it was saved** (`verified.ok: false`). Something a step reads isn't reset by a
  respawn, isn't recorded, or isn't deterministic. Find it with `stateDump()` / `diffDumps()` (below): dump two
  simulations at the same point (the same frame of the replay on a fresh simulation and on one with history) and
  read what differs.

## Reviewing replays (for agents)

Use a background tab on the HMR-off server (`npm run dev:nohmr`, http://localhost:5411/), then
`await import( '/qa-console.js' )` in its console:

- `await replays()`: the categories and every replay's meta and notes.
- `await replayRun( id )`: the replay run again on a simulation of its own. Returns `reproduced`, `divergedAt`
  (`{ frame, t }`: the first frame whose hash differs), `rows` (the window's: `f`, `t` s into the window, `state`,
  `move@time`, `mode`, `v`, `y`, `acc`, `hash`, `ok`), each note with its frame's row, `flow`, `pops`, `presses`, the
  category with its description and the `summary`.
- `await replayCheck()`: every replay run again on the current code: which replay exactly, which now come out
  differently and from when; the result goes into each file's `checked`.
- `await replaySheet( id, { at, span, count, orbit: { yaw, pitch, dist } } )`: stills around a moment as one image
  in `qa/review/`.
- `await laneRun( course, lane, { easy, early } )`: a family course's lane driven as its metadata says, by raw
  input on the live game (the stick along the lane, the lane's press `at` m before its feature, `early` m sooner;
  Manual or Easy; `src/qa/lanes.js`, shared with `tools/easy/lanes.mjs`). It's on the tape like play: `tapeCheck()`
  runs it again, V captures it.
- `await tapeCheck()`: the live tape run again on a fresh simulation: exact, or where it first differs.
- `trace( frames )`: the live tape's last rows. `stateDump()`, `diffDumps( a, b )`: the simulation's state, flat.

When a replay or a category is pointed out:

1. Read the notes, the category's description and `summary`.
2. Replay it, and look at the rows around each note: the frame, the state and move, the acceleration.
3. Make a contact sheet there to see it.
4. Fix it at the right layer.
5. Replay it again. It should now come out differently from the recording at the note, and the rows say whether
   that's the fix.

Headless, `tests/qa.test.mjs` records runs the way the game does (Manual and Easy, a bail, a gamepad, events between
frames, a take-over) and replays them on fresh simulations, every frame's hash identical.

## The benchmark

A second QA mode: an autopilot runs every move and trick the runner has, one station after another along one long
course, and you watch it, scrub it, and pin comments to stretches of it. The code is `src/bench/`.

**K** (or the menu's *Benchmark*, or `?bench=1` on the address) opens it over the game. It builds its course and
starts working the run out at once, a few milliseconds a frame (the top bar says how far; the whole run takes about
half a minute). It holds the live game, and Esc (or *Back*) goes back to the pause menu with the game as it was.

- **What runs.** 190 stations, most at four sizes across what the game allows: hurdles; the three vaults (dash, speed,
  kong) and the power jump at 0.75–1.2 m; hops; jumps and catches of 1.4–2.3 m edges; wallclimbs of 2.9–3.9 m;
  gaps up and down; precision jumps onto perches; strides, and a dozen strides in a row over uneven gaps (on the level,
  stepping up and down, over stones); wall runs on 2–4 m walls and off them every
  way, across gaps; a wall kick and a wall plant; hanging, shimmying, corners, leaps up and across, letting go, a free
  hang; poles, bars, bar to bar, ropes from four heights; drainpipes and ladders up 3–8 m and back down; ziplines at
  5–20°; doors barged and kicked, valves and buttons; slides, slides under bars and down slopes, beams, a skid stop,
  slopes; drops of 1.5–9.5 m (landed, hard, rolled), a fatal fall and going limp (each stood up from); every ground
  trick; and the eleven air tricks off four heights each (the four short ones from a jump on the level and off 2, 4
  and 6 m; the rest, which need the air, off 2, 4, 6 and 8 m), and four repeated in one air. About 23 minutes.
- **Real input.** The autopilot never touches the runner: it presses keys, the left mouse button and moves the mouse,
  as a player would (`src/bench/Autopilot.js`). The keys it holds light up top left; a mouse flick (a trick's
  direction) shows as an arrow. A station that goes wrong (an unplanned bail, a fall, nothing done for too long) is
  marked red on the timeline, and the run goes on from the next station's start.
- **Engine and view.** Rapier or box3d, third or first person, from the top bar (C switches the view). First person
  changes how the runner moves (it strafes, steers poles and pipes by the view), so each view is a run of its own;
  switching keeps you at the same place in the same station.
- **Exact.** The run is deterministic: the same code, engine and view always give the same run, frame for frame. It is
  keyframed as it is worked out (every station's start and every 5 s), so going anywhere puts back the keyframe before
  and plays up to the frame: what you see there is exactly what the run did there, however you got to it.
- **Moving about.** Space plays and pauses; 0.25× to 16×; ← → 5 s (shift: 1 s); , . a frame; [ ] the station before
  and after; Home the start. Click or drag the upper timeline (the whole run: stations coloured by family, failures
  red, comments, what is not yet worked out darkened) or the lower one (around the playhead: the stations by name,
  the runner's states, the comments in rows; the wheel zooms it). *Free Camera* looks round with the mouse and W A S D.
- **Comments.** N (or *Comment*) starts one on the last 3 s; I and O move its start and end to the playhead. Say
  what is wrong, and what it is about: third person, first person or both, this engine or both. Enter saves it, with a
  still of the moment. Comments may overlap (they stack in rows on the timeline). Each keeps the station each of its
  ends fell in and the time into it, so it finds its place on the other view's or engine's run, and after the code
  changes (shown dashed where it is placed that way rather than exactly). In the list: click one to go there, edit its
  text in place, ✓ marks it done, ✕ deletes it.

The top bar's tally (`190/190 Pass`) carries the run's fingerprint on hover: `npm run bench` prints the same one for
the same code, engine and view.

### Comments in the folder

`qa/bench/comments.json` (`qa-bench-comments/1`), with each comment's still beside it (`<id>.jpg`):

- `text`, `view` (`third`, `first` or `both`: what it is about), `engine` (`rapier`, `box3d` or `both`), `done`.
- `made`: `{ engine, view }`, the run it was made on; `f0`, `f1`, `t0`, `t1`: its stretch there (frames from the run's
  start, 120 a second, and seconds).
- `station`, `offset0`: the station its start fell in and the seconds into it; `endStation`, `offset1`: the same for its
  end; `stations`: every station it covers; `stationName`.
- `build`: the commit it was made on; `still`; `created`, `updated`, `id`.

### Rewatching a comment (for agents)

A comment says what the user does not like, at a moment of the benchmark, on a view and an engine. To see it:

- **Headless**: `node tools/bench/run.mjs --comment <id>` plays the whole benchmark on the engine and in the view it
  was made on (`--engine`, `--view` for others) and prints the frames across its stretch (every 6th; `--every n`):
  the station, the runner's state and move, where it is in the station, its speeds, the keys held. `--dump <station
  id>` prints a whole station the same way. Each station starts at its entry, `z` 0, and runs along +z.
- **In the page** (a background tab on the HMR-off server, `npm run dev:nohmr`): `?bench=1&comment=<id>` opens there,
  on its engine and view; or, after `await import( '/qa-console.js' )`:
  - `await benchOpen( { engine, view, comment, station, at } )`
  - `await benchComments()`: every comment, and where it falls on the run on show.
  - `await benchRows( { comment } )` (or `{ from, to }` seconds): the rows across it.
  - `await benchSheet( { comment, count, orbit: { yaw, pitch, dist } } )`: stills across it as one image in
    `qa/review/`, from the run's camera or orbiting the runner.

Then fix it at the right layer (the move, the system, the camera, the course rules; a station's script only when the
script is what is wrong), run the station again (`npm run bench -- <its id> --engine all --view all`), the whole
benchmark (`npm run bench -- --engine all --view all`), and the checks AGENTS.md lists. A fixed comment can be marked
done in the page, or by setting `done` in the file.

## Sharing

**Share** (F in the library, or in the editor) downloads `<id>.qa.zip` and opens a new issue on
[trizen-digital/parkour](https://github.com/trizen-digital/parkour/issues) on the replay form, filled in from the
replay: drop the zip into it. The zip (`qa-share/1`, `src/qa/share.js`) holds `manifest.json` (the id, title, build and
environment), `replay.json`, `course.json` (the course as it was written), `stills/`, `summary.md` (the issue's text)
and, when the build was dirty, `patch.diff` (the working changes since its commit, so it can be run again).

In a clone, `npm run qa:open -- <file>.qa.zip` checks the replay's commit out in `.qa-worktrees/` (not in git),
applies its patch, installs, and runs the replay there and on the code as it is now, headless, printing for each
whether it comes out exactly as recorded or the first frame that differs, with the recording's environment beside this
one. `--serve` then serves the demo at that commit on http://localhost:5414/ with the replay open. A replay that is
exact at its commit and differs now shows what a change did; one that differs even at its commit points at the place
(another browser engine, another processor) or at something not deterministic.

The usual paths:

- **Something went wrong while playing** (on parkour.trizen.dev or anywhere): capture (V), note it, save, Share.
- **A change to a move, checked in the QA player**: share the replay from the branch's pushed commit and attach it to
  the pull request.
- **A replay that should guard a move from now on**: promote it (P in the library) and commit `qa/replays/` and `qa/courses/` with the
  change; `npm test` then runs it. Promoting runs it once headless and keeps how node ran it (`headless`, above).
