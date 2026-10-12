# How the game works

For a developer arriving: what the parts are, the order they run in, and why. Every module has a header comment saying
what it is for; this is the map that puts them together. The code is the truth where the two differ.

The runner itself is the core package, `@trizen/parkour` (`packages/parkour/src/` in the repo); a path written
`@trizen/parkour/…` is a module of it. The physics engines are the backend packages `@trizen/parkour-box3d` and
`@trizen/parkour-rapier`. Everything else here, written `src/…`, `tools/…`, `tests/…`, is the demo
(`packages/parkour-demo/`): the game page, the Y Bot, the courses, QA and the benchmark.

## The parts

```
                 raw device state (keys, mouse, pad), once a frame
                                   │
                                   ▼
   Simulation ── Input ──► ViewControl (the aim) ──┐
   (one run)                                       │ the view's yaw
                                                   ▼
               ┌──────────── 120 Hz steps ─────────────────────────────────┐
               │  Runner ── its systems ── Mover ── Queries ── QueryWorld   │
               │    │  ▲                                (Rapier or box3d)  │
               │    │  │ markers, root motion                              │
               │    ▼  │                                                   │
               │  PoseInputs ──► Motion: moves, pose graph ──► recipe      │
               │                                              │            │
               │                                    Figure ◄──┘ (poses     │
               │                                     │           itself)   │
               │  Ragdoll (DynamicWorld) ◄── the bones, when the runner     │
               │                             bails                         │
               └───────────────────────────────────────────────────────────┘
                                   │
                                   ▼
   FollowCamera (the camera body), Shake, the frame's events
```

- **`Simulation`** (`@trizen/parkour/sim/`) is one run: it owns everything a run is made of and advances it in one fixed order.
- **The runner** (`@trizen/parkour/runner/`) is the body the player moves: its position, velocity, heading, state and capsule, and
  the systems that move it in their own states.
- **The motion system** (`@trizen/parkour/motion/`) gives the runner timing (how long a move lasts, when its markers fire, how far
  it carries the root) and gives the figure a recipe to pose itself from.
- **The figure** (`@trizen/parkour/figure/`) turns the recipe into bones: a `RiggedFigure` (the demo's Y Bot,
  `src/figure/YBotFigure.js`, is one), or a timing-only stand-in with none.
- **The physics** (`@trizen/parkour/physics/`) answers the runner's questions about the world through an engine
  interface with two backends (the backend packages), and simulates the ragdoll.
- **The world** (`@trizen/parkour/world/`) is what the simulation knows of where it runs: a world description, which the
  demo makes from its courses (`src/world/fromCourse.js`) and a game makes from its own world.
- **The camera** (`@trizen/parkour/camera/`) is split in two: the aim the runner steers by, which is part of the simulation, and the
  camera body, which only follows.
- **The input** (`@trizen/parkour/input/`) turns devices into actions; the devices themselves are raw state a replay can stand in
  for.
- **Easy mode's pilot** (`@trizen/parkour/pilot/`) presses keys for the player through that raw state.
- **The touch controls** (`src/touch/`, `src/ui/TouchControls.svelte`) turn thumbs on the screen into that raw state too:
  a pad's stick and the keys a keyboard would press.
- **QA** (`src/qa/`) records the raw input of play so any moment can be replayed exactly; the golden tapes
  (`tests/golden/`) are the same idea, scripted, run headless.
- **The benchmark** (`src/bench/`) is an autopilot playing every move and trick along one course through raw input,
  worked out and keyframed so any moment of it can be shown exactly, with comments pinned to its timeline.
- **The sound** (`src/sound/`) plays what the run does: after each frame it reads the run and never writes to it.

## Units and axes

Metres, seconds and radians everywhere inside the code; Y is up. A heading (`yaw`) of 0 faces +Z: forward is `( sin yaw,
0, cos yaw )` and right is `( −cos yaw, 0, sin yaw )`. Degrees appear only where a person reads them: the settings'
Tuning tab shows angles in degrees, and a data table may write `radians( 65 )`. A rate is per second: a damped value
closes the fraction `1 − e^(−rate·dt)` of its gap in `dt`, so it moves the same way at any frame rate.

## The frame and the fixed step

The page calls `Simulation.frame( dt, beforeSample )` once per rendered frame (`src/main.js` through
`src/app/Player.js`). The simulation steps at a fixed 1/120 s however long the frame was, so the same input makes the
same run at 30, 60 or 144 frames a second; the frame's length only decides how many steps run.

One frame, in order (`Simulation.frame`):

1. The frame counts as at most 0.05 s, so a stall (a background tab, a breakpoint) goes on from where it was instead of
   leaping ahead.
2. `beforeSample` puts the frame's raw device state into the input: a replay's recorded frame, the pilot's keys.
3. `input.sample( dt )` reads the devices once and evaluates every action: what is held, what was pressed or released
   since the last frame, the move and the look.
4. The simulation's own keys act once, before any step: pause, set a mark, back to the mark; then the page's keys
   (`onKeys`: the UI, Easy mode, QA). Their presses are taken off, so the runner never sees them.
5. `view.look( input, runner )` turns the aim by the frame's look. Every step of the frame steers by that one aim.
6. The frame's time goes into an accumulator (scaled by slow motion, which eases the run from full speed down to the
   tuning's slow-motion scale and back up over its slow-motion ease, 0.15 s of the frame's own time, along a
   smoothstep; not at all while paused), and steps run while a whole step's worth is there, at most eight (the longest
   frame needs six; past that the backlog is dropped rather than caught up in a burst). Each step is the runner's
   (below), or the ragdoll's while it has the body, and the figure keeps the pose it left (`figure.keepStep`). After
   each step `onStep` runs (the traces) and the input's presses are cleared: a press counts in the first step of its
   frame only.
7. The runner is drawn between its last two steps, by the time left in the accumulator, so motion is smooth at any frame
   rate.
8. The figure is drawn between its last two steps too (`figure.drawBetween`): in slow motion a step lasts several
   frames. The next frame puts the last step's pose back first (`figure.showStep`), so the steps and the ragdoll only
   ever read a step's pose.
9. `view.update()` follows up on what the runner did (the trick first-person rule, recentring, the aim's camera events,
   turning toward a sideways run, lining up with a wall run), then `followCamera.update()` places the camera (in first
   person on the head as drawn).
10. The frame's events are kept as `frameEvents` and cleared.

One step with the runner on its feet (`Simulation.stepRunner`):

```js
runner.step( STEP, input, this.view.yaw );            // the runner and its systems move the body
poseInputs.update( STEP, input );                       // what the pose graph reads of the runner
const recipe = this.motion.update( STEP, poseInputs );  // the moves, then the pose graph, then their markers
this.figure.step( STEP, recipe, runner.position, runner.yaw, pose );
if ( runner.state === 'bailing' ) { /* the ragdoll takes the body, the limp controls take over */ }
```

The order is what makes the timing work:

- The motion runs after the runner, so **markers fired in step n reach the runner at the start of step n + 1**
  (`MarkerResponses` drains them first thing in `Runner.step`).
- **Root motion is taken before the motion advances.** When a move carries the root, the runner asks
  `motion.rootMotion( dt )` for the travel over the next `dt` of the move from where it is now, moves the body by it,
  and then `motion.update()` advances the move by that same `dt`. The body moves by exactly what the move plays.
- The pose inputs are gathered after the runner's step, so the graph sees the runner as it now stands.

One step while the ragdoll has the body (`Simulation.stepRagdoll`): the runner's time moves on, the ragdoll steps, and
the runner follows the body (half its height above the hips, the hips' velocity, the heading the body lies along), so
the camera, the traces and the get-up all work from where the body is. When the player stands up (`Bail.getUp`) the
ragdoll stops and the motion has the body again.

## What may change a run

A run is deterministic: the same course, settings, physics engine and raw device input give the same steps, to the bit.
That is what the golden traces check, what lets a QA replay run again exactly, and what lets Easy mode's pilot look
ahead by running the game. Only two things may change a run:

- **Raw device input**, frame by frame: the keys and mouse buttons held, the mouse's movement, the keys pressed or
  released between frames (a tap shorter than a frame still counts), the pad's buttons and axes, whether the pointer is
  captured and whether a text field has the keyboard (`@trizen/parkour/input/deviceState.js`). Easy mode's pilot presses keys
  through this too.
- **Changes made between frames**: a respawn, the input cleared (the window lost focus), a tuning value or a preference
  (from the settings' *Tuning* and *Controls* tabs), the camera's aspect. The QA recorder writes each one onto its tape
  as an event at the next frame.

Everything else that could vary is pinned:

- **No `Math.random` in the runtime.** The run's only chance (which dash vault, the idle shuffle, where a camera shake
  starts) draws from seeded streams (`@trizen/parkour/sim/random.js`: `vaultChoice`, `idleChoice`, `shakePhase`), each with its own
  state so a draw from one never moves another. A respawn resets them all.
- **The physics engine is part of a run.** The two engines find contacts each their own way, so the same input on the
  other engine makes another run: a simulation is built on one engine, a replay records it, and each engine has its own
  golden traces.

### Respawn and snapshots

A respawn is the only way a run starts again. `Simulation.load()` ends by taking a snapshot of the run as loaded;
`respawn( start )` restores it, all but the page (the devices and their listeners, the pointer capture, the player's
preferences, the window's aspect), then puts the runner at the start, resets the view, the camera, the motion and the
random streams. So a tape that begins at a respawn replays on a freshly loaded simulation.

A snapshot (`@trizen/parkour/sim/snapshot.js`) walks the run's objects from its roots (the runner, the pose inputs, the motion, the
view, the follow camera, the input, the random streams, the ragdoll, the figure, the queries, the mover) and keeps a
copy of every object, array, map, set and typed array it meets; a restore writes each copy back into its own original,
so every reference between the run's objects still holds. It skips what no run changes: objects `load()` marks static
(the course and its engine, the tuning, the action table, the take tables, the figure's clips, the page), three.js scene
objects (it keeps the figure's and the camera's transforms itself), frozen tables and engine handles. A snapshot taken
while the ragdoll has the body cannot be restored: the bodies live in the engine, where no snapshot looks.
`npm run snapshots` checks that a restore puts every golden tape's run back exactly.

`setMark()` and `backToMark()` are not snapshots: they put the runner back on a place and heading and the run goes on.

## The runner

`Runner` (`@trizen/parkour/runner/Runner.js`) owns the body: position, previous position (for drawing between steps), velocity,
heading, whether it stands on something, its capsule, and its state. It reads timing, root motion and markers from the
motion system, and never a pose.

### States

One state at a time, set by `runner.setState()` (which pushes a `{ from, to }` event):

| State | The runner is | Moved by |
| --- | --- | --- |
| `standing`, `walking`, `sprinting` | on the ground, still, at walking pace or sprinting | its own movement |
| `rising`, `falling` | in the air, going up, or otherwise | its own movement |
| `aiming` | crouched, charging a precision jump | Precision |
| `precisionJump` | in a precision jump's flight | a stunt |
| `striding` | carried onto a precision target by a stride | a stunt |
| `groundStunt`, `airStunt` | committed to a move on the ground or in the air (tricks, the perch landing, the dive out; kicking a door, turning a valve, pressing a button) | a stunt |
| `rolling` | in a landing roll, a dive roll or a hard landing | a stunt |
| `sliding` | in a slide | Slides |
| `bailing` | limp: the ragdoll has the body | the ragdoll |
| `vaulting`, `climbingUp`, `catchingLedge`, `hanging`, `leapingToLedge` | over an obstacle (or the power jump off one), climbing onto a top, pulled onto a ledge, hanging, leaping from one ledge to another | Ledges |
| `wallRunning`, `wallPlanted`, `wallKicking` | running along a wall, planted against one met head-on, kicking back off it | Walls |
| `onPole`, `onBar`, `onRope` | on a vertical pole, swinging on a bar, swinging on a rope | PolesAndBars |
| `onPipe`, `onLadder`, `toppingOut`, `onZipline` | on a drainpipe, on a ladder, climbing over the top of either, riding a zipline | PipesAndZiplines |

`movementMode( runner )` (`states.js`) says how the body moves, for the trace and the camera: `ground` on a walkable
floor, `air` under gravity, `guided` when held to something or carried by a placement, a move or the bail. A ledge
placement says its own mode (a hop onto a wall walks once on top; a vault flies). The traces write `ragdoll` while the
ragdoll has the body.

### The systems

Each traversal system owns its state, its timers and the moves it plays:

| System | What it does |
| --- | --- |
| `Ledges` (with `Probes`) | vaults over low obstacles, hops onto walls, the power jump off an obstacle, catching a ledge in the air or by running up the wall below it, hanging, shimmying, leaping to another ledge or round a corner, climbing up, letting go. `Probes` are its eyes: columns of spheres swept ahead to find walls and the tops above them |
| `Walls` | the wall run, jumping, turning or diving off it, planting against a wall met head-on in the air, kicking off a wall ahead |
| `PolesAndBars` | catching a pole, sliding down and round it, letting go or kicking off; swinging on a bar met in the air; catching a hanging rope in the air from any direction and swinging on it as a pendulum from its anchor (under 0.6 of the runner's gravity), the stick pumping the swing or steering it round, until jump leaps off or grab lets go |
| `PipesAndZiplines` (with `RouteVolumes`) | climbing and sliding drainpipes, jumping off, climbing over the top; the same on ladders (hand over hand up, sliding down on the rails, out between the rails at the top onto a floor there, or holding on at the top rung where there is none); riding ziplines (caught where the runner meets the cable, keeping its speed along it), letting go. The catch volumes say which pipe, ladder or zipline the runner is at: a volume the runner is in looks where along its route the runner is every 50 ms, each look holding back the next with a hold of its own on the runner's clock |
| `DoorsAndSwitches` | doors and the valves and buttons by them. A shut door stands in its doorway for the leaf the world leaves out: run at it at 2.5 m/s or more and the shoulder barge bursts it open and the runner goes on through; Interact (the precision button) kicks it open from a walk; anything else is held back by it. Interact turns a valve or presses a button (side-on, facing along the wall the way nearer the runner's heading, with the hand on the button's side), and either opens the shut doors within 4 m; in first person the view turns down to it while it is worked. An open door swings shut 4 s after, once the runner is clear. The page draws the leaves, wheels and buttons from this state |
| `Tricks`, `TrickGesture` | the ground and air tricks, picked by the trick buttons and the direction the player points |
| `Slides` | the slide: low and fast, steered, pushed and turned down slopes (keeping its heading on a level floor), tilted to the floor |
| `Precision` | the precision crouch and jump, strides onto targets, balancing on a perch, the standing back flip, and the precision and roll windows the next landing reads |
| `Landings` | touchdown, and the landing judged a step later: a slide, a roll, a precision landing, a hard landing, a bail, or nothing more |
| `SkidStops` | the skid when the stick is let go at running speed |
| `Bail` | going limp and getting up. The player asks for it (going limp: it waits 0.205 s and hops the runner off the ground into a dive, and is refused while climbing, hanging or on a zipline), or the game does, which goes limp in 0.05 s: a fatal fall, a botched landing (too fast, inside a trick), a stumble into an obstacle too close to vault, a ledge or a bar caught too fast |
| `Capsule` | the capsule's height: it shrinks for a flip and a slide and grows back |
| `MarkerResponses` | what the markers do (which foot leads, the parts of a roll or trick the body is committed to, the air combo opening, the capsule) |

### The step

`Runner.step( dt, input, viewYaw )` runs once per fixed step:

1. The markers the motion fired at the end of the last step act, then the clock moves on by this step and fires every
   timer that has come due. A bail that came due has handed the body over: nothing else acts.
2. The systems' watches, in the order they act: pipes and ziplines, ledges, poles and bars, precision, doors and
   switches (a door shutting behind, the body set where it works a door or a switch, the shoulder turning in). Then
   sprint (held, it sprints; let go on the ground, it lapses at the next 0.2 s check), the fatal-fall check (every
   0.1 s), the capsule, the skid, the walls.
3. The toggles: first person, slow motion; the tricks' own bookkeeping; going limp.
4. Grab held on the ground with a trick button pressed tries a vault or a hop.
5. Out of the course (below a height of −30 m, or a position that is not finite): back to the first spawn.
6. In a traversal system's state, that system moves the runner. Otherwise the free step tries, in order: a wall kick,
   the power jump's approach, a jump, the stunt playing, Interact at a door or a switch, the precision crouch and
   strides, a slide, a trick, and with grab held a pipe, ladder, zipline, pole, rope, bar, ledge or wall run; and else
   the runner's own movement.
7. Once the body has moved, a shut door it ran into is barged open or holds it back.

The runner's own movement (`Runner.move`) steers the heading toward the stick (relative to the view) at the tuning's
ground or air turn rate, accelerates along the heading (strafing in first person), caps the speed at the pace's top
speed (`walk` or `sprint`), brakes without input, and adds gravity in the air. The step in the air covers the
average of the vertical speeds at its two ends. The mover then moves the capsule through the course. A move that carries
the root takes over the velocity instead (`applyRootMotion`).

A **stunt** (`startStunt( name, options )`) is a move the runner commits to for its length (a trick, a roll, a precision
jump, a stride): while it plays it owns the velocity, moving the body by the move's root motion if its take has one. It
can fly (`air`: gravity applies once it has launched, and a landing ends it), launch after a delay, be placed onto a
target over a time, pass through solids (`ghost`), and call back when done. A stunt that flies or is placed is
committed: no plain jump cuts it short, also while it waits to launch (a precision jump's delay).

### The clock

Everything the runner and its systems time is on one clock (`Clock.js`), whose time is the runner's (seconds since the
respawn). It keeps three kinds of thing by name:

- **timers** (`after( seconds, name, callback )`): a callback some seconds from now, fired by `run()` at the start of
  the runner's step, earliest first (in the order they were set when due together);
- **holds** (`hold( name, seconds )`, `held( name )`): a lock, a cooldown or a window, held until a time;
- **periods** (`every( name, interval )`): a check on a beat, asked each step how many beats have come.

A name is one thing at a time: setting it again replaces it. Each system names its own and cancels them when it resets
(the catch volumes hold one each); a teleport clears them all. A time within 1e-8 s of now counts as now, because step
times are sums of 1/120 in floating point. Only `run()` fires timers, once a step; while the ragdoll has the body the
runner's step does not run, so its timers wait, but its holds still read right as the time moves on (that is how the
get-up's locks work).

### Events

During its steps the runner pushes what the frame should hear about into `runner.events`: state changes `{ from, to }`,
camera events `{ type: 'camera', name, … }` (a shake preset, or one of the aim's or the camera's own: `faceView`,
`recenterView`, `aimZoomIn`, `viewOnHead`, `viewFree`…). The frame hands them to the view and the camera, keeps them
as `frameEvents` (the trace's `events` column), and clears them.

## The motion system

`Motion` (`@trizen/parkour/motion/Motion.js`) is what the runner gets from the takes, and the recipe the figure is drawn from. Each
step, after the runner's step, it advances the one-shot moves, updates the pose graph from the pose inputs, and gathers
the markers both crossed, in that order. The runner uses:

```js
motion.moves.play( name, { rate } )      // a one-shot move; whatever plays blends out as it blends in
motion.moves.stop( name, blendOut )      // a move by name, or every move
motion.moves.retime( name, { time, rate } ) // a move playing moved on to a time, or set to a rate (a stride
                                         // picking up the step the last one got to)
motion.moves.playing() / busy()          // the move playing (not blending out), and whether there is one
motion.takeMarkers()                     // the markers fired since the runner last asked, by name, in order
motion.rootMotion( dt )                  // the root's travel over the next dt of the move playing, or null
motion.moveDelta( name, from, to )       // the root's travel through a move between two of its times
motion.length( name ), hasRootMotion( name )
```

Nothing in `@trizen/parkour/motion/` reads a bone.

### Takes and moves

A **take** is a stretch of motion with a length in seconds, always played at rate 1. A **move** plays a span of one take
once, into a layer of the pose graph, at its own rate, blending in and out. Both are in `public/data/moves.json`, built
by the move builder ([MOVES.md](MOVES.md)); `TakeLibrary` loads them. A take's entry carries what the game reads of it:
its markers, its root track (when the runner follows its root), the take it is added over (an additive take), how its
root bone is held, and its pace.

`Moves` plays the one-shot moves. One move plays at a time: a new one blends in over its own blend-in as every move
playing blends out over that same time. A move blends itself out as it nears its end (one with `holdAtEnd` waits on its
last pose until stopped) and fires its take's markers as it crosses them, at its weight. It plays into one of four
layers of the graph: `body`, `landing` (the additive landing dip), `climb` and `ledgeLeap` (over the hang).

### The pose graph

The pose graph (`@trizen/parkour/motion/graph/`) is a tree of node objects built in code (`Graph.js`), updated once a step. Each
node keeps its own times and returns a **recipe**: a small tree of plain objects saying which takes to sample at which
times and how to put them together (`recipes.js`):

```
{ kind: 'rest' }                                       the standing pose
{ kind: 'clip', take, time, from, to, loop, player }   a take at a time; this step its clock went from `from` to `to`
{ kind: 'mix', a, b, weight }                          two poses, b's share `weight`
{ kind: 'blend', samples, markers }                    poses by weight (`markers: 'heaviest'`: one set of footfalls)
{ kind: 'add', base, add, weight }                     an additive take's difference laid on a base
{ kind: 'legIK', source, foot, target, knee, weight }  a leg reaching for a point in the world
{ kind: 'feet', source, weight }                       the feet put down on the ground under them
```

The node classes:

| Node | What it does |
| --- | --- |
| `ClipPlayer( take, { loop } )` | plays a take from its start at its own speed, once (holding the last pose) or round and round |
| `IdleShuffle( takes, { fade } )` | standing about: the takes one after another in a shuffled order from the graph's random stream, never the same twice in a row, cross-fading |
| `DirectionalBlend( blend, input, library )` | takes placed on one or two axes (`blends.js`), mixed by where an input falls among them (the run leaning by turn rate and speed, the hang looking where the stick points, the body's lean). The weights ease toward their targets; the takes share one phase, which goes round in the weighted mean of their cycles. On a blend's speed axis a take with a `stride` goes round in the time its stride takes at its sample's speed (it plays at `speed × length / stride`, worked out from the library when the graph is built), so the feet keep in step with the ground; the blend's own cycle, by which a state hands over, is the length of the take it names |
| `Switch( test, { on, off }, whenTrue, whenFalse )` | one of two branches by a yes-or-no question about the runner, blending to the other over a set time when the answer changes |
| `StateMachine( name, states, initial )` | states with transitions between them, cross-fading (below) |
| `Layer( name, source )` | where one-shot moves show: the moves playing into that layer laid over the source |
| `Additive( base, add, { weight, toggle } )` | an additive pose over a base: the charging crouch, the lean, the landing dip |
| `LegIK( source, leg )` | a leg reaching for a world point (the feet against the wall while hanging) |
| `FootIK( source, { weight } )` | the feet put on the ground while the runner stands |

The whole graph, from the top:

```
FootIK (the feet on the ground, by groundIK)
└─ Switch: not limp (back at once; into the limp pose over 0.35 s)
   ├─ Switch: sliding ─────────────── slide machine
   │  └─ Switch: hanging ──────────── LegIK ← LegIK ← Layer ledgeLeap ← Layer climb ← hang machine
   │     └─ Switch: on a pipe ─────── Layer body ← pipe machine
   │        └─ Switch: on a ladder ── Layer body ← ladder machine
   │           └─ Switch: on a pole ──── pole machine
   │              └─ Switch: on a rope ──── rope machine (the figure tilted along the rope)
   │                 └─ Switch: on a zipline ─ zipline machine
   │                    └─ on foot: Additive landing dip ← Additive lean ← Additive charging crouch ← Layer body ← locomotion machine
   └─ limp: Switch by speed: air_flail ⟳ or air_tumble ⟳
```

A switch shows the branch on its own line when its answer is yes, and the one drawn under it when no.

A switch updates a branch only while it shows, and a state machine not updated in the update before starts again at its
initial state. So a switch is also a gate, and **its blend times are timing as much as looks**: they decide when a
machine restarts, which decides when its clips' markers fire. The same holds for a move covering the `body` layer fully:
the machine under it stops being updated and starts again when the move blends out.

### State machines

The eight machines (`graph/machines/`) are `locomotion` (standing about, walking (along a beam, with the arms out),
running, taking off, landing, readying to push off a wall the flight is about to meet, bumping into it), `hang`, `pipe`, `ladder` (getting on, holding on, climbing, sliding down the rails),
`pole`, `rope` (the catch, then the swing: a pose with the legs thrown forward and one with them trailing, mixed by
which way the body swings), `zipline` and `slide`. Each is written as states and their transitions:

```js
const machine = new StateMachine( 'pipe', {
	grab: new ClipPlayer( 'pipe_grab' ),
	hold: new ClipPlayer( 'pipe_hold', { loop: true } ),
	climb: new ClipPlayer( 'pipe_climb_up', { loop: true } ),
	slideDown: new ClipPlayer( 'pipe_slide_down', { loop: true } ),
	slideStop: new ClipPlayer( 'pipe_slide_halt' ),
	climbStop: new ClipPlayer( 'pipe_climb_halt' ),
}, 'grab' );

const up = ( v ) => v.pipeGoing === 'up', down = ( v ) => v.pipeGoing === 'down';

machine.from( 'grab' ).to( 'climb', 0.2, up ).toWhenDone( 'hold', 0.2 );
machine.from( 'hold' ).to( 'slideDown', 0.25, down ).to( 'climb', 0.25, up );
machine.from( 'climb' ).to( 'climbStop', 0.25, ( v ) => ! up( v ) );
```

`to( target, crossfade, test )` is taken when the test holds on the pose inputs; `toWhenDone( target, crossfade )` when
the state's main clip has no more than `crossfade` seconds left. The rules (`StateMachine.js`):

- A machine that was not updated in the update before starts again at its initial state, which holds for that first
  update.
- Each update tries the current state's transitions in the order they were added and takes the first that holds; then
  those of the state it reached, up to three in all.
- "When done" is judged on the update before, by the state's main clip: of the state's players, the one with most weight
  in its recipe. Time left is measured on the clock the take was captured at (a take's `pace` says how much the build
  sped it up), so a hand-over comes at the same point of the motion whatever the pace. The cross-fade then starts
  already as far in as the clip has gone past that point, so it ends as the clip does.
- Entering a state starts its pose again, unless it is the current state or still shows in the cross-fade being left.
- Cross-fades follow a smoothstep. A transition taken during a cross-fade fades from that cross-fade as it stands, which
  goes on underneath.
- A transition may carry `onStart( graph )`: landing at a run plays the `landingDip` move.

### Markers

Markers are named instants on a take (`markers.js`): `leftFoot` and `rightFoot` (which foot leads, for the takeoff
pose), `rollStart` / `rollEnd` and `trickStart` / `trickEnd` (the part of a roll or trick the body is committed to),
`airComboOpen` (an air trick may follow), `capsuleShrink` and
`capsuleRestore` (a flip tucks the capsule). A move's markers fire as the move crosses them; the graph's clips fire
theirs at their share of the whole pose, a blend passing on only its heaviest sample's (one set of footfalls), and a
take blended in with less than a hundred-thousandth of the pose fires none. The runner reacts a step later.

A take's sound cues (`sounds`: `step`, a foot on the ground or a wall; `rung`, a hand or foot on a rung or along a
ledge) fire the same way, but the motion keeps them apart (`motion.sounds`, gathered over a frame's steps into the
simulation's `frameSounds`): the runner never hears them and neither the traces nor the replays record them, so cues
can be added or moved without changing a run.

### Root motion

While a move whose take has a root track plays, the runner moves by the take's root instead of by its own velocity
(`RootMotion.js`). Only the move playing counts, not one blending out. Root tracks are positions in metres in the take's
own frame (+Z forward from where it starts), turned to the runner's heading and scaled by the tuning's root motion
scale; takes carry no root turn. On the ground the vertical part is dropped; in the air gravity takes it; in a guided
move the root alone moves the body.

### Pose inputs

`PoseInputs` (`@trizen/parkour/runner/PoseInputs.js`) is what the graph reads of the runner, gathered once a step after the runner's
own step: its situation as flags (in the air, sliding, hanging, on a pipe or a ladder going up or down, on a rope and
which way it swings, on a beam, a wall coming up in the air…), how it moves (speed, turn rate, lean), the stick while
hanging, and, for the pose alone, the body's tilt (with the slide, or along a rope), where the feet go against a wall,
how much the feet are put on the ground, what the hands hold (the `grip`: a bar's, pole's, pipe's or cable's line, a
valve's rim, a button, a vaulted top, eased in and out), whether the body stands on the ground and whether the hands are
on a ledge. The graph never reads the runner directly.

### Why the simulation never reads a pose

The simulation runs the motion system every step, because its timing is part of the game: how long a move lasts, when
its markers fire, how far it carries the root, when a machine restarts. What never flows back into a step is a pose: no
bone, no sampled clip. The figure poses itself from the recipe; the runner reads only the take tables.

That rule is what lets the headless checks, the golden tapes and Easy mode's look-ahead run with the timing-only figure
(no skeleton, no clips) and get exactly the run the Y Bot would. Two things do read a body, and only they may: the
ragdoll, which starts from the bones as the figure has them posed, and the first-person camera, which rides the head.
`npm run purity` runs every golden tape with the stand-in and checks the trace is the Y Bot's except where one of those
two is involved.

## The figure

A figure is placed and posed once a step (`figure.step( dt, recipe, position, yaw, pose )`):

- **`Figure`** (`@trizen/parkour/figure/Figure.js`) is the timing-only stand-in: a root that follows the runner (the capsule's
  centre, heading and slide tilt) and a body below it where the feet meet the floor. It has no skeleton and loads
  nothing.
- **`RiggedFigure`** (`@trizen/parkour/figure/RiggedFigure.js`; the demo's `YBotFigure` gives it the Y Bot's rig
  description, `src/data/ybot.json`, and ragdoll) loads the model and every take's clip, gives the skeleton a root bone above the hips (the takes' root
  travel lives there), splits the head's triangles into meshes of their own (hidden in first person), and each step
  poses its bones from the recipe, then corrects the pose: the body out of the course (`BodyClearance`), the hands onto
  what they hold (`HandGrips`), then the limbs and the head out of what they are still in. It tells the first-person
  camera where its eyes are.
- **`PoseSampler`** evaluates a recipe into a pose (one transform per bone, in its parent's space), each recipe node
  once per step: it samples clips, mixes and blends rotations by sign-aligned normalised sums, lays additive takes over
  their base take's first frame, and hands `legIK` and `feet` to the solvers. A take playing as a move with root motion
  keeps its root bone still, since the runner moves the body instead; a `pinned` take always does.
- **`FootPlacement`** puts the feet on the ground while the runner stands: a ball swept down past each animated foot
  finds the ground under it; the pelvis eases toward the lower foot's ground (slowly, so a step down does not jolt the
  body) and each foot toward its own (quickly); the hips drop further if a leg cannot reach; each foot lies on ground
  flat enough to stand on. It also carries the body over the stairs, walking or not: the mover lifts the capsule onto
  a stair (or drops it to the one below) within one step, so that jolt goes into a trail that keeps the hips where
  they were and eases out as the runner goes on (1 m of height per metre) or over time (8/s), and a flight is climbed
  as a ramp. The eased heights and the trail are part of the run's state.
- **`LegSolver`** is the analytic two-bone leg: the knee goes where the thigh and shin lengths meet, on the side of a
  hint; bone lengths never change, so a target out of reach leaves the leg straight and pointing at it. It bends the
  arms too (shoulder, elbow, wrist).
- **`HandGrips`** puts the hands on what the pose inputs' grip says they hold: a line (a bar, a pole, a pipe, a cable:
  the fist closed round it, a shoulder's width apart across the body), a valve's rim, a button (the knuckles of the hand
  that presses it), or the top of what is vaulted (the palm planted where it comes down, until the take lifts it). A
  hand goes to its hold as the take brings it near, or at once for a firm grip (a pole, a pipe, a cable, a bar once
  hung from, a valve), the elbow kept out from the body, the wrist eased straight, the fingers curled; each hand's
  weight eases in and out. The plants and the weights are part of the run's state.
- **`BodyClearance`** keeps the body out of the course, a light correction the takes never see. Capsules along the
  trunk, thighs, shins and forearms and a ball for the head ask the engine how far each is inside a solid: the trunk
  and legs move the whole body out (straight up over a vaulted top), a limb that goes into a solid from the body's side
  swings out to that side by the face a ray down it meets, keeping its reach, and the head leans the neck away (ducking
  under a bar). Nothing is lifted off the ground the body stands on, and hands on a ledge are left to it. Each push
  eases in quickly and out gently and is capped; the pushes are part of the run's state. A move with a `mask` shows on
  the upper body only (`PoseSampler.masked`, the spine and everything above it).

## Physics

### The engine interface

`@trizen/parkour/physics/engine.js` is the physics as the game sees it. A backend package answers for one engine
(`@trizen/parkour-box3d`, `@trizen/parkour-rapier`); a Simulation is given one (`engine: box3d`), loads it when the run
loads, and records its name. The demo looks them up by name in `src/engines.js`, Box3D first (its default):

- a **`QueryWorld`** of static solids that answers questions and never changes: `cast( shape, from, to )` (the first
  solid a sphere, capsule or box meets moving without turning; `stopAtPenetration` says whether a solid it starts in is
  met at once, for probes, or passed over while the motion takes it out, for movement), `overlap()`, `penetration()`
  (the deepest contact of a shape placed at a point) and `ray()` (a solid ray: one that starts inside a solid hits it at
  0);
- a **`DynamicWorld`** that simulates bodies among static solids (the ragdoll's): `addBody()` from shapes with
  densities, `addJoint()` (ball or hinge, with optional hinge limits), `disableCollision()`, `step()`, and `fresh()`,
  back to the world as made;
- **`Body`** facades: position, rotation, velocities, mass, the world inverse inertia, impulses.

The game holds only solids, hits and bodies, never an engine's own objects, and each engine's conventions (how close a
cast stops, what counts as starting in contact, how filters and object lifetimes work) stay inside its backend.
`tests/engine.test.mjs` checks the contract on each engine against answers worked out by hand, and the two engines
against each other over a course.

**Solids** (`@trizen/parkour/world/solids.js`) are plain descriptions: a box, or a convex hull of points that also keeps its own
faces. Each blocks a set of **collision groups**, one bit each, so the engines filter in their broad phase: `movement`
(the runner's capsule), `probe` (what the runner looks for), `camera` (the first-person camera's sphere) and `ragdoll`
(the ragdoll's bodies). Every course solid blocks all four. `Queries` (`@trizen/parkour/physics/Queries.js`) asks the query world by
group name and adds what the runner needs to a hit: where the shape's centre was, how far it went, whether it started
inside (more than 0.1 mm in: a capsule resting on a floor only touches it), and the **face normal** of the face it met,
worked out from the solid's own faces, so it is the same on every engine.

### The two backends

**Rapier** (`@trizen/parkour-rapier`) keeps the contract as it is: a cast is Rapier's shape cast, a ray is
solid, a penetration is the deepest of Rapier's contacts at no prediction distance, and groups are Rapier's interaction
groups. A query world steps once after it is built so its broad phase sees the colliders. The dynamic world takes a
Rapier snapshot as made and restores it for `fresh()`; pairs that never touch go through Rapier's contact filter hook; a
hinge turns about its frames' X axis.

**box3d** (`@trizen/parkour-box3d`, the demo's default) answers by its own conventions, which the backend turns into the contract's:

- a shape cast stops 5 mm short of touching, so a sphere or capsule is cast grown by that slop and a box is cast as it
  is and moved on until it touches;
- a cast that starts within a quarter of the slop of a solid, or inside it, meets it at once with no normal: the contact
  where the shape starts says whether it is inside and which way is out, and a shape clear of the solid is cast at it
  again from further back;
- there is no penetration query: the mover's contact planes give a sphere's or capsule's depth, and the contact manifold
  the solver would use gives the rest;
- two solids met at the same point of a cast come in either order; the one whose face is most against the motion is
  reported;
- an overlap counts a gap under half a millimetre, so the shape is shrunk by that much first;
- contacts take the geometric mean of two frictions and the larger restitution where the contract takes the mean of
  each, so the static solids are given the values that make their contacts with the bodies come out so;
- box3d's joints and contacts are springs: the backend asks for joints as stiff as box3d makes them, so a limb does not
  come centimetres off its joint in a fall, and makes the ragdoll world's contacts 20 Hz stiff, so a fallen body comes
  to rest as it does on Rapier;
- a world cannot be put back as it was, so `fresh()` builds it again, on an idle frame when the page has one; one module
  holds at most 128 worlds, which is why a simulation's `dispose()` frees its worlds.

Choose the engine with `?engine=rapier` (or `box3d`) or *Settings › Debug › Physics*; headless tools take
`--engine box3d`.

### The world from the course

`World` (`@trizen/parkour/world/World.js`) is the simulation's view of a world, made from a world description: plain data
any game can make (AGENTS.md, Adapting a world), which `World` checks as it takes it. The demo makes one from a `Course`
with its adapter, `src/world/fromCourse.js`: the
spawns (the course's, then each lane's start, as capsule centres), the solids (boxes; wedges, cylinders, pipes, tubes
and cables as hulls), the poles (thin, tall cylinders), the pipes, the ladders, the ropes, the ziplines, the doors (each
its doorway) and the valves and buttons. Solids are added piece by piece in the course's order, because the engines'
answers depend on the order solids are added. `build( engine )` puts the solids into one query world and the **catch
volumes** (where the runner can take hold of a pipe, a zipline or a ladder) into a second, so the runner's probes never
see them. Nothing in a world changes during a run, which is why a snapshot can skip it. That is why a door's leaf is no
solid: whether a door stands open is the runner's (`DoorsAndSwitches`), which holds the body back at a shut one, and the
page (`src/app/CourseParts.js`) swings the leaves, turns the valves' wheels, pushes the buttons and swings the ropes as
the run has them.

### The mover

`Mover` (`@trizen/parkour/physics/Mover.js`) moves the runner's capsule (0.185 m radius, 1.8 m tall standing) through the course,
asking the queries in the movement group:

- `walk()` moves it on its feet or through the air: along the floor's slope when it starts on one, sliding along what it
  meets (along the crease in a corner), stepping up onto what is low enough when it started on the floor (carried at
  least 2 cm across onto it, so a slow walk, or a step that ends at the riser, still steps up), treating a
  slope too steep to walk as a wall, then onto the floor below if there is one. The velocity loses what goes into the
  surfaces met.
- `glide()` moves it with no gravity and no floor to keep to (a guided move: a climb, a wall run), sliding along what it
  meets and stepping up onto a low wall in its way.
- `findFloor()` finds the walkable floor under the capsule by sweeping a box down inside it, with a ray straight down as
  a fallback.
- `resolvePenetration()` pushes the capsule out of anything it is inside.

The capsule floats 2.15 cm above the floor and is put back there whenever it drifts out of 1.9 to 2.4 cm, so a runner on
the ground stays on the ground without touching it.

### The ragdoll

When the runner bails, `Ragdoll` (`@trizen/parkour/physics/Ragdoll.js`) turns the figure's bones into bodies joined at the joints,
as the Y Bot's ragdoll description says (`src/data/ybot-ragdoll.json`: 19 bodies of capsules and boxes, each with its
mass, 83.7 kg in all; 18 joints; and one spine bone placed between two bodies), each starting where the figure has it
posed and moving at the runner's velocity, in a dynamic world of the course's solids. A body's mass, times the tuning's
mass scale, is spread evenly through its shapes: the engine is given the density that makes it so. A joint with one axis free is the engine's hinge about it, limited
by the engine; with more, a ball joint.

How far each joint twists and bends, how hard it resists going further, and the pull towards a pose that keeps a falling
body from going slack are ours (`jointLimits.js`): springs on the joint's angles (a twist about the bone and two bends,
the bends sharing an elliptical cone), solved for the step from the two bodies' inertia and applied as equal and
opposite angular impulses before each world step. They read only what every engine's `Body` gives, so a ragdoll holds
together the same way on either engine. The pose motor's stiffness rises with the hips' speed, so a tumble keeps the
body's shape and a body coming to rest lies loose.

While limp, holding a direction pushes the hips along it (turned by the view) and lifts them, so a player can roll the
body or drag it off a ledge. The player stands the runner up (Space) once the body is nearly still, on the floor found
under it.

The dynamic world is made once with the course and is as made whenever no ragdoll is active: `stop()` takes the bodies
out and calls `fresh()`, because what a world does next depends on everything that happened in it before. So the same
pose thrown the same way always falls the same way, and no snapshot ever holds engine state.

## The camera

The camera is two objects with different rules:

- **`ViewControl`** (`@trizen/parkour/camera/ViewControl.js`) is the aim: a yaw and a pitch. The runner steers by its yaw, so it is
  part of the simulation and keeps its arithmetic exactly. Before the steps it takes the look input (in the air the
  mouse draws trick gestures and turns the view only with free look held; the pitch reaches 30° up and 40° down, 85°
  down while limp) and the field of view setting (written through the tuning, so it is kept). After them it follows what
  the runner did, in this order: the trick first-person rule (checked every 0.1 s; the only place the camera writes into
  the runner, setting `firstPerson`), recentring on entering first person, the aim's camera events, turning toward a
  sideways run, and lining up with a wall run.
- **`FollowCamera`** (`@trizen/parkour/camera/FollowCamera.js`) is the camera body: where the camera sits and where it looks, placed
  once a frame after the steps. In third person a follow point trails the drawn runner (quickly across, more slowly up
  and down so a jump does not jolt the view) and an arm's root trails the follow point, so the camera starts and stops
  along an S rather than a kink; the camera turns toward the aim and hangs back along it over the shoulder. Three eases
  reframe it: the speed zoom (sprinting, sliding, on a zipline or falling fast: the arm draws in and the view widens),
  the aim zoom (a precision crouch: over the shoulder and forward) and the fall tilt (looking further down). In first
  person it sits at the Y Bot's eyes, turning toward the aim, or with the head through a trick, kept out of walls by a
  sphere cast in the camera group. It hands three.js the vertical field of view worked out from the horizontal setting,
  so the view keeps its width on any window. Nothing in the simulation reads it; the third-person camera never collides.
- **`Shake`** lays short offsets over the camera, started by the runner's camera events (a landing, a roll, a wall run…)
  and by the run bob: along each of the camera's axes a part either sways along a sine or makes one smooth bump, faded
  in and out, weaker the further the camera is from a shake's epicentre. The presets and every camera number are in
  `@trizen/parkour/data/camera.js`; the player's own camera settings are in the tuning.

## Sound

The sound (`src/sound/`) is the demo's, and only reads the run. `Sound.js` looks at the player's run after each frame
and says what plays; `Mixer.js` is the only part that touches Web Audio; `sounds.js` lists the files
(`public/sounds/`), how loud each plays, how many copies may overlap and the least time between two plays, and the
room's reverb (`REVERB`).

- **One-shots** come from the states the runner entered (`sim.frameEvents`: a catch on a ledge, bar, rope, pole or
  zipline, a jump, a slide, a roll, a bail), the sound cues its takes crossed (`sim.frameSounds`: steps, rungs) and its
  flags changing since the last frame (touching down, by how fast it fell; a trick starting; a skid; a door burst
  open; a slide down a pole, pipe or ladder). Camera events are not used: some fire only in one view.
- **The wind** is one loop, its level the loudest of what applies (the body's speed in the air, on a zipline or a
  rope, down a slope in a long slide, a quiet floor under a wall run, a gust off the bar or from an air trick), never
  their sum, followed up quickly and down slowly. It starts its loop from silence and stops it once silent again.
- **The ambience** is one loop that plays from load for as long as the page is open, on its own volume.
- **The room**: the effects, the wind and the ambience, each after its volume, play fully dry, and their sum feeds one
  convolution reverb (`env_ir`, a four-channel true-stereo impulse response) that comes back at one wet level
  (`REVERB.wet`), both under the master volume. A sound turned down sends less to the room, and nothing at 0.
- **The run's own moments**: a respawn (the run's time going back) stops everything and settles quiet for a moment;
  the pause and the menus fade it out; slow motion plays everything lower (the effects, the wind, the ambience, and
  the room, whose impulse response, stretched as if it too were played slower, takes over from its own), falling and
  rising with the run's own ease; a hidden tab is silent by the settings.
- A file with several takes (the steps, the rungs) plays them in a shuffled order, never the same twice running, its
  pitch moved a little each time, all from the mixer's own counter: never the run's seeded streams.
- The volumes are demo options (`ui.options`, the settings' Audio tab), not preferences: they never change a run, so
  they stay off the QA tape.

## Input

**The action table** (`@trizen/parkour/data/actions.js`) is everything the player can do and the keys, buttons, sticks and mouse
that do it. Gameplay asks for actions (`input.held( 'jump' )`, `input.value( 'poleTurn' )`), never for a key. An action
is a button (held while any of its bindings is down; a binding may be a chord, or a pad button that counts only on the
sample it goes down), an axis or a stick (the binding with the larger magnitude, per axis), or the runner's move. Analog
bindings shape their reading with a scale, a dead zone and the travel at which they read full. An action is live in the
modes it names: `play` while the runner is on its feet, `limp` while the ragdoll has the body. The table also holds
sequences (the spin dive: flip, then dive within half a second), buttons live only while another action is held (the
pad's field-of-view chords), and the system actions the page reads once a frame.

`Input` (`@trizen/parkour/input/Input.js`) reads the devices once a frame (`sample( dt )`) and evaluates the whole table. Until the
next sample gameplay reads what is held, what was pressed or released (kept until the steps take them), the actions'
values, the move (`move`, the steering direction; `moveAmount`, how hard it pushes; `moveDirection`) and the look (mouse
and stick separately, in radians). The left stick has two responses: the direction the runner turns toward (each axis
past a quarter of its travel) and how hard it accelerates (stretched by 1.2 and read through the move dead zone, full at
three quarters of its travel). `held( action, 'keys' | 'pad' )` asks one device's bindings, for the rules that differ by
device. The player's preferences (`Preferences.js`: inverted look, the sprint and slow-motion toggles, tricks in first
person, the head camera, camera lag) are set on the settings' *Game* and *Controls* tabs, between frames (the menu
holds the run), and kept in the browser;
several change how a run plays, so QA replays record them and the recorder puts a change on its tape as a setting.

**Devices are raw state.** The page's events only keep what is held, the mouse's counts, and the presses that fall
between samples. A frame of that state (`deviceState.js`) is what a QA replay or a golden tape records and what a replay
puts back in place of the devices before the sample, so the input evaluates exactly as it did. Nothing else reaches a
run from outside.

## Easy mode's pilot

`Pilot` (`@trizen/parkour/pilot/Pilot.js`) plays three keys for the player: Space (jump), E (precision) and the left mouse button
(grab). It never touches the runner: it holds and lets go of those keys in the raw device state before the frame
samples, exactly as a player would, and the player's own presses of them still count.

When the player presses jump, the pilot snapshots the run and looks ahead: it runs the real simulation from the snapshot
with the timing-only figure, frame by frame, trying when to let go of jump (a few frames from 1 to 40 after the press,
and, when a try runs into a wall still holding jump, the frames just before it stopped, so a charged jump goes just
short of the wall) and, at a walk or slower with the stick pushed, a precision crouch of a few lengths instead, then
restores the run. Each look-ahead is scored: reaching something (a catch, a climb, a swing, a pole, a pipe, a zipline, a
wall run) is worth most, then the way forward made and the height kept; a bail, a long drop to nothing or running off a
ledge cost. It tries two look-aheads a frame (a count, not a time, so it decides the same on any machine), holds jump
until the best release, then grabs in the air (or aims a precision landing). Falling fast, it looks ahead for a hard
landing and holds jump to roll it.

Because the pilot only presses keys, a QA tape records its presses as device input and a replay never runs the pilot.
The pilot's look-ahead works because the simulation reads no pose and a snapshot restores a run exactly.

## Touch controls

The touch controls (`src/touch/TouchInput.js`, drawn by `src/ui/TouchControls.svelte`) are a device made of the
others: the simulation reads its pads through the player's `TouchInput.navigator`, which lists a pad of the touch
controls' own (its left stick, and its sprint trigger held while the stick is at its edge) while a thumb is on the
stick; each button holds its action's first key or mouse button as the page's own key events would (the edge queued,
then the key held); a drag on the right is the mouse's counts, with free look held while there is look to give. Inside
the frame, before the pilot's turn, they hold the pointer as captured (a touch screen has none to lock) and give the
look: no faster than the view's mouse turn rate (what is over waits for the frames after) and, in the air, under a
trick flick's threshold, so a look never points a trick. So a run played by touch is raw input like any other, and
replays exactly.

They are on while touch is the device in use (`src/ui/nav.js` follows it by each pointer's type: a touch or a pen
makes it touch, a key or the mouse the keyboard, a pad the pad), which the player follows between frames, and they play
in Easy mode: the pilot times the jumps, grabs in the air, aims the precision jumps and rolls the hard landings, so the
buttons are only what it leaves (Jump, Grab, Slide, Dive, Flip, Wheel, Back Flip). The Use button shows only where
Interact would work something, as `DoorsAndSwitches.target()` says between frames without changing the run.

## QA replays and golden tapes

**QA replays** ([qa/README.md](../qa/README.md) is the user guide). `src/app/Player.js` passes every frame's raw input
through the QA recorder (`src/qa/recorder.js`), which keeps a tape: the settings the run started with (the physics
engine, the tuning, the preferences, the camera's aspect, the random seed), each frame's raw device state, the events
between frames, and a trace row per frame (a hash of everything the golden traces record, and a few readings for the
timeline). The tape always starts at a respawn and is cut at one as it grows, because a respawn is the only place a
replay can start from. A capture takes the last seconds; the editor trims and annotates them; the store
(`tools/qa-store.js`, mounted on the dev server and on the installed demo's server) keeps them in `qa/` (on the hosted
demo, in the browser: `src/qa/store.js`). Share packs a replay, its course, its build and where it was played into a
`.qa.zip` (`src/qa/share.js`) for a GitHub issue; `npm run qa:open` runs one at its own commit and on the code now. A replay (`src/qa/replay.js`) builds a simulation on the
recording's course and engine, applies the settings, respawns where the tape starts, and feeds each frame's raw input
and the events between frames; the first frame whose hash differs is where the run came out differently.
`tests/qa.test.mjs` records runs the way the game does and checks they replay with every hash the same.

**Golden tapes** are scripted QA tapes run headless (`tools/headless/`). `scenarios.mjs` scripts what a player does on
which course: one feature each (moves, the gamepad, first person, slow motion, the ragdoll, 144 Hz frames, and the moves
no lane reaches), the family courses' lanes, and generated courses. `tape.mjs` turns a scenario into the raw input of
every frame (`tests/golden/tapes/`). `run.mjs` plays a tape into a simulation in node (`env.mjs` gives it enough of a
browser) and records a trace (`trace.mjs`): one row per step (position, velocity, heading, movement mode, state, move
and its time, stunt and its time, markers) and one per frame (the camera's place, rotation and field of view, the view's
yaw and pitch, the frame's events). `npm run golden` runs every tape, each in a process of its own, and compares its
trace with the one kept for that engine (`tests/golden/rapier/`, `tests/golden/box3d/`) bit for bit.

A change that restructures code leaves every golden trace exactly as it was. A change meant to alter the game shows up
as differing traces, which are blessed again (`npm run golden:bless`, on both engines) with the reason in the commit.

## The benchmark

The benchmark (`src/bench/`, [qa/README.md](../qa/README.md) is the guide) runs every move and trick the runner has,
most at four sizes, so a person can watch them all and comment on what they see, and an agent can find each comment's
moment again.

- **Stations** (`stations.js`, `stations/*.js`): each is one move at one size, written in its own coordinates (x across,
  y up from its floor, z along from its entry) as the prims it builds and the steps that drive it. `course.js` lays
  them end to end along +z into one course definition, built in memory (it is never a file), so the course always
  matches the scripts. Each station's exit is the next one's entry, on the same floor height: a station that climbs
  comes back down a slope.
- **The script** (`script.js`) is what a step says: how the stick is held (as keys), what else is held, what is
  pressed as it starts and for how long, a mouse flick (a trick's direction), the line to follow across the station,
  and when it is over: a condition on the run as a player sees it (where the runner is along the station, its state,
  whether it is on the ground, how long the step has lasted).
- **The autopilot** (`Autopilot.js`) plays the steps through the raw device state only, as the QA tapes record a player
  (deviceState.js): the keys and mouse buttons held, their presses and releases as edges, and the mouse's counts. On
  foot it turns the view with the mouse toward a point ahead on the station's line, so the stick (W) steers the runner
  along it; in the air it leaves the mouse alone except for a flick. It reads only the run, and its own state is plain
  data, so it is deterministic. Each frame is a 120 Hz step. A station is over when its steps are done and the runner
  is on its feet near its exit; it has failed on an unplanned bail, a fall below its floor, or a step or the station
  lasting too long, and after a moment to see that, the autopilot asks for a respawn at the next station's entry,
  which the run makes between frames as the QA recorder's respawns are made. A station passes when it saw the states
  and moves it expects.
- **A run** (`BenchRun.js`) is one engine and one view on one simulation (the Y Bot, since the ragdoll and the
  first-person camera read its body; a 16:9 camera; no page devices, so the default tuning and preferences). It works
  the run out ahead of what is shown (`extend`, a few milliseconds a frame in the page, putting back what was shown
  after), recording each frame's raw input, the respawns, a hash of the frame (the QA traces' `FrameTrace`), its
  station and the runner's state. It keeps a keyframe (a snapshot of the simulation and a copy of the autopilot's
  state) as each station starts and at least every 5 s, except while the ragdoll has the body (a snapshot of it cannot
  be put back; the keyframe waits for the get-up). Showing a moment (`seek`) puts back the keyframe before it and plays
  the recorded frames to it, checking each frame's hash; playing on runs the recorded frames, or works out new ones at
  the frontier. Third and first person are two runs on one simulation (first person moves the runner differently),
  sharing one raw device state; another engine is another simulation.
- **The fingerprint** compares the page's run with node's: each station's frames and result, and once a second where
  the runner is (to the millimetre) and its state. The frames' own hashes can differ between the page and node in a
  last bit where nothing the run does differs: Math.tan, Math.atan and Math.atan2 round differently in some versions
  of V8 (the camera's field of view, the runner's heading).
- **Comments** (`comments.js`) cover a stretch and say which view and engine they are about. Each keeps the frames it
  was made at on its own run, and for each end the station that end fell in and the time into it, which places it on
  any other run, and after the code changes the stations' lengths.
- **The page** (`Bench.js`) is a QA state (`'bench'`): it holds the live run as the editor does, shows the benchmark
  course and its own simulation's figure, copies its camera (keeping the field of view across the window's shape), and
  draws the course's moving parts from its run. Its long work yields through a message channel, so it also works in a
  background tab.
- **Headless**, `tools/bench/run.mjs` works out the same runs and says which stations pass; `--comment` finds a comment
  on its run and prints its frames.

## Courses

A course (`src/course/Course.js`) is read from its definition (`public/courses/*.json`, or the generator's output) into
**prims** (solids with roles such as `noRun`, `noClimb`, `out`, `decor`, and placeholders with no solid of their own)
and **affordances**: edges, walls and slopes found on the solids (`derive.js`), and authored lines, objects and volumes
(bars, pipes, cables, springboards, doors). Its **route** is a graph of where to stand and which move takes the runner
on, authored or worked out from the geometry. The validator (`validate.js`) checks every link of the route against the
level metrics ([METRICS.md](METRICS.md)) through the reach rules (`reach.js`); the generator (`generate.js`) builds
courses from a seed, retrying what the validator fails; `families.js` describes the family test courses, which
`tools/courses/write-families.mjs` writes out. The demo's levels, the Foundry and the tutorial's course, are laid out
in `tools/courses/` (`foundry.js`, `tutorial.js`, from plan rectangles and heights in storeys), each with a route of
its moves, and `tools/courses/write-levels.mjs` writes them out; the tutorial's lessons (`src/tutorial/`) name its
places and its flags (spawns named by the lessons' ids). The simulation never reads a course directly: it reads the `World` made
from it.
