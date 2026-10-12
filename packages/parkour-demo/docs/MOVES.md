# The motion data

What the runner and the figure play: the takes and moves in `public/data/moves.json`, the clips in `public/data/takes/`,
the move builder that makes them from motion capture (`tools/moves/`), and the captures still to make. How the game
plays them is in [ARCHITECTURE.md](ARCHITECTURE.md) (*The motion system*).

## Takes and moves

A **take** is a stretch of motion: a length in seconds and, for the figure, a clip of bone tracks. A take always plays
at rate 1. The pose graph plays takes by name (the locomotion's walk and run, the hang, the pipe, the idles), and moves
play them for the runner.

A **move** plays a span of one take once, into a layer of the pose graph, at its own rate, blending in and out: a roll,
a vault, a trick, a ledge leap. The runner starts moves by name (`motion.moves.play( 'landingRoll' )`) and reads their
timing: a move's length, the markers it fires, and how far it carries the root.

Both live in one table, `public/data/moves.json`, one entry per line:

```json
{
	"takes": {
		"air_takeoff_left": {"length":1.5294117647058825,"pace":0.85,"pinned":true},
		"land_roll": {"length":1.009090909090909,"pace":1.1,"markers":[["rollStart",0.0000909090909090909],["rollEnd",0.5497]],"root":{"times":[0,0.0298…],"positions":[0,0,0,…]}},
		"pose_jump_crouch": {"length":0.033333335,"additive":"pose_lean_base","pinAt":"firstFrame"}
	},
	"moves": {
		"landingDip": {"take":"land_dip","span":[0,1.375],"length":1.375,"rate":2.15,"blendIn":0.1,"blendOut":0.25,"layer":"landing"},
		"landingRoll": {"take":"land_roll","span":[0,1.009090909090909],"length":1.0090833000000001,"rate":1,"blendIn":0.25,"blendOut":0.35,"layer":"body"},
		"strideLeft": {"take":"stride_left","span":[0,1.155],"length":1.155,"rate":1.1,"blendIn":0.1,"blendOut":0.1,"layer":"body"},
		"doorBarge": {"take":"door_barge","span":[0,0.5166666666666666],"length":0.5166666666666666,"rate":1,"blendIn":0.15,"blendOut":0.3,"holdAtEnd":true,"layer":"body","mask":"upper"}
	}
}
```

A take's entry:

| Field | What it says |
| --- | --- |
| `length` | seconds, as it plays |
| `pace` | how many times its capture's speed the take plays (the build has already sped it up); 1 when left out. The pose graph judges a take's time left on its capture's clock, so a hand-over comes at the same point of the motion whatever the pace |
| `stride` | for a take of steps, how far one cycle of it carries the runner (m). The run and walk turn blends (`blends.js`, with a `speedAxis`) play such a take at the rate that carries its stride at its sample's speed, `speed × length / stride`, so its feet keep in step with the ground |
| `markers` | `[ name, time ]`: the instants the game reacts to (below) |
| `sounds` | `[ name, time ]`: the demo's sound cues, `step` (a foot on the ground or a wall) and `rung` (a hand or foot on a rung, a hand along a ledge). The run never reads them, so they change no trace |
| `root` | `{ times, positions }`: the root's travel, for a take the runner follows (metres, +Z forward from where it starts, three numbers a key) |
| `additive` | the take whose first pose this one is added over (the charging crouch, the leans, the landing dip) |
| `pinned` | the root bone is always held still |
| `pinAt` | `firstFrame`: held at the take's first pose rather than the skeleton's rest |

A move's entry: the `take` it plays and the `span` of it (take seconds), its `length` on its own clock before its rate
(authored where it was measured, so it wins over the span's), its `rate`, its `blendIn` (with `blendInCurve` when not
straight: `smoothstep` or `circleOut`) and `blendOut` in seconds, `holdAtEnd` (it waits on its last pose until stopped
instead of blending out on its own), the `layer` it plays into: `body` (most moves), `landing` (the landing dip,
added over the run), `climb` and `ledgeLeap` (over the hang), and its `mask` when it shows on part of the body only:
`upper`, from the spine up, the pose graph's own pose going on beneath it (the door barge's shoulder over the run). A
move lasts `length / rate` seconds.

There are 138 takes and 70 moves.

### Markers

A take may carry only the markers the game reads:

| Marker | Read by | What it does |
| --- | --- | --- |
| `leftFoot`, `rightFoot` | MarkerResponses | which foot came down last on the ground: the takeoff leads with it |
| `rollStart`, `rollEnd` | MarkerResponses | the part of a roll the body is committed to |
| `trickStart`, `trickEnd` | MarkerResponses | the part of a trick the body is committed to (a landing inside it bails) |
| `airComboOpen` | MarkerResponses | an air trick may follow, a moment later |
| `capsuleShrink`, `capsuleRestore` | MarkerResponses, for the capsule | a flip tucks the capsule into a ball, and it grows back |

### Clips

Each take's clip is `public/data/takes/<take>.json`: its length, one row of key times every track shares, and each
track's values (`<bone>.position` or `<bone>.quaternion`), to five decimals (a hundredth of a millimetre, a few
millionths of a radian: under anything the eye sees, and a third of the file). Only the figure reads clips; the
simulation's timing comes from the table.

```json
{
	"length": 1.009090909090909,
	"times": [0,0.01667,0.03333,…,1.00909],
	"tracks": {
		"mixamorigHips.position": […],
		"mixamorigHips.quaternion": […],
		…
	}
}
```

## The move builder

The table and the clips are built, never edited by hand: `npm run moves:build` makes them from the family specs in
`tools/moves/families/` (one module per family: `air`, `bar`, `door`, `ground`, `ladder`, `landing`, `ledge`, `pipe`,
`pole`, `pose`, `precision`, `rope`, `slide`, `trick`, `vault`, `wall`, `zipline`), and `npm run moves:check` proves the
shipped files are exactly what the specs build (the table, every clip built from a capture, every kept clip's length
and keys, no clip without a take). `tests/takes.test.mjs` runs the same check.

A family module exports `takes` and `moves`:

```js
export const takes = {

	land_roll: {
		from: { clip: 'final/roll_run', span: [ 0.4, 1.75 ] },
		anchors: [ [ 0.4, 0, 'start' ], [ 0.9497, 0.60467, 'rollEnd' ], [ 1.75, 1.11, 'end' ] ],
		pace: 1.1,
		markers: [ [ 'rollStart', 0.0001 ], [ 'rollEnd', 0.60467 ] ],
		root: { times: [ 0, 0.0328…, … ], positions: [ 0, 0, 0, … ] }
	},

	land_dip: {
		fill: { kind: 'keyed', reason: 'the dip a landing at speed adds over the run' },
		length: 1.1,
		pace: 0.8,
		additive: 'pose_landing_base'
	}

};

export const moves = {

	landingDip: { take: 'land_dip', rate: 2.15, blendIn: 0.1, blendOut: 0.25, layer: 'landing' },
	landingRoll: { take: 'land_roll', length: 1.0090833000000001, blendIn: 0.25, blendOut: 0.35 }

};
```

A take is one of three things:

- **built from a capture**: `from: { clip, span }`, a part of a capture in `assets/mocap/` (`'final/roll_run'`),
  re-timed by its anchors. The build cuts its clip. 29 takes are built so.
- **kept**: `kept: '…'`, a clip made from captures by hand beyond what the builder does (the note says what: "fitted to
  the ledge", "leaned into the turn", "the hips held down by the height of the box"…; `from` says which capture when
  that is known). The build keeps its stored clip and checks it fits. 41 takes are kept.
- **a placeholder**: `fill: { kind, reason }`, made without a capture of ours: keyed by hand (`keyed`), posed to fit the
  geometry it plays against (`fitted`), cut together from other clips (`cuts`), an acrobatic move standing in for one we
  have not captured (`acrobatics`), held poses (`posed`), or a single pose (`hold`). Its stored clip is kept until a
  capture replaces it. 68 takes are placeholders (the capture list, below).

Its timing:

- `anchors: [ [ clipTime, takeTime, label ], … ]` pin beats of the capture to times of the take, with straight lines
  between them; the first lands at take time 0 and the last is the take's length. An anchor named after a marker must
  agree with that marker's time. A take with no anchors gives its `length` instead.
- `loop` lets the anchors run past the span: the capture's cycle plays again.
- `pace` says how much faster than its own timeline the take plays. Times in a spec (anchors, markers, root keys, a
  move's span) are on the take's own timeline; the build divides every one of them by the pace, and nowhere else, so the
  shipped take plays at rate 1 and its entry keeps the pace for the pose graph's hand-overs.
- `stride` (m): how far one cycle of a take of steps carries the runner. A leaning walk or run is two cycles of its
  capture, so its stride is twice the capture's. With `speed` (m/s) instead of a pace, the take is paced for that
  speed: its pace is the speed over its own (`speed / ( stride / length )`).
- `shift: [ x, y, z ]` (m, +Z forward): moves the whole body against the take's origin, the runner's centre, by adding to
  the hips' track. For a capture whose actor stood elsewhere than the game holds the runner: the ladder's takes put the
  hands and feet on rungs a quarter of a metre out, wherever their actors stood against theirs.

What the game reads of it: `markers`, `root` (keyed in the spec: the build copies it, divided by the pace, and does not
work it out from the capture), `stride` (the turn blends), `additive`, `pinned` and `pinAt`.

A move: `take`, `span` (default the whole take), `length` (default the span's), `rate` (default 1), `blendIn`,
`blendInCurve`, `blendOut`, `holdAtEnd`, `layer` (default `body`), `mask` (`upper`; default the whole body).

The specs are checked before anything is written (`lib/specs.js`: exactly one of a capture, a kept note or a fill;
anchors moving forward; spans inside their captures and takes; only markers the game reads; layers and curves that
exist), and the build writes a file only when it changes, one entry or track per line, so a change reads as a change to
those lines in a diff.

### Making a take from a capture

1. Put the capture in `assets/mocap/` as three.js clip JSON (per-track times and values, 60 frames a second, retargeted
   to the Y Bot's `mixamorig` bones). A name ending `_m` is the same capture mirrored.
2. In the family's spec, give the take `from: { clip, span }` (the part of the capture it uses) and `anchors` that pin
   the capture's beats (a foot down, a hand on the edge, the end of a roll) to the times the game expects, with `pace`
   if it should play faster or slower. A take that replaces a placeholder keeps its name, so nothing that plays it
   changes; drop its `fill`.
3. Give it the `markers` it fires and, if the runner follows its root, its `root` keys.
4. `npm run moves:build`, then `npm run moves:check`.
5. Look at it on the Y Bot: a contact sheet (README, *Docs*) of the take at a few times, `[ [ take, time ], … ]` (cell
   widths are rounded up to a multiple of 64).
6. Run the checks (AGENTS.md). A take's markers, root, length and pace are timing: changing them changes runs, and the
   golden traces. A change to how it only looks shows in them only where the ragdoll starts from the pose or the
   first-person camera rides the head.

### Reshaping a kept take

A kept take or a placeholder is changed by tools that write its stored clip (and, where they say, its spec), each
printing what it would do until given `--write`; the take's note says what was done:

- `tools/moves/rekey.mjs <take>` keys a climbing take's root along its own hips, so the runner rises when the body does
  (`ledge_climb_up`, `vault_high_hop_onto`, `pipe_top_out`).
- `tools/moves/stride.mjs <take> --scale <share>` lengthens a walk's strides: the legs swing that much further about
  their mean, the hips go down to keep the feet on the ground, and the stride grows by the same share, so at the same
  speed the take plays that much slower (the walk's four leaning takes, a quarter: it played 0.8 times as fast).
- `tools/moves/tuck.mjs <take> --knees <share> [--hips <share>]` tucks the legs more or less (the bend of each knee and
  hip from the rest scaled), over the take or a stretch of it (the front and back flips a tenth more; the precision
  jump's tuck a fifth less).
- `tools/moves/reshape.mjs <take>` re-times a clip by pairs of times, tips the body, bends the elbows and cuts the arms'
  swing, each over a stretch of it (the precision jump: its crouch held so its push meets the launch, its tuck later).

`tools/moves/limbs.mjs <take> [every] [capture]` prints where a take or a capture puts the hands, feet, hips and head,
for reading one against what it reaches for.

The build cuts a take by giving it a key on every capture frame its anchors cover and on every anchor (so each beat
lands on a key), each moved to its take time by the anchors and divided by the pace; a looping take wraps the clip time
round its span, and otherwise a clip time past the span holds the span's last pose.

### The captures

`assets/mocap/` holds the captures the takes are cut from: `final/` (gait-matched locomotion loops, and rolls, hops,
cartwheels and a few parkour moves) and `parkour/` (the parkour moves one by one). The game never loads them.

## The capture list

`npm run moves:captures` lists every placeholder with what it is for and the moves that wait on it, by family, the
families holding up the most moves first. A capture replaces a placeholder by name: its spec gets `from` and anchors
instead of `fill`, and the build cuts it.

68 takes wait for a capture: fitted 22, acrobatics 21, posed 14, keyed 8, cuts 2, hold 1. "The pose graph" means the
graph plays the take itself (no move waits on it).

**trick** (18 takes, 18 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `trick_spin_loop` | a flat spin in the air, chained after another | acrobatics | `spinRepeat` |
| `trick_spin` | a flat spin in the air | acrobatics | `spin` |
| `trick_back_flip_run` | a back flip out of a run | acrobatics | `runningBackflip` |
| `trick_back_flip_hold` | a back flip held tucked | acrobatics | `heldBackflip` |
| `trick_back_flip_layout` | a laid-out back flip | acrobatics | `layoutBackflip` |
| `trick_back_flip_standing` | a back flip from standing | acrobatics | `standingBackflip` |
| `trick_back_cork` | a back flip with a corkscrew twist | acrobatics | `backCork` |
| `trick_death_dive` | a head-first dive held flat until the landing | acrobatics | `deathDive` |
| `trick_spin_dive_roll` | a spinning dive into a roll | acrobatics | `spinDiveRoll` |
| `trick_dive` | a dive into a roll (out of a bail or off a wall) | acrobatics | `diveOut` |
| `trick_spin_front_flip` | a front flip with a spin | acrobatics | `spinFrontFlip` |
| `trick_dive_front_flip` | a diving front flip | acrobatics | `diveFrontFlip` |
| `trick_front_flip_repeat` | a front flip in the air, chained after another | acrobatics | `frontFlipRepeat` |
| `trick_front_flip` | a front flip in the air | acrobatics | `frontFlip` |
| `trick_side_flip_repeat` | a side flip in the air, chained after another | acrobatics | `sideFlipRepeat` |
| `trick_side_flip` | a side flip in the air | acrobatics | `sideFlip` |
| `trick_vortex_repeat` | a vortex in the air, chained after another | acrobatics | `vortexRepeat` |
| `trick_vortex` | a vortex (an inverted twist) in the air | acrobatics | `vortex` |

**ledge** (18 takes, 8 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `ledge_leap_side_left` | a leap sideways to the left from a hang, to the next ledge | fitted | `ledgeLeapSideLeft` |
| `ledge_leap_side_right` | a leap sideways to the right from a hang, to the next ledge | fitted | `ledgeLeapSideRight` |
| `ledge_leap_free_left` | a leap to the left from a free hang (no wall under the feet) | fitted | `ledgeLeapFreeLeft` |
| `ledge_leap_free_right` | a leap to the right from a free hang (no wall under the feet) | fitted | `ledgeLeapFreeRight` |
| `ledge_leap_down_alt` | a drop from a hang to a ledge below, the other way of doing it (the two alternate) | fitted | `ledgeLeapDownAlt` |
| `ledge_leap_down_left` | a drop from a hang to a ledge below and to the left | fitted | `ledgeLeapDownLeft` |
| `ledge_leap_down_right` | a drop from a hang to a ledge below and to the right | fitted | `ledgeLeapDownRight` |
| `ledge_leap_down` | a drop from a hang to a ledge below | fitted | `ledgeLeapDown` |
| `ledge_hang_look_up` | hanging from a ledge, looking up | fitted | the pose graph |
| `ledge_hang_look_down` | hanging from a ledge, looking down | fitted | the pose graph |
| `ledge_hang_look_up_left` | hanging from a ledge, looking up and left | fitted | the pose graph |
| `ledge_hang_look_up_right` | hanging from a ledge, looking up and right | fitted | the pose graph |
| `ledge_hang_look_left` | hanging from a ledge, looking left | fitted | the pose graph |
| `ledge_hang_look_down_left` | hanging from a ledge, looking down and left | fitted | the pose graph |
| `ledge_hang_look_down_right` | hanging from a ledge, looking down and right | fitted | the pose graph |
| `ledge_hang_look_right` | hanging from a ledge, looking right | fitted | the pose graph |
| `ledge_shimmy_left` | shimmying left along a ledge, feet on the wall | fitted | the pose graph |
| `ledge_shimmy_right` | shimmying right along a ledge, feet on the wall | fitted | the pose graph |

**wall** (4 takes, 5 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `wall_tic_tac_left` | a tic-tac off a wall on the left | fitted | `ticTacLeft` |
| `wall_tic_tac_right` | a tic-tac off a wall on the right | fitted | `ticTacRight` |
| `wall_kick_left` | a kick back off a wall on the left | fitted | `poleKick`, `wallKickLeft` |
| `wall_kick_right` | a kick back off a wall on the right | fitted | `wallKickRight` |

**precision** (3 takes, 3 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `perch_land` | landing balanced on a narrow perch | acrobatics | `perchLand` |
| `precision_jump` | the jump to a perch, feet together | acrobatics | `precisionJump` |
| `precision_crouch` | crouching to aim a precision jump | acrobatics | `precisionCrouch` |

**landing** (2 takes, 2 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `land_dip` | the dip a landing at speed adds over the run | keyed | `landingDip` |
| `land_hard` | a hard landing that soaks up a long drop | cuts | `hardLanding` |

**pipe** (4 takes, 1 move waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `pipe_hold` | holding still on a pipe | posed | the pose graph |
| `pipe_slide_halt` | stopping a slide down a pipe | posed | the pose graph |
| `pipe_slide_down` | sliding down a pipe | posed | the pose graph |
| `pipe_top_out` | climbing off the top of a pipe onto the ledge above | posed | `pipeTopOut` |

**ground** (1 take, 1 move waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `ground_run_stop` | skidding to a stop from a run | keyed | `skidStop` |

**vault** (1 take, 1 move waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `vault_kong` | a kong vault: hands on the obstacle, legs through | cuts | `kongVault` |

**slide** (7 takes, 0 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `slide_tuck_right` | sliding tucked low, steering right | posed | the pose graph |
| `slide_tuck` | sliding tucked low, steering left | posed | the pose graph |
| `slide_stand_left` | sliding upright, steering left | posed | the pose graph |
| `slide_stand_right` | sliding upright, steering right | posed | the pose graph |
| `slide_seat_left` | sliding seated, steering left | posed | the pose graph |
| `slide_seat_right` | sliding seated, steering right | posed | the pose graph |
| `slide_seat` | sliding seated, going straight | posed | the pose graph |

**pose** (5 takes, 0 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `pose_jump_crouch` | the crouch added while a running jump charges | keyed | the pose graph |
| `pose_lean_base` | the upright pose the forward and back leans are measured from | keyed | the pose graph |
| `pose_lean_forward` | the body leaning forward, accelerating | keyed | the pose graph |
| `pose_lean_back` | the body leaning back, braking | keyed | the pose graph |
| `pose_landing_base` | the standing pose the landing dip is measured from | hold | the pose graph |

**air** (2 takes, 0 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `air_flail` | limp and flailing in a fast fall (a bail) | keyed | the pose graph |
| `air_tumble` | limp and tumbling at low speed (a bail) | keyed | the pose graph |

**pole** (2 takes, 0 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `pole_kick_ready_left` | coiled on a pole, ready to kick off | posed | the pose graph |
| `pole_slide` | sliding down a pole | posed | the pose graph |

**zipline** (1 take, 0 moves waiting)

| Take | What it is for | Placeholder | Waiting on it |
| --- | --- | --- | --- |
| `zip_hang` | riding a zipline with both hands | posed | the pose graph |
