# The feel in numbers

What the runner does, in numbers a designer can hold a course or a tuning change against. The tuning values are the
defaults in `@trizendigital/parkour/sim/tuning.js` (every one is on the settings' *Tuning* tab, angles in degrees); the rest are fixed in
the code that uses them. Measured numbers come from the game run headless on Rapier with the default tuning: a
simulation fed scripted keyboard input at 60 frames a second (it steps at 120 Hz), on flat floors, decks and walls built
for the purpose. box3d gives the same numbers to the centimetre, except where the capsule meets an edge: there a few
gaps and heights in the tables below come out a step apart.

For building courses, the tables a course is built to are in [METRICS.md](METRICS.md), where *The runner as it plays
now* turns these numbers into what a course can ask for.

## The body

| | |
| --- | --- |
| Capsule | 0.185 m radius, 1.8 m tall; it floats 2.15 cm above the floor |
| Tucked for a flip | 0.72 m tall, growing back over 0.1 s |
| Sliding | 0.6 m tall, its centre 0.6 m lower |
| Step walked up without a move | 0.30 m (`stepHeight`) |
| Steepest walkable floor | 65° (`walkableSlope`) |
| Gravity | 17.15 m/s²: 9.8 × the tuning's gravity scale of 1.75 |
| Fastest fall | 40 m/s |

## Running

| | Measured |
| --- | --- |
| Walk (the stick alone) | 2.0 m/s (`walkSpeed`), reached in 0.23 s and 0.24 m |
| Sprint (Shift held) | 5.85 m/s (`sprintSpeed`), reached in 0.68 s and 2.0 m from a standstill; no build-up beyond |
| Sprint let go, stick still held | back to walking speed in 0.37 s (sprint lapses at the next 0.2 s check, then braking) |
| Stick let go from a walk | stopped in 0.1 s, 0.07 m |
| Stick let go from a sprint | the skid stop plays: stopped in 1.2 s, 2.9 m on |

The runner accelerates along its heading at 8.55 m/s² (`acceleration`), toward the speed the pace allows times how far
the stick is pushed (a push of 0.11 or less does nothing). Without input it brakes at 20.5 m/s² (`braking`). Turning
keeps the speed: the velocity swings toward the stick at 20 per second (`groundFriction`). The heading closes on the
stick's direction at 4.55 per second on the ground (`groundTurnRate`: half the gap in 0.15 s) and 1 per second in the
air (`airTurnRate`); for a moment after a wall run it turns at 2.25 per second (so the jump keeps its line), after a
pole at 5.5 and after a wall kick at 10. The stick steers relative to the view, and the view turns toward a sideways
run, so holding a direction keeps the runner turning.

In the air the stick accelerates at 35 % of the ground's (`airControl`, 3.0 m/s²), and the velocity swings toward it
only slowly (`airFriction`, 0.1 a second). A sprint jump steered hard right from takeoff to landing drifts 0.2 m
sideways and turns its heading by 46°.

## Jumping

A jump goes when Jump is **let go**. Held on the ground it charges: the charge starts at 0.75 (`jumpChargeStart`) and
grows by 0.5 a second (`jumpChargeRate`), full after 0.5 s. Faster than 2.5 m/s it is a running jump, rising at 7.25 m/s
(`runningJumpSpeed`) times the charge; slower, a standing jump rises at 5.0 m/s (`standingJumpSpeed`) whatever the
charge. A jump charged past 0.95 that leaves faster than 4.5 m/s across the ground is a style jump: the camera tips down
over the takeoff. A standing jump, however long it was held, is never one.

| Jump | Rises at | Apex | In the air | On the level |
| --- | --- | --- | --- | --- |
| Standing or walking, any hold | 5.0 m/s | 0.73 m | 0.57 s | 1.17 m at a walk |
| Sprint, a tap | 5.5 m/s | 0.88 m | 0.63 s | 3.75 m |
| Sprint, held 0.25 s | 6.35 m/s | 1.17 m | 0.73 s | 4.34 m |
| Sprint, held 0.5 s (full) | 7.25 m/s | 1.53 m | 0.83 s | 4.97 m |

The apex is the rise of the feet. A tap holds the jump for one frame, which already adds a little charge.

Largest gap cleared landing on the far deck, with Jump let go at the edge (m; a full charge is pressed half a second
before the edge):

| Landing rise | Walk, tap | Sprint, tap | Sprint, full charge |
| --- | --- | --- | --- |
| +1.0 m | no | 2.4 | 4.2 |
| +0.5 m | 1.1 | 3.4 | 4.7 |
| 0 | 1.3 | 4.0 | 5.2 |
| −1 m | 1.6 | 4.7 | 5.8 |
| −2 m | 1.9 | 5.4 | 6.4 | 8.9 |
| −3 m | 2.1 | 6.0 | 6.8 | 9.4 |

A deck whose top is a little above the jump's apex, up to about the capsule's radius (0.185 m), is still stood on: when
the capsule's rounded bottom comes down on its edge, the floor search puts it on top. That is why a sprint tap (0.88 m
apex) lands on a deck 1.0 m up.

**Walking off an edge** without jumping gives a small hop: 1.55 m/s up, keeping at most 6.5 m/s across. Off a 3 m drop
at a sprint the runner lands 4.1 m out after 0.7 s.

**The precision jump**: Precision pressed on the ground at 2.5 m/s or slower crouches and aims (the camera moves over
the shoulder). The charge grows by 1.2 a second, up to 1; the crouch lasts at most 1 s before the runner stands up. Jump
pressed while crouched launches 0.25 s later (as the jump's push off the ground ends), rising at 6.25 m/s
(`precisionJumpSpeed`) and travelling at 6.5 m/s times the charge (at least 0.45 of it): 1.14 m apex, 0.72 s in the
air, 2.15 m on the level from a short crouch to 4.8 m from a full one. Once Jump is pressed the precision jump is
committed: letting go of Jump or Precision before it launches changes nothing. Precision held into a landing balances on
the perch for 0.45 s.

**A stride** (Grab held walking to an edge) carries the runner over a gap onto the first top 2.25–3.5 m ahead in half a
second, landing at its near edge: walked on, strides take gaps of about 1.6–2.95 m one after another, however uneven.

## Sliding

Slide pressed on the ground moving forward faster than 4 m/s, with room ahead, drops into a slide: the capsule lowers by
0.6 m and the slide is kicked along by 1.5 times the speed, at most 6.5 m/s, so a slide from a sprint starts at 12.3
m/s. It brakes at 8.5 m/s² (`slideBraking`) and steers at 80° a second. Slower than 11.5 m/s, a slope (more than 1° off
level) pushes it down and turns it toward downhill; on a level floor it keeps its heading. It ends at 5.9 m/s or slower
on a floor no steeper than 20°: on the level from a sprint it lasts 0.77 s and covers 6.9 m. A jump out of it rises at
4.5 m/s, the whole launch at most 8.5 m/s. Another slide waits 1.8 s.

## Walls

| | |
| --- | --- |
| Wall run | Grab held in the air on the first jump, a wall within 0.35 m of the body's centre to a side (`wallRunReach`). It lasts 0.7 s (`wallRunTime`) whatever the speed, moved by the wall-run take's own travel |
| Distance | 2.35 m along the wall, whatever the speed and whatever the angle it was met at up to 25°, rising about 0.9 m; at a walk too, with Grab pressed after the jump |
| Met at 30° or more | the runner plants on the wall instead, or the run ends at once |
| Jump off a wall run | 2.25 m/s away from the wall (`wallJumpSideSpeed`), 5.85 m/s up (`wallJumpUpSpeed`): 1.0 m apex, landing 3.7 m on and 1.6 m out after 0.78 s |
| Wall kick | off a wall ahead: 5.85 m/s back (`wallKickSpeed`), 6.5 m/s up (`wallKickUpSpeed`), 0.15 s after the press (`wallKickDelay`) |

## Obstacles and ledges

What gets over a block met square-on at a sprint (measured on blocks 0.4 m and 3 m deep, which behave the same; the jump
taken 0.3 to 2.5 m before the face, Grab pressed after takeoff):

| Height | What gets over or onto it |
| --- | --- |
| up to 0.3 m | running: it is a step |
| 0.4–0.6 m | a jump; Grab alone does not |
| 0.7 m | a jump, or Grab held with Jump pressed (a vault) from some distances: its top is right at the vault's lowest look |
| 0.75–0.9 m | Grab held with a trick button pressed vaults it (Jump the dash vault, Flip the speed, Wheel the kong); Grab alone hops onto 0.8–0.9 m; a jump clears it; Jump held into it is the power jump |
| 1.0–1.2 m | Grab held with a trick button pressed vaults it; Jump held into it is the power jump; a tap jump (1.0 m) or a full-charge jump, then Grab |
| 1.3 m | only a full-charge jump, then Grab |
| 1.4–1.5 m | a tap jump then Grab catches the edge and hangs; a full charge from 1.3 m or further back clears it |
| 1.6–1.7 m | Grab alone hops onto it; a jump then Grab hangs; a full charge clears it |
| 1.8–2.4 m | a full-charge jump then Grab catches and hangs (above 2 m only from some takeoff distances) |
| 2.5–2.8 m | nothing |
| 2.9–3.0 m | Grab alone runs up the wall to hang from the edge |
| 3.1–3.9 m | a jump then Grab runs up the wall to hang |
| 4.0 m and up | only a full charge from the right distance |

From a hang, Jump with forward held climbs up (given room on top), carrying the body 1.95 m up and 0.35 m forward over
0.3 s. The runner hangs 0.9 m below the top. A catch pulls the body to hang over 0.2 s; running up a wall to a high edge
takes 0.7 s; a leap from one ledge to another 0.5 s. Falling faster than 15.5 m/s onto a ledge (about a 7 m fall) bails
instead of catching. A vault carries the body over the obstacle in 0.25 s; the power jump off an obstacle leaves rising
at 8.25 m/s.

## Poles, bars, pipes, ziplines

| | |
| --- | --- |
| Pole | caught with Grab held near one; slides down at 8 m/s and turns round it at 1.5 m/s; a kick off leaves toward the steer |
| Bar | met in the air within 50° of head-on, falling no faster than 15.5 m/s: it settles 0.15 s, holds 0.38 s, then launches 5.85 m/s forward and 4.25 m/s up |
| Drainpipe | climbs at 2 m/s (`pipeClimbSpeed`), slides down at 4 m/s (`pipeSlideSpeed`); a jump off leaves 4.5 m/s along the steer and 4.6 m/s up |
| Zipline | caught where the runner meets it, keeping its speed along the cable, and gathers speed to 8.5 m/s (`ziplineSpeed`); the end throws the runner off at 8 m/s forward and 1.25 m/s up |

## Landings and falls

The fall speed at touchdown decides the landing (from rest, a fall of h metres lands at √(2 · 17.15 · h) m/s):

| Fall (feet) | Lands at | Without a roll | With Jump held into the landing |
| --- | --- | --- | --- |
| under 2.1 m | slower than 8.5 m/s | lands running | a landing roll |
| 2.1–4.55 m | 8.5–12.5 m/s | a hard landing: a 0.58 s roll-out that carries 1.6 m | a landing roll |
| 4.55–10 m | 12.5–18.5 m/s | bails (the ragdoll) | a landing roll |
| over 10 m | faster than 18.5 m/s | bails | bails |
| over about 19 m | faster than 25.5 m/s in the air | bails in the air (checked every 0.1 s) | |

A hard landing costs about 0.6 s at a sprint (3.7 m less ground covered in the two seconds after it); a roll about 0.25
s. Jump held in the air keeps the roll window open for 0.35 s after it is let go; let go between the touchdown and the
roll (the step after it), it does not jump, and the roll goes ahead. A landing on a floor between 20° and 70° turns into
a slide; Slide held into a landing at more than 3.5 m/s slides on if there is floor ahead.

Going limp (4) waits 0.205 s, hopping the runner up at 2 m/s into a dive if it was on the ground. The game's own bails
go limp in 0.05 s, with no hop: a fatal fall, a botched landing, a stumble into an obstacle too close to vault, a ledge
or a bar caught too fast. Standing up takes Space held with the body all but still
(under 1.5 m/s), at least 0.2 s into the fall; Space still held as the runner stands does not roll the step onto the
floor.

## The camera

| Third person | |
| --- | --- |
| Where it sits | at rest 2.05 m behind the capsule's centre, 0.66 m above it (1.58 m above the floor) and 0.5 m to the right, looking 8.5° further down than the aim |
| Field of view | 105° across at rest, 115° at speed (`fov` 115°, 10° narrower at rest) |
| Speed zoom | sprinting, sliding, on a zipline or falling faster than 8 m/s: over 1.5 s the arm draws in 0.25 m and the view widens 10° |
| Fall tilt | in the air: over 1.8 s it looks down 25.5° instead of 8.5° |
| Aim zoom | in a precision crouch: over 1 s it moves to 0.41 m above the capsule's centre and 1.75 m behind |
| Following | the follow point closes 43 % of its gap across each 60 Hz frame and 17 % up and down; the arm's root follows it, at most 1.5 m behind; the camera turns toward the aim at 8.9 a second (`cameraTurnRate`). A ledge move asks for a slower follow (`cameraFollowRate` 5.8, `cameraVerticalFollowRate` 3.65), unless the camera lag preference is off |

The distances are the tuning's (`cameraDistance` 3 m, `cameraForward` 1.2 m, `cameraHeight` 0.66 m, `cameraShoulder` 0.5
m); the rest are in `@trizendigital/parkour/data/camera.js`. At a sprint the trailing puts the camera about 2.07 m behind. The third-person
camera never collides with the course.

**First person**: the camera sits 0.15 m ahead of the Y Bot's eyes, with a 142° field of view (`firstPersonFov`).

**Looking**: the mouse turns the view 2.5° a count at a sensitivity of 1 (`mouseSensitivity`), its yaw held to 375° a
second (6.25° a frame at 60 frames a second) whatever the frame rate, so a flick cannot spin the view round; the right
stick turns it at about 117° a second at full push (`stickLookRate` 125°, the stick's travel halved before a 0.2 dead
zone, `lookDeadZone`). The pitch reaches 30° up and 40° down. In the air the mouse draws trick gestures instead, unless
free look is held.
