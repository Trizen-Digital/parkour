/**
 * The level metrics: the numbers a course is built to, as the course tools check them. docs/METRICS.md explains each
 * table (and the rules no tool checks yet); `reach.js` turns them into rules. Metres, seconds, m/s; angles in
 * degrees, as a level designer reads them.
 *
 * These are the design targets the deriving, the route, the validator and the generator share. The runner's own
 * numbers live in its tuning (sim/tuning.js); METRICS.md says how the two compare.
 */

// The runner standing: its height, the reach of a hang (hands on an edge to the soles), the step it walks up without
// a move, and a stride (two strides of run-up before a wallclimb).
const runner = {
	height: 1.8,
	hang: 2.15,
	step: 0.36,
	stride: 1.5,
};

// Real gravity, for jump arcs.
const gravity = 9.81;

// Speeds: a run, a sprint, free-running, top speed, and the build-up curve (speed over time running straight, from a
// sprint up).
const speed = {
	run: 3.0,
	sprint: 3.6,
	freerun: 5.0,
	max: 7.2,
	curve: { t: [ 0, 0.4, 1, 3.5, 7 ], v: [ 3.6, 4.0, 5.2, 6.5, 7.2 ] },
};

// The acceleration up to the build-up curve (m/s²), and what moves do to speed: `add`, `scale`, `min`, `set`.
const momentum = {
	accel: 7,
	moves: {
		speedVault: { add: 0.8 },
		skillRoll: { min: 4 },
		swingRelease: { set: 6 },
		slideExit: { scale: 0.5 },
		landing: { add: - 0.65 },
	},
};

// Running jumps: the gap cleared [ max, comfortable ] by approach speed (columns) and landing rise (rows); Clearly out
// past Max; the rise from which the coil is needed; the landing zone; the run-up; edges caught rather than landed on.
const jump = {
	speeds: [ 0, 3.0, 3.6, 5.0, 7.2 ],
	rises: [ 1, 0.5, 0, - 1, - 2, - 3, - 5 ],
	gap: [
		[ null, null, null, [ 2.0, 1.7 ], [ 3.4, 2.9 ] ],
		[ [ 1.0, 0.9 ], [ 1.7, 1.5 ], [ 2.0, 1.7 ], [ 2.9, 2.4 ], [ 4.4, 3.7 ] ],
		[ [ 1.5, 1.3 ], [ 2.2, 1.9 ], [ 2.6, 2.2 ], [ 3.7, 3.1 ], [ 5.4, 4.6 ] ],
		[ [ 1.9, 1.6 ], [ 2.8, 2.4 ], [ 3.4, 2.9 ], [ 4.6, 3.9 ], [ 6.8, 5.8 ] ],
		[ [ 2.2, 1.9 ], [ 3.3, 2.8 ], [ 3.9, 3.3 ], [ 5.4, 4.6 ], [ 7.8, 6.6 ] ],
		[ [ 2.5, 2.1 ], [ 3.6, 3.1 ], [ 4.3, 3.7 ], [ 6.0, 5.1 ], [ 8.7, 7.4 ] ],
		[ [ 2.9, 2.4 ], [ 4.3, 3.6 ], [ 5.0, 4.3 ], [ 6.9, 5.9 ], [ 10.1, 8.6 ] ],
	],
	clearlyOut: 1.5,
	coil: 0.6,
	landing: { min: 2.5, comfortable: 4, roll: 3.5 },
	runUp: { length: 3 },
	catch: { rise: [ 1.5, 2.7 ] },
};

// Obstacles by height over the feet: the bands and the move in each, at a run (by depth: thin, deep) and walking; the
// run speed; thin and deep tops; the walking climb's limits; clearly unclimbable; landing past a vault over; the
// springboard step; and the margin a Comfortable height keeps from its band's ends.
const obstacle = {
	bands: [
		{ to: 0.36, run: 'step', walk: 'step' },
		{ to: 0.65, run: 'stepUp', walk: 'stepUp' },
		{ to: 1.45, run: [ 'vaultOver', 'vaultOnto' ], walk: 'climbOnto' },
		{ to: 2.2, run: [ 'highVaultOver', 'highVaultOnto' ], walk: 'climbOnto' },
		{ to: 2.8, run: 'wallclimbOver', walk: 'jumpToHang' },
		{ to: 3.6, comfortable: 3.2, run: 'wallclimbHang', walk: null },
	],
	run: 3.5,
	thin: 0.8,
	deep: 1.0,
	climbOnto: 1.9,
	jumpToHang: [ 2.1, 2.6 ],
	unclimbable: 4.2,
	vaultOver: { landing: 1.5, rise: [ - 1.0, 0.3 ] },
	springboard: { step: [ 0.45, 0.85 ], ahead: 1.1, obstacle: [ 0.8, 1.5 ], adds: 1.0 },
	margin: 0.1,
};

// Walls: wallrun (height, approach angle, entry speed, length by speed, corridor width, a clear face) and wallclimb
// (height, facing, run-up).
const wall = {
	run: {
		height: { comfortable: 3.0, max: 1.9 },
		angle: { comfortable: [ 15, 40 ], max: [ 5, 55 ] },
		speed: { comfortable: 3.5, max: 2.0 },
		length: { speed: [ 3.6, 7.2 ], min: [ 4, 8 ], max: [ 5, 10 ] },
		corridor: { comfortable: [ 3, 4 ], max: [ 2.5, 4.5 ] },
		clear: [ 0.3, 2.6 ],
	},
	climb: {
		height: { comfortable: 2.5, max: 1.8 },
		facing: { comfortable: 20, max: 33 },
		runUp: { comfortable: { length: 3, speed: 3 }, max: { strides: 2 } },
	},
};

// Ledges: hanging, climbing onto, a braced hang, the shimmy, grab transfers, narrow ledges.
const ledge = {
	hang: { depth: 0.15, drop: 2.1, length: 0.4 },
	climb: { depth: 0.6, headroom: 1.0, stand: 2.0 },
	braced: { gap: 0.3, face: 1.0 },
	shimmy: { gap: 0.3, speed: 0.55 },
	transfer: { up: 1.4, plan: 0.3 },
	narrow: { depth: [ 0.15, 0.4 ], wall: 2.0, chest: 0.25 },
};

// Drainpipes: diameter, gap off the wall, lean from vertical (°).
const pipe = {
	diameter: [ 0.08, 0.2 ],
	wallGap: [ 0.1, 0.25 ],
	tilt: 5,
};

// Climbing: how high a pipe's or ladder's foot may be over the ground (a jump onto it), and the climb's speed.
const climb = {
	jump: { rise: [ - 1.0, 1.5 ] },
	up: 0.6,
};

// Ladders: rung spacing (and the range that works), width, and the rails' height past the top.
const ladder = {
	rungs: 0.3,
	rungRange: [ 0.26, 0.34 ],
	width: [ 0.4, 0.6 ],
	rails: 1.0,
};

// Swing bars: height over the take-off, width, clearance under the swing, approach speed, where the release lands,
// bar to bar.
const bar = {
	height: { comfortable: 2.4, max: [ 2.0, 2.8 ] },
	width: 1.0,
	clear: 2.4,
	speed: 3,
	release: { forward: [ 3, 5 ], below: [ 1, 4 ] },
	barToBar: { distance: [ 3, 4.5 ], height: 0.5 },
};

// Ziplines: slope (°), the cable's height over the catch, the fastest fall caught, clearance under, landing length.
const zipline = {
	slope: [ 5, 25 ],
	catch: [ 2.0, 2.6 ],
	maxFall: 6,
	clear: 2.4,
	landing: 4,
};

// Balance beams: width (narrower is a wire, wider is run along), speed on them, getting on.
const balance = {
	width: [ 0.05, 0.25 ],
	speed: 2.5,
	getOn: { rise: 0.3, jump: 2.0 },
};

// Slides and low passages: the slide's speed, the clearance a slide under needs, a crouch, a crawl.
const slide = {
	speed: 3.5,
	under: { comfortable: 1.3, max: 1.0 },
	crouch: 1.3,
	crawl: 0.7,
};

// Slopes (°): walked up to, slid down up to; the level run-out a slide slope needs at its foot.
const slope = {
	walk: 40,
	slide: 60,
	runOut: 3,
};

// Falls: landed running below `run`, a deep landing below `deep`, a hard one up to `hard`, fatal beyond.
const landing = {
	run: 2,
	deep: 5.3,
	hard: 10,
};

// Doors: width, height, the barge (speed from which, speed added, top), the kick's time.
const door = {
	width: [ 0.9, 1.2 ],
	height: [ 2.1, 2.4 ],
	barge: { speed: 2.5, add: 2, max: 5 },
	kick: 0.6,
};

// Valves and buttons: height of the centre, room to stand in front.
const switches = { height: [ 1.0, 1.5 ], room: 1.0 };

// Building rules: headroom over running lanes and over jump arcs.
const level = {
	headroom: { lane: 2.5, arc: 3.5 },
};

/**
 * What each kind of surface looks like: its `graybox` hue (each kind its own, so a level reads while it is built) and
 * its Runner Vision colour (whites and greys, which the look turns `red` where something is usable); and the width of
 * the stripe along a hangable edge (m).
 */
export const colors = {
	red: 0xd8282b,
	stripe: 0.1,
	surfaces: {
		top: { graybox: 0xf2f2ef, vision: 0xf2f2ef },
		face: { graybox: 0xd6d7d5, vision: 0xd6d7d5 },
		out: { graybox: 0x8c8f91, vision: 0x8c8f91 },
		noRun: { graybox: 0x4a4d50, vision: 0x4a4d50 },
		edge: { graybox: 0xf2c12e, vision: 0xf2f2ef },
		vault: { graybox: 0xef7b2a, vision: 0xd6d7d5 },
		wall: { graybox: 0x2f6fd0, vision: 0xf2f2ef },
		climb: { graybox: 0x3fa34d, vision: 0xd6d7d5 },
		swing: { graybox: 0xc8479b, vision: 0xd6d7d5 },
		balance: { graybox: 0x1fa3a0, vision: 0xd6d7d5 },
		slide: { graybox: 0x7fc4e8, vision: 0xf2f2ef },
		interact: { graybox: 0xd8282b, vision: 0xd8282b },
		hazard: { graybox: 0x1e1e1e, vision: 0x1e1e1e, chevrons: 0xf2c12e },
	},
};

/** The whole table. */
export const metrics = {
	runner, gravity, speed, momentum, jump, obstacle, wall, ledge, pipe, climb, ladder, bar, zipline, balance,
	slide, slope, landing, door, switches, level, colors,
};
