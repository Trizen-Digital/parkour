# Level metrics

The numbers a course is built to so that every move works, and the colours that say what each surface does.

The course tools read one table of these (`src/course/metrics.js`, through the rules in `src/course/reach.js`): the
deriving of edges, walls and slopes, the route, the validator, the generator and the family test courses
(`public/courses/test_*.json`). A course that passes the validator is built to these tables.

The runner has its own tuning (`@trizendigital/parkour/sim/tuning.js`) and doesn't read the tables. It runs faster and jumps further and
higher than they say, under stronger gravity; *The runner as it plays now* gives what it does, measured headless, and
[DESIGN.md](DESIGN.md) has the rest of its numbers. Build to the tables, then try a course with the runner itself:
`npm run lanes` (the family lanes, by hand and in Easy) and `npm run reach` (every route link).

## How to read the tables

- **Heights are relative** to the surface the runner stands on when the move starts, never world height. Moves
  stack: a vault onto a roof, then a wallclimb from that roof, use the same numbers.
- **Comfortable**: build to this. It works from imperfect input and keeps working when moves are chained at speed.
- **Max**: the system can do it, with precise input at the right speed. Use it sparingly, for a hard optional line.
- **Clearly out**: anything meant to be unreachable sits at least this far beyond Max. Mirror's Edge's level
  designers found that targets just past the limit read as reachable and frustrate players, so leave a dead band
  between "just makes it" and "obviously not". Never place a target between Max and Clearly out.
- **ME1** columns quote Mirror's Edge (2008) where it's known. Those values are class defaults read out of the PC game
  by the community reimplementation [faith-runner](https://github.com/tnrjns/faith-runner); DICE never published
  metrics, and Catalyst's are unknown. ME1 uses a gravity about 1.7 × real, so its airtime numbers don't carry over
  directly. The tables use real gravity (the course tools measure reach with it); the runner uses 1.75 × real, like ME1.

## The runner as it plays now

Measured headless with the default tuning, keyboard input, 60 frames a second (the simulation steps at 120 Hz), on
Rapier; box3d agrees to the centimetre except where the capsule meets an edge, which moves a few gaps and heights by a
step of the tables. Against the tables below, a course built to them is easier than they say for gaps and drops, the
wallrun covers less ground, and some heights they call vaults or wallclimbs aren't got over (see Obstacles).

| | Now | The tables |
|---|---|---|
| Walk (stick only) | 2.0 m/s, reached in 0.23 s | walk 0.7–1.1, jog 1.3–2.3 m/s |
| Sprint (stick + Sprint) | 5.85 m/s, reached in 0.7 s and 2 m from a standstill; no further build-up | 3.6 m/s, building to 7.2 over ~42 m |
| Gravity | 17.15 m/s² (1.75 × 9.8) | 9.81 m/s² |
| Capsule | 0.185 m radius, 1.8 m tall | 0.30 m radius |
| Step walked up without a move | 0.30 m; a 0.4 m obstacle stops a runner who neither jumps nor grabs | 0.36 m |
| Walkable slope | up to 65° | up to 40° |
| Running jump (faster than 2.5 m/s) | Leaves when Jump is released, charged by how long it was held: a tap at 5.5 m/s up (0.88 m apex, 0.63 s in the air, 3.75 m on the level at a sprint), a full charge (held 0.5 s, about 2.9 m before the edge at a sprint) at 7.25 m/s up (1.53 m apex, 0.83 s, 5.0 m) | 2.6 m Max on the level at 3.6 m/s |
| Standing or walking jump | 5.0 m/s up whatever the hold: 0.73 m apex, 0.57 s; 1.2 m on the level at a walk | 1.5 m on the level standing |

Largest gap cleared, taking off at the edge (m; the lanes in test_gaps take off earlier, so they clear less):

| Landing rise | Walk, tap | Sprint, tap | Sprint, full charge |
|---|---|---|---|
| +1.0 m | no | 2.4 | 4.2 |
| +0.5 m | 1.1 | 3.4 | 4.7 |
| 0 | 1.3 | 4.0 | 5.2 |
| −1 m | 1.6 | 4.7 | 5.8 |
| −2 m | 1.9 | 5.4 | 6.4 |
| −3 m | 2.1 | 6.0 | 6.8 |

A landing a little above the jump's peak is still made: a top up to about the capsule's radius (0.185 m) above it is
stood on when the capsule's rounded bottom comes down on its edge, which is how a sprint tap gets onto +1.0 m. Grabbing
an edge a jump falls short of reaches further (the runner catches and climbs it).

- **Obstacles** (met square-on at a sprint, on blocks 0.4 m and 3 m deep, which play the same): vaults, climbs and
  catches all need Grab held; the step is 0.3 m, so 0.4–0.6 m needs a jump. With Grab alone the runner hops onto 0.8–0.9
  m and 1.6–1.7 m and runs up a wall to hang from an edge 2.9–3.0 m up; with Grab held and a trick button pressed it
  vaults 0.75–1.2 m (the dash, speed and kong vaults), and with Jump held into it, power jumps off it; jumping
  and then grabbing, it clears up to 1.0 m (1.7 m from a full charge), catches the edge of 1.4–1.7 m
  (1.8–2.4 m from a full charge), and runs up to edges 3.1–3.9 m high. Nothing from 2.5 to 2.8 m is got over, and from 4
  m up only a full charge from the right distance reaches the edge. A caught edge is climbed with Jump and forward held.
- **Wallrun** (Grab held in the air): 0.7 s along the wall, carried by its move: 2.35 m along it whatever the speed and
  whatever the angle it was met at up to 25°, rising about 0.9 m; at a walk too, with Grab pressed after the jump. From
  about 30° the runner plants on the wall instead, or the run ends at once.
- **Falls** (from the feet): landed running below 2.1 m; from 2.1 m to 4.55 m a hard landing, a 0.6 s roll-out that
  costs about 0.6 s at a sprint; above 4.55 m it bails (the ragdoll), unless Jump is held into the landing, which rolls
  it out (about 0.25 s lost) up to 10 m. Catching a ledge after a fall of more than 7 m bails instead; past about 19 m
  the runner bails in the air.

## The runner

| | The tables | ME1 |
|---|---|---|
| Height | 1.80 m | 1.80 m |
| Capsule radius | 0.30 m | 0.30 m |
| Eye height | 1.66 m | 1.66 m |
| Hips (standing) | 1.00 m | — |
| Fingertips, arms up (standing) | 2.22 m | — |
| Hang length (hands on an edge → soles) | ~2.15 m | 1.83 m + 0.35 m reach |
| Crouch height | 1.22 m | 1.22 m |
| Slide height | ~0.9 m | — |
| Step (walked over, no animation) | 0.36 m | 0.35 m |

## Speed and momentum

| Gait | Speed | Notes |
|---|---|---|
| Walk | 0.7–1.1 m/s | precision; Vertigo at long drops |
| Jog | 1.3–2.3 m/s | |
| Run | 3.0 m/s | minimum for wallruns (2.0), vaults over (3.5), slides (3.5) |
| Sprint | 3.6 m/s | |
| Free-run | ~5.0 m/s | |
| Top | 6.5–7.2 m/s | ME1's ceiling is 7.2 m/s (26 km/h) |

The tables have no sprint button: speed builds while running straight (the runner has one, which takes it to 5.85 m/s in
0.7 s; see *The runner as it plays now*). Following ME1's curve: 4.0 m/s after 0.4 s, 5.2 after 1 s, 6.5 after 3.5 s,
7.2 after 7 s. **Reaching 6.5 m/s from a standstill takes about 18 m of straight running** (7.2 m/s takes about 42 m),
so full-speed jumps need a long run-up or a flow move before them that keeps speed.

| Keeps or adds speed | Costs speed |
|---|---|
| Speed vault (+0.8 m/s) | Letting go of forward (speed above 4 m/s bleeds off over ~3 s) |
| Skill roll (at least 4 m/s) | Quickturn (× ~0.6) |
| Springboard, wallrun, wallrun jump | Slide exit (× 0.5) |
| Coil over an obstacle | Plain landing (−0.65 m/s); hard landing (to 0) |
| Swing release (~6 m/s) | Wall bump or failed move (to 0); stumble (× 0.5) |
| | Turning hard within ~3 strides of a landing |

Turning circle without losing speed: ≥ 2 m radius at 3.6 m/s, ≥ 6 m at top speed. Tighter means a plant-and-turn.

## Jumps across gaps

Edge-to-edge gap a running jump clears, by approach speed and by the height of the landing relative to the take-off
(Δh). Each cell is **max / comfortable**. Upward jumps above +0.6 m need the coil.

| Δh | Standing | Run 3.0 | Sprint 3.6 | Free-run 5.0 | Top 7.2 |
|---|---|---|---|---|---|
| +1.0 m | – | – | – | 2.0 / 1.7 | 3.4 / 2.9 |
| +0.5 m | 1.0 / 0.9 | 1.7 / 1.5 | 2.0 / 1.7 | 2.9 / 2.4 | 4.4 / 3.7 |
| 0 | 1.5 / 1.3 | 2.2 / 1.9 | 2.6 / 2.2 | 3.7 / 3.1 | 5.4 / 4.6 |
| −1 m | 1.9 / 1.6 | 2.8 / 2.4 | 3.4 / 2.9 | 4.6 / 3.9 | 6.8 / 5.8 |
| −2 m | 2.2 / 1.9 | 3.3 / 2.8 | 3.9 / 3.3 | 5.4 / 4.6 | 7.8 / 6.6 |
| −3 m | 2.5 / 2.1 | 3.6 / 3.1 | 4.3 / 3.7 | 6.0 / 5.1 | 8.7 / 7.4 |
| −5 m | 2.9 / 2.4 | 4.3 / 3.6 | 5.0 / 4.3 | 6.9 / 5.9 | 10.1 / 8.6 |

- Clearly out: Max + 1.5 m.
- Landing zone: at least 2.5 m clear past the far edge (4 m comfortable); 3.5 m when the fall calls for a roll.
- Run-up: at least two strides (3 m) at the needed speed lined up with the jump.
- Higher than +1.0 m isn't a landing; it's a **catch**. An edge 1.5–2.7 m above the take-off, within the gap distances
  above, is caught and hung from. A springboard first adds about 1 m to that.
- Standing jumps (no run-up) reach 1.5 m level; a standing jump onto a beam or pipe needs the target within 2.0 m.
- Dodge jump (sideways): 2–3 m to the side.

## Obstacles: vault, climb, wallclimb

By the obstacle's height over the runner's feet. **Thin** means ≤ 0.8 m deep (it's vaulted *over*); **deep** means
≥ 1.0 m of top to land on (it's vaulted *onto*). Avoid 0.8–1.0 m deep: it's ambiguous.

| Height | At a run (≥ 3.5 m/s) | Walking / standing | ME1 band |
|---|---|---|---|
| ≤ 0.36 m | stepped over | stepped over | ≤ 0.48 auto step-up |
| 0.36–0.65 m | step up (no hop) | step up | 0.48–1.48 slow step-up at a jog |
| 0.65–1.45 m | speed vault over (thin) or onto (deep) | climb onto (mantle) | 0.64–1.48 speed vault at 4–7.2 m/s |
| 1.45–2.2 m | high vault onto (deep) or over (thin, fence) | climb onto up to 1.9 m | 1.45–1.92 high vault |
| 2.2–2.8 m | wallclimb straight over the edge | jump up and hang (edges 2.1–2.6 m) | ledge grab above 1.92 |
| 2.8–3.6 m (3.2 comfortable) | wallclimb to hang, then climb up | — | ~3.4 m reach from a jump |
| > 3.6 m | not climbable without a pipe, ladder or holds | — | |

- Clearly unclimbable: ≥ 4.2 m, or mark the wall as no-run (dark grey).
- Vault over: 1.5 m clear landing beyond, at −1.0 … +0.3 m of the approach height (lower than that is a vault and a
  drop, which is fine but plays as a fall).
- Vault onto / climb onto: at least 1.0 m of top and 2.0 m of headroom above it.
- Springboard: a step 0.45–0.85 m tall about 1.1 m in front of a 0.8–1.5 m obstacle (ME1: ~0.64 m step), or a
  sloped red plank or ramp at a roof edge. It adds its own height plus about 1 m to every reach after it.

## Walls

| | Comfortable | Max | ME1 |
|---|---|---|---|
| Wallrun: wall height above the run surface | ≥ 3.0 m | ≥ 1.9 m | ≥ 1.92 m |
| Wallrun: approach angle into the wall | 15–40° | 5–55° | ≤ 57° |
| Wallrun: entry speed | ≥ 3.5 m/s | ≥ 2.0 m/s | ≥ 2 m/s |
| Wallrun: rise above the take-off | 0.5–1.2 m | 1.7 m | ≤ 1.7 m |
| Wallrun: length covered (1.2–1.6 s) | 4–5 m at 3.6 m/s, 8–10 m at 7.2 m/s | | 6–12 m |
| Wall-to-wall corridor (wallrun turn, jump, wallrun) | 3–4 m wide | 2.5–4.5 m | |
| Wallrun jump-off distance | 3–4 m | 5 m | |
| Wallclimb: wall height | ≥ 2.5 m | ≥ 1.8 m | ≥ 1.8 m |
| Wallclimb: facing the wall within | 20° | 33° | 33° |
| Wallclimb: run-up | ≥ 3 m at ≥ 3 m/s | 2 strides | |
| Wallclimb turn-jump: lands back from the wall | 2–3 m | 3.5 m | ~4 m/s out |

- A wallrun crosses a gap in the floor as long as the wall continues; the wall's length sets how far.
- Keep the wall's face clear (no pipes, ledges or signs) 0.3–2.6 m above the run surface for the length of a wallrun,
  unless they're the target.
- Inside corners: a wallrun stops; outside corners end it.

## Ledges and hanging

| | Value |
|---|---|
| Edge you can hang from | top ≥ 0.15 m deep, a clean 90° edge |
| Edge you can climb up onto | top ≥ 0.6 m deep, ≥ 1.0 m headroom (2.0 m to stand) |
| Braced hang | a wall within 0.3 m below the edge, down to at least 1 m under it; otherwise it's a free hang |
| Shimmy | continuous edge (gaps ≤ 0.3 m are crossed), ~0.55 m/s; outside corners go round, inside corners stop it |
| Grab transfer (hang → higher edge) | up to 1.4 m above, within 0.3 m in plan |
| Back jump from a hang / pipe / ladder | targets 1.5–3 m behind, from 0.5 m above the hands downward |
| Drop from a hang | the fall is from the soles, edge − 2.15 m (landing rules below) |
| Drop to hang (climbing down over an edge) | needs a braced face under the edge |
| Narrow ledge walk | 0.15–0.4 m deep, wall ≥ 2 m tall behind it; chest to the wall under 0.25 m, back to it from 0.25 m |

## Pipes, ladders, facades

| | Value |
|---|---|
| Drainpipe | Ø 0.08–0.20 m, 0.10–0.25 m off the wall, vertical within 5° |
| Jump to a pipe or ladder | ≤ 2.5 m from the take-off edge, −1.0 … +1.5 m |
| Climb speed | ~0.6 m/s up, faster down; slide down ~2 m/s |
| Top of a pipe or ladder | ends at an edge to climb out onto (or a cap, which stops the climb) |
| Ladder | rungs 0.30 m apart (0.26–0.34 works), 0.40–0.60 m wide, rails 1 m past the top to exit |
| Facade holds (no move for them yet) | staggered 0.35–0.5 m apart |

## Bars, ropes, ziplines

| | Value |
|---|---|
| Swing bar height | 2.0–2.8 m above the take-off (2.4 comfortable) |
| Swing bar | ≥ 1.0 m wide; 2.4 m clear under it along the swing |
| Swing approach | ≥ 3 m/s |
| Swing release | 3–5 m forward, landing 1–4 m below the bar; ME1 releases at 6 m/s |
| Bar to bar | 3–4.5 m apart, within ±0.5 m of each other's height |
| Free hang (bars, pipes, wires) | ≥ 2.3 m above the ground or the feet touch down |
| Zipline slope | descending 5–25° (they only ride downhill) |
| Zipline catch | cable 2.0–2.6 m above where you jump; no catch when falling faster than 6 m/s |
| Zipline clearance | cable ≥ 2.4 m above anything under it (lower: the feet hit and it drops you) |
| Zipline speed | 3 m/s + 4 m/s² + gravity along the slope, capped at 12 m/s; braked at 8 m/s² to 7.2 m/s (the runner's top speed) at the bottom anchor, so the drop off the end lands like a run |
| Zipline end | a landing zone ≥ 4 m long at the bottom anchor; you can let go anywhere |

## Balance

| | Value |
|---|---|
| Balance beam / pipe | 0.05–0.25 m wide (wider is run normally; under 0.05 m is a wire, more sway) |
| Speed on a beam | up to ~2.5 m/s (ME1: 2.45) |
| Recovery | ~0.8 s at full lean before falling off (the fall rules apply) |
| Getting on | walk on from a surface at the same height (±0.3 m), or a standing jump of ≤ 2.0 m |

## Slides, crouching, slopes

| | Value |
|---|---|
| Slide | Down at ≥ 3.5 m/s; ends below 2.5 m/s: ~1.5 m from 3.6 m/s, ~6 m from 7.2 m/s |
| Slide under | ≥ 1.0 m clear (1.3 m comfortable) |
| Crouch passage / vent | ≥ 1.3 m clear |
| Crawl space (no move for it yet) | ≥ 0.7 m clear |
| Squeeze gap (no move for it yet) | 0.3–0.5 m wide |
| Walkable slope | ≤ 40° |
| Slide slope | 40–60° (ME1's rump slide, up to 10 m/s, steer ±2 m/s across) |
| Wall | > 60° |
| Slope run-out | ≥ 3 m of level ground, or a gap to jump at its foot |

## Landings and falls

The fall is measured from the soles at the jump's peak (or the edge) down to the landing.

| Fall | Without a roll | With a skill roll | ME1 |
|---|---|---|---|
| < 2 m | land running (−0.65 m/s) | — | |
| 2–5.3 m | deep landing, run on slower | roll, speed kept (≥ 4 m/s) | roll from 2 m |
| 5.3–10 m | hard landing: dead stop, ~1.8 s without control | roll, speed kept | hard landing from 5.3 m |
| > 10 m | fatal (ragdoll) | fatal | fatal past 10 m |

- Skill roll: Down within 0.2 s before touchdown; pressing again within 0.6 s doesn't count.
- Vertigo: walking (not running) to a drop over 10 m stops at the edge and looks down.

## Doors and switches

| | Value |
|---|---|
| Door | 0.9–1.2 m wide, 2.1–2.4 m tall; opens away from the runner |
| Door at ≥ 2.5 m/s | shoulder barge, through at speed + 2 m/s (≤ 5 m/s) |
| Door slower | kick open (~0.6 s) |
| Valve wheel, buttons | centre 1.0–1.5 m up, on a wall with 1 m of standing room |

## Level building

- Build at Comfortable; keep anything unreachable Clearly out.
- Give every move its run-up and its run-out: two strides in, two strides out, more for full-speed lines. The
  validator flags moves that can't be reached at the speed they need.
- Give at least three strides of straight running after a landing before a required turn.
- Keep 2.5 m of headroom over running lanes and 3.5 m over jump arcs.
- One decision at a time: where two moves compete (a vault and a wallrun at the same spot), both should lead on.
- Parapets and fences meant to stop the runner: ≥ 1.3 m tall, too thin to stand on, and dark grey (no-run). Nothing
  climbable within hop reach of them (from a top between ~0.66 and 1.6 m next to a 1.26 m parapet,
  the parapet becomes a hop target).
- Mirror's Edge put springboard ramps at building edges and red objects on the path; do the same where a gap is near
  Max.

## Colours

Mirror's Edge's language: a white world where **red means usable** (Runner Vision), strong primary accents per district,
very little green. We keep that and add a graybox view where each kind of surface has its own hue, so the level reads at
a glance while it's being built. *Settings › Video › Course Look* picks Graybox or Runner Vision (*Vision Off / Vision /
Vision Full*, Catalyst's Off / Classic / Full): Classic fades the next two moves on the route in red as the runner nears
them, Full tints everything usable red and lays a trail along the route ahead. The tints and the trail follow the course
tools' *Vision Preview* (the free camera's target).

| Surface | Graybox | Runner Vision |
|---|---|---|
| Walkable tops | white `#F2F2EF` | white |
| Faces that do nothing special | light grey `#D6D7D5` | light grey |
| Out of bounds, far below | mid grey `#8C8F91` | mid grey |
| No-run / no-climb (parapets, glass, fences you can't vault) | dark grey `#4A4D50` | dark grey |
| Climbable edge (hang, shimmy, climb up): a 10 cm stripe on the edge | yellow `#F2C12E` | red `#D8282B` |
| Vault obstacles, springboards | orange `#EF7B2A` | red |
| Wallrun / wallclimb walls | blue `#2F6FD0` | white (walls aren't highlighted in ME) |
| Pipes, ladders, facade holds | green `#3FA34D` | red |
| Bars, ropes, ziplines | magenta `#C8479B` | red |
| Balance beams and wires | teal `#1FA3A0` | red |
| Slide slopes | sky `#7FC4E8` | white |
| Doors, valves, buttons | red `#D8282B` | red |
| Hazards (barbed wire, kill volumes) | black `#1E1E1E`, yellow chevrons | black |

