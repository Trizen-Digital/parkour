// The golden tapes' scenarios: what a player does on which course, as timed inputs (tape.mjs turns each into raw input
// frames). FEATURES exercise one feature each (moves, the gamepad, first person, slow motion, the ragdoll, 144 Hz, and
// the moves no lane reaches: vaults, hops, tricks, ledge corners, the pole, bars, wall kicks, the perch slip, the slide
// under); COURSES run the family courses' lanes and the generated courses with the same pattern of presses.
//
//   node tools/headless/golden.mjs tapes [filter]

const W = 'KeyW', A = 'KeyA', S = 'KeyS', D = 'KeyD', SHIFT = 'ShiftLeft', SPACE = 'Space';
const E = 'KeyE', R = 'KeyR', F = 'KeyF', G = 'KeyG', T = 'KeyT', X = 'KeyX', C = 'KeyC', BAIL = 'Digit4';
const LMB = 0, RMB = 2;

// A standard pad's state for a span of frames: the sticks' axes, the buttons held (by index), the triggers' values.
function pad( axes = [ 0, 0, 0, 0 ], held = [], triggers = {} ) {

	const buttons = Array.from( { length: 17 }, ( _, i ) => {

		const value = triggers[ i ] ?? ( held.includes( i ) ? 1 : 0 );
		return [ value > 0.5 ? 1 : 0, value ];

	} );
	return { id: 'Test pad (STANDARD GAMEPAD)', axes, buttons };

}

// The runner stands with its capsule centre this far above the floor (the spawn height every course uses).
const STAND = 0.9215;

// Mouse flicks read as trick gestures while falling (one frame, 5 counts: over the 1.5 threshold, under 25). The tape's
// mouse y is the browser's (down positive); the game flips it, so "up" is a negative y here.
const UP = [ 0, - 5 ], LEFT = [ - 5, 0 ], RIGHT = [ 5, 0 ];

// A trick button pressed with a gesture, in one frame.
const trick = ( at, key, gesture ) => [ { at, until: at + 0.02, mouse: gesture }, { at, until: at + 0.05, keys: [ key ] } ];

// A jump fires when Space is let go; holding it charges the jump (0.75 → 1 at 0.5 /s), which buys the air time a
// trick needs to finish before touchdown.
const jump = ( at, hold = 0.05 ) => ( { at: at - hold, until: at, keys: [ SPACE ] } );

const FEATURES = [
	{ name: 'feature-bail-high', course: 'test_landings', start: { spawn: 8 }, seconds: 8, inputs: [
		{ at: 0.2, until: 3.0, keys: [ W, SHIFT ] },
		{ at: 1.2, until: 1.5, keys: [ SPACE ] },
		{ at: 1.7, until: 1.8, keys: [ BAIL ] },
		{ at: 6.0, until: 7.5, keys: [ W ] }
	] },
	{ name: 'feature-idle', course: 'test_basic', start: { spawn: 0 }, seconds: 2, inputs: [] },
	{ name: 'feature-walk-sprint-brake', course: 'test_ground', start: { spawn: 1 }, seconds: 6, jitter: 0.004, inputs: [
		{ at: 0.5, until: 2.0, keys: [ W ] },
		{ at: 2.0, until: 4.5, keys: [ W, SHIFT ] }
	] },
	{ name: 'feature-turns-and-look', course: 'test_ground', start: { spawn: 6 }, seconds: 6, jitter: 0.003, inputs: [
		{ at: 0.3, until: 5, keys: [ W, SHIFT ] },
		{ at: 1, until: 2, mouse: [ 6, 0 ] },
		{ at: 2.5, until: 3.2, keys: [ A ] },
		{ at: 3.5, until: 4.5, mouse: [ - 4, 1 ] }
	] },
	{ name: 'feature-jumps-144hz', course: 'test_ground', start: { spawn: 12 }, seconds: 7, dt: 1 / 144, inputs: [
		{ at: 0.3, until: 6, keys: [ W, SHIFT ] },
		{ at: 1.0, until: 1.05, keys: [ SPACE ] },
		{ at: 2.6, until: 3.1, keys: [ SPACE ] },
		{ at: 4.5, until: 4.52, keys: [ SPACE ] }
	] },
	{ name: 'feature-run-and-grab', course: 'test_slopes', start: { spawn: 4 }, seconds: 8, jitter: 0.005, inputs: [
		{ at: 0.2, until: 7, keys: [ W, SHIFT ] },
		{ at: 2, until: 2.6, mouse: [ - 5, 0 ] },
		{ at: 3.5, until: 3.6, keys: [ SPACE ] },
		{ at: 5, until: 5.4, buttons: [ 0 ] }
	] },
	{ name: 'feature-air-tricks', course: 'test_ground', start: { spawn: 1 }, seconds: 7, jitter: 0.004, inputs: [
		{ at: 0.2, until: 6.5, keys: [ W, SHIFT ] },
		{ at: 1.0, until: 1.5, keys: [ SPACE ] },
		{ at: 1.7, until: 1.75, keys: [ F ] },
		{ at: 3.2, until: 3.7, keys: [ SPACE ] },
		{ at: 3.9, until: 3.95, keys: [ R ] },
		{ at: 5.0, until: 5.5, keys: [ SPACE ] },
		{ at: 5.6, until: 5.9, keys: [ G ], mouse: [ 0, - 6 ] }
	] },
	{ name: 'feature-slide-and-roll', course: 'test_ground', start: { spawn: 6 }, seconds: 7, inputs: [
		{ at: 0.2, until: 6, keys: [ W, SHIFT ] },
		{ at: 1.8, until: 2.6, keys: [ X ] },
		{ at: 3.5, until: 4.1, keys: [ SPACE ] },
		{ at: 4.3, until: 4.6, keys: [ SPACE ] },
		{ at: 5.0, until: 5.1, keys: [ T ] }
	] },
	{ name: 'feature-precision', course: 'test_basic', start: { spawn: 0 }, seconds: 6, jitter: 0.003, inputs: [
		{ at: 0.2, until: 1.2, keys: [ W ] },
		{ at: 1.3, until: 2.4, keys: [ E ] },
		{ at: 1.6, until: 2.3, keys: [ SPACE ] },
		{ at: 2.5, until: 3.2, keys: [ E ] },
		{ at: 3.5, until: 5, keys: [ W, SHIFT ] }
	] },
	{ name: 'feature-bail-ragdoll-recover', course: 'test_ground', start: { spawn: 12 }, seconds: 8, inputs: [
		{ at: 0.2, until: 2.5, keys: [ W, SHIFT ] },
		{ at: 1.5, until: 1.6, keys: [ BAIL ] },
		{ at: 2.6, until: 3.4, mouse: [ 3, 0 ] },
		{ at: 5.0, until: 5.2, keys: [ SPACE ] },
		{ at: 6.0, until: 7.5, keys: [ W ] }
	] },
	{ name: 'feature-slowmo', course: 'test_ground', start: { spawn: 1 }, seconds: 7, jitter: 0.005, inputs: [
		{ at: 0.2, until: 6.5, keys: [ W, SHIFT ] },
		{ at: 1.0, until: 2.5, buttons: [ RMB ] },
		{ at: 3.5, until: 4.0, keys: [ SPACE ] },
		{ at: 3.6, until: 4.4, buttons: [ RMB ] }
	] },
	{ name: 'feature-first-person', course: 'test_basic', start: { spawn: 0 }, seconds: 6, inputs: [
		{ at: 0.3, until: 0.35, keys: [ C ] },
		{ at: 0.5, until: 4, keys: [ W ] },
		{ at: 1, until: 2, mouse: [ 5, - 2 ] },
		{ at: 2.2, until: 2.25, mouse: [ 0, 0, 1 ] },
		{ at: 2.6, until: 2.65, mouse: [ 0, 0, - 1 ] },
		{ at: 3, until: 3.5, keys: [ SPACE ] },
		{ at: 4.5, until: 4.55, keys: [ C ] }
	] },
	{ name: 'feature-climb-walls', course: 'test_wallruns', start: { spawn: 4 }, seconds: 9, jitter: 0.004, inputs: [
		{ at: 0.2, until: 8.5, keys: [ W, SHIFT ] },
		{ at: 0.2, until: 8.5, buttons: [ LMB ] },
		{ at: 2.0, until: 2.5, keys: [ SPACE ] },
		{ at: 4.0, until: 4.6, keys: [ SPACE ] },
		{ at: 5.5, until: 6.0, mouse: [ 4, 0 ] },
		{ at: 6.5, until: 7.0, keys: [ SPACE ] }
	] },
	{ name: 'feature-combo-spin-dive', course: 'test_ground', start: { spawn: 6 }, seconds: 6, inputs: [
		{ at: 0.2, until: 5, keys: [ W, SHIFT ] },
		{ at: 1.0, until: 1.5, keys: [ SPACE ] },
		{ at: 1.7, until: 1.75, keys: [ F ] },
		{ at: 1.85, until: 1.9, keys: [ T ] },
		{ at: 3.0, until: 3.4, keys: [ SPACE ] },
		{ at: 3.5, until: 3.55, keys: [ F ] },
		{ at: 3.6, until: 3.65, keys: [ T ] }
	] },
	{ name: 'feature-gamepad', course: 'test_vaults', start: { spawn: 5 }, seconds: 9, jitter: 0.004, inputs: [
		{ at: 0.2, until: 2.0, pad: pad( [ 0, - 1, 0, 0 ], [], { 7: 1 } ) },
		{ at: 2.0, until: 2.4, pad: pad( [ 0, - 1, 0.6, 0 ], [ 0 ], { 7: 1 } ) },
		{ at: 2.4, until: 4.0, pad: pad( [ 0.3, - 0.9, 0, 0 ], [], { 6: 1, 7: 1 } ) },
		{ at: 4.0, until: 4.1, pad: pad( [ 0, - 1, 0, 0 ], [ 1 ], { 7: 1 } ) },
		{ at: 4.1, until: 6.0, pad: pad( [ - 0.2, - 0.35, 0, - 0.4 ], [] ) },
		{ at: 6.0, until: 6.5, pad: pad( [ 0, - 1, 0, 0 ], [ 0 ], { 7: 0.6 } ) },
		{ at: 6.5, until: 8.5, pad: pad( [ 0, - 1, 0, 0 ], [ 4 ], { 7: 1 } ) }
	] },
	{ name: 'feature-explore', course: 'generated-99', start: { spawn: 0 }, seconds: 10, jitter: 0.006, inputs: [
		{ at: 0.2, until: 9.5, keys: [ W, SHIFT ] },
		{ at: 1.5, until: 3.5, buttons: [ LMB ] },
		{ at: 2.0, until: 2.6, keys: [ SPACE ] },
		{ at: 4.0, until: 5.0, mouse: [ - 3, 0 ] },
		{ at: 5.5, until: 6.1, keys: [ SPACE ] },
		{ at: 6.5, until: 8.0, buttons: [ LMB ] },
		{ at: 7.0, until: 7.4, keys: [ SPACE ] }
	] },

	{
		name: 'feature-vault-kong-speed',
		about: 'test_vaults, the 0.8 m thin block: kong vault over it (grab + wheel held), turn round, speed vault back (grab + flip held).',
		course: 'test_vaults',
		// 0.4 m to +x of the lane's centre: a turn round drifts the run about 0.75 m to -x (the block is 3 m wide).
		start: { position: [ 25.9, STAND, 0.5 ], yaw: 0 },
		seconds: 6.5,
		inputs: [
			{ at: 0.2, until: 2.4, keys: [ W, SHIFT ] },
			{ at: 0.2, until: 2.4, buttons: [ LMB ] },
			{ at: 0.3, until: 2.4, keys: [ R ] },
			// Stop on the far side, then turn round from a standstill (S alone turns on the spot more than it runs).
			{ at: 3.0, until: 3.6, keys: [ S ] },
			{ at: 3.6, until: 6.0, keys: [ S, SHIFT ] },
			{ at: 4.0, until: 5.4, buttons: [ LMB ] },
			{ at: 4.0, until: 5.4, keys: [ F ] }
		]
	},

	{
		name: 'feature-vault-speed-dash-power',
		about: 'test_vaults, the 0.8 m thin block: speed vault (grab + flip held), turn, dash vault back (grab and Space pressed together inside the vault probe\'s reach), turn, power jump over it (Space held into the approach).',
		course: 'test_vaults',
		// Two turns round this time, each drifting the run about 0.75 m to -x: 0.7 m to +x of the lane's centre.
		start: { position: [ 26.2, STAND, 0.5 ], yaw: 0 },
		seconds: 12,
		inputs: [
			{ at: 0.2, until: 3.4, keys: [ W, SHIFT ] },
			{ at: 0.2, until: 2.4, buttons: [ LMB ] },
			{ at: 0.3, until: 2.4, keys: [ F ] },
			// Off the speed vault, run on to z 15 for a run-up back.
			{ at: 4.0, until: 4.6, keys: [ S ] },
			{ at: 4.6, until: 7.0, keys: [ S, SHIFT ] },
			// Hair: the dash vault is Space *pressed* with grab held, while the block's face is 1.0-2.1 m ahead
			// (z 10.98 → 9.91 running back at 5.85 m/s, 5.65 s → 5.83 s). Held Space instead starts the power jump.
			{ at: 5.75, until: 7.0, buttons: [ LMB ] },
			{ at: 5.75, until: 5.85, keys: [ SPACE ] },
			{ at: 8.0, until: 8.6, keys: [ W ] },
			{ at: 8.6, until: 11.5, keys: [ W, SHIFT ] },
			// Space held while running at the block (no grab): the power jump's approach, then its jump off the top.
			{ at: 9.0, until: 10.2, keys: [ SPACE ] }
		]
	},

	{
		name: 'feature-hops',
		about: 'test_basic\'s vault lane, grab held: hop onto the 0.9 m wall, walk off, Space held into the 1.2 m wall (a low obstacle, as vaults reach 1.2 m: the power jump\'s approach hops onto it and leaps off), then the high hop onto the 1.7 m wall and off it.',
		course: 'test_basic',
		start: { position: [ - 21, STAND, 6 ], yaw: 0 },
		seconds: 7.5,
		inputs: [
			{ at: 0.2, until: 6.6, keys: [ W, SHIFT ] },
			{ at: 0.2, until: 2.4, buttons: [ LMB ] },
			// Pressed once landed off the 0.9 m wall (held in the air it would arm the landing roll), and held until the
			// 1.2 m wall is 2.06 m ahead, inside the low obstacle scan's reach: the power jump's approach. Grab is off: a
			// jump never fires with it held.
			{ at: 2.65, until: 3.2, keys: [ SPACE ] },
			{ at: 3.5, until: 6.6, buttons: [ LMB ] }
		]
	},

	{
		name: 'feature-ground-tricks',
		about: 'test_ground, a 100 m clear line along +x: cartwheel, the spin-dive combo (flip then dive within 0.5 s) into a dive roll, the plain dive into a dive roll, then another cartwheel.',
		course: 'test_ground',
		start: { position: [ - 4, STAND, 18 ], yaw: Math.PI / 2 },
		seconds: 15,
		inputs: [
			{ at: 0.2, until: 14.6, keys: [ W, SHIFT ] },
			{ at: 1.2, until: 1.25, keys: [ R ] },
			// Flip then dive within half a second: the spin dive (a combo the bindings make, on the ground at a sprint).
			{ at: 7.5, until: 7.55, keys: [ F ] },
			{ at: 7.7, until: 7.75, keys: [ T ] },
			// Dive let go on its own: the plain dive.
			{ at: 10.0, until: 10.05, keys: [ T ] },
			// The cartwheel wants 4.55 m/s, which the run is back to 0.75 s after the dive roll.
			{ at: 12.8, until: 12.85, keys: [ R ] }
		]
	},

	{
		name: 'feature-air-trick-combos',
		about: 'test_landings, off the 5.3 m roof: front flip, then the repeat in the same air, Space held for the landing roll; turned along +x, three running jumps: side flip, vortex, spin.',
		course: 'test_landings',
		start: { spawn: 4 },
		seconds: 11,
		inputs: [
			{ at: 0.2, until: 10.4, keys: [ W, SHIFT ] },
			jump( 1.0 ),
			...trick( 1.25, R, UP ),
			// The front flip opens the air combo 0.5 s in.
			...trick( 1.8, R, UP ),
			// Space held in the air arms the landing roll (a 5.3 m drop is a bail without it).
			{ at: 2.2, until: 2.9, keys: [ SPACE ] },
			// A quarter turn left on the ground (the look is ignored in the air): 4 counts a frame for 0.24 s.
			{ at: 3.4, until: 3.64, mouse: [ - 4, 0 ] },
			jump( 5.0, 0.4 ), ...trick( 5.25, F, UP ),
			jump( 7.0, 0.4 ), ...trick( 7.25, F, RIGHT ),
			jump( 9.0, 0.4 ), ...trick( 9.25, F, LEFT )
		]
	},

	{
		name: 'feature-air-backflip',
		about: 'test_landings, off the 5.3 m roof: the backflip button with an up gesture in the air (the running backflip, a trick too long for a jump on the flat), Space held for the landing roll.',
		course: 'test_landings',
		start: { spawn: 4 },
		seconds: 4,
		inputs: [
			{ at: 0.2, until: 3.6, keys: [ W, SHIFT ] },
			jump( 1.0 ),
			...trick( 1.25, G, UP ),
			// Pressed only after the trick has begun: a held Space key turns the backflip button off.
			{ at: 1.9, until: 3.2, keys: [ SPACE ] }
		]
	},

	{
		name: 'feature-ledge-shimmy-corner-climb',
		about: 'test_ledges lane 1, the braced 3.2 m edge: running jump and grab to the hang, shimmy left (A held) to the outside corner, the leap round it onto the side face, shimmy right (D held) back to the corner, the leap round it onto the front face, a little further right, climb up.',
		course: 'test_ledges',
		start: { spawn: 1 },
		seconds: 11,
		inputs: [
			{ at: 0.2, until: 1.9, keys: [ W, SHIFT ] },
			// Jump first, grab after: a jump never fires with grab held. Caught rising, 1.1 m off the floor.
			{ at: 1.2, until: 1.3, keys: [ SPACE ] },
			{ at: 1.35, until: 10.5, buttons: [ LMB ] },
			{ at: 3.5, until: 6.5, keys: [ A ] },
			// The side face's corner is 0.4 m to the right: the leap back comes at once, then the shimmy goes on.
			{ at: 7.0, until: 8.5, keys: [ D ] },
			// Up (W held) and jump climbs up.
			{ at: 9.0, until: 9.5, keys: [ W ] },
			{ at: 9.1, until: 9.2, keys: [ SPACE ] }
		]
	},

	{
		name: 'feature-pole',
		about: 'test_basic, from the top of the 4.5 m tower: a running jump past the rope post 0.4 m to its side, grab (the post\'s grab box), slide down it, jump off it sideways (Space let go with D held).',
		course: 'test_basic',
		// On the tower, level with the post; 0.4 m to the side so the frontal wall probe misses the post (head on it
		// slaps the post as a wall before the 50 ms the grab box takes to register).
		start: { position: [ 5, 4.5 + STAND, 20.4 ], yaw: Math.PI / 2 },
		seconds: 4.5,
		inputs: [
			{ at: 0.2, until: 1.9, keys: [ W, SHIFT ] },
			{ at: 0.9, until: 1.0, keys: [ SPACE ] },
			{ at: 1.1, until: 2.05, buttons: [ LMB ] },
			// Held in the air, let go on the pole: the jump off it. Grab let go in the same frame so nothing grabs back.
			{ at: 1.7, until: 2.05, keys: [ SPACE ] },
			// Sideways, or the jump goes straight into the post.
			{ at: 1.95, until: 2.6, keys: [ D ] }
		]
	},

	{
		name: 'feature-precision-perch-slip',
		about: 'test_basic\'s balance beam (0.1 m wide, 1 m up): precision jump from the start block onto the beam (a clean perch), a step and a 4° turn, a second precision jump that lands 0.15 m off the beam\'s centre: the perch slips.',
		course: 'test_basic',
		start: { position: [ 15, 1 + STAND, 41.2 ], yaw: 0 },
		seconds: 6.5,
		inputs: [
			// Precision pressed standing (the crouch), Space (the jump), precision kept held for the perch landing.
			{ at: 0.3, until: 2.0, keys: [ E ] },
			{ at: 0.8, until: 0.9, keys: [ SPACE ] },
			// Hair: 1.2 counts turns the look 3°; the step turns the body 4°; the 2.5 m jump then lands at x 14.85,
			// mid-way in the 14.77-14.90 band where the capsule still lands on the beam but one foot has nothing under it.
			{ at: 2.9, until: 2.92, mouse: [ 1.2, 0 ] },
			{ at: 3.0, until: 3.2, keys: [ W ] },
			{ at: 3.8, until: 5.0, keys: [ E ] },
			{ at: 4.1, until: 4.2, keys: [ SPACE ] }
		]
	},

	{
		name: 'feature-wallrun-ticktack-kick',
		about: 'test_basic\'s 3.5 m wall-run corridor: wall run on the right wall, the turning jump off it (flip let go: a quarter turn and a push across), a slap on the opposite wall, the wall kick off that (flip let go again).',
		course: 'test_basic',
		// 0.35 m from the right wall's face, inside the wall-run probe.
		start: { position: [ - 4.4, STAND, - 3 ], yaw: 0 },
		seconds: 5,
		inputs: [
			{ at: 0.2, until: 4.5, keys: [ W, SHIFT ] },
			{ at: 1.6, until: 1.7, keys: [ SPACE ] },
			// Grab let go before the far wall, or it wall-runs that one instead of slapping it.
			{ at: 1.8, until: 2.2, buttons: [ LMB ] },
			{ at: 1.9, until: 2.1, keys: [ F ] },
			{ at: 2.4, until: 2.9, keys: [ F ] }
		]
	},

	{
		name: 'feature-wall-kick',
		about: 'test_wallruns lane 20 (a 4.2 m wall head on): running jump into it, the slap, flip let go on it: the wall kick back off it.',
		course: 'test_wallruns',
		start: { spawn: 20 },
		seconds: 4,
		inputs: [
			{ at: 0.2, until: 3.5, keys: [ W, SHIFT ] },
			// Let go 2.3 m short of the wall: still rising when it meets it.
			{ at: 1.4, until: 1.5, keys: [ SPACE ] },
			// Flip pressed in the air (no gesture: no trick), let go on the wall.
			{ at: 1.7, until: 2.0, keys: [ F ] }
		]
	},

	{
		name: 'feature-wallrun-jump',
		about: 'test_wallruns lane 18 (3.5 m wall at 20°): running jump, grab, wall run, Space on the wall: the jump off it.',
		course: 'test_wallruns',
		start: { spawn: 18 },
		seconds: 4.5,
		inputs: [
			{ at: 0.2, until: 4.2, keys: [ W, SHIFT ] },
			// Let go 2.05 s in: the wall run then starts where a nudge to the jump or the run moves it least.
			{ at: 1.95, until: 2.05, keys: [ SPACE ] },
			{ at: 2.15, until: 4.0, buttons: [ LMB ] },
			{ at: 2.5, until: 2.6, keys: [ SPACE ] }
		]
	},

	{
		name: 'feature-wallrun-dive',
		about: 'test_wallruns lane 19 (3.5 m wall at 20°): wall run, dive pressed on the wall: the dive off it, into a dive roll.',
		course: 'test_wallruns',
		start: { spawn: 19 },
		seconds: 4.5,
		inputs: [
			{ at: 0.2, until: 4.2, keys: [ W, SHIFT ] },
			// Let go 2.05 s in: the wall run then starts where a nudge to the jump or the run moves it least.
			{ at: 1.95, until: 2.05, keys: [ SPACE ] },
			{ at: 2.15, until: 4.0, buttons: [ LMB ] },
			{ at: 2.5, until: 2.6, keys: [ T ] }
		]
	},

	{
		name: 'feature-slide-under',
		about: 'test_ground lane 11: slide (X held at a sprint) under the bar 1.0 m up.',
		course: 'test_ground',
		start: { spawn: 11 },
		seconds: 4,
		inputs: [
			// Stopped before the floor's end at z 24.
			{ at: 0.2, until: 3.2, keys: [ W, SHIFT ] },
			// Begun 4 m short of the bar: the slide's own clearance probe looks 0.8 m ahead at chest height.
			{ at: 1.7, until: 2.7, keys: [ X ] }
		]
	},

	{
		name: 'feature-bar-to-bar',
		about: 'test_bars lane 8: running jump off the roof edge to the first bar, swing, let go at the forward apex, catch the second bar 3 m on, swing, let go onto the far roof.',
		course: 'test_bars',
		start: { spawn: 8 },
		seconds: 5.5,
		inputs: [
			{ at: 0.2, until: 5, keys: [ W, SHIFT ] },
			{ at: 2.0, until: 2.1, keys: [ SPACE ] },
			{ at: 2.15, until: 5.0, buttons: [ LMB ] }
		]
	}

];

// A run along each of a course's lanes: sprint with grab held, four jumps (their timing varying from lane to lane),
// a turn of the mouse at 3 s.
function courseTapes( course, lanes, seconds = 7 ) {

	return lanes.map( ( lane, i ) => ( {
		name: `${course}-lane${lane}`,
		course,
		start: { spawn: lane },
		seconds,
		jitter: 0.004 * ( i % 3 ),
		inputs: [
			{ at: 0.2, until: seconds - 0.5, keys: [ W, SHIFT ] },
			{ at: 0.2, until: seconds - 0.5, buttons: [ LMB ] },
			...[ 1.2, 2.4, 3.6, 4.8 ].map( ( t ) => ( { at: t + 0.13 * ( i % 4 ), until: t + 0.13 * ( i % 4 ) + 0.3 + 0.1 * ( i % 2 ), keys: [ SPACE ] } ) ),
			{ at: 3, until: 3.4, mouse: [ ( i % 2 ? 2 : - 2 ), 0 ] }
		]
	} ) );

}

// test_basic's props: the bar swing, the pole, the pipe, the zipline, the rope, the ladder, and the door with the valve
// and the button beside it.
const PROPS = [
	{ name: 'test_basic-swing', course: 'test_basic', start: { position: [ 15, 0.9215, 3.4 ], yaw: 0 }, seconds: 6, inputs: [
		{ at: 0.2, until: 1.3, keys: [ W, SHIFT ] },
		{ at: 0.75, until: 0.85, keys: [ SPACE ] },
		{ at: 0.9, until: 3.5, buttons: [ LMB ] },
		{ at: 1.3, until: 2.0, keys: [ W ] }
	] },
	{ name: 'test_basic-pole', course: 'test_basic', start: { position: [ 13.5, 0.9215, 17.5 ], yaw: 0 }, seconds: 5, jitter: 0.003, inputs: [
		{ at: 0.2, until: 1.0, keys: [ W ] },
		{ at: 0.8, until: 0.9, keys: [ SPACE ] },
		{ at: 1.0, until: 3, buttons: [ LMB ] }
	] },
	{ name: 'test_basic-pipe', course: 'test_basic', start: { position: [ 4.5, 0.9215, 15.5 ], yaw: 0 }, seconds: 8, inputs: [
		{ at: 0.2, until: 1.2, keys: [ W ] },
		{ at: 0.2, until: 7, buttons: [ LMB ] },
		{ at: 1.0, until: 1.3, keys: [ SPACE ] },
		{ at: 1.6, until: 5.5, keys: [ W ] },
		{ at: 6.0, until: 6.4, keys: [ SPACE ] }
	] },
	{ name: 'test_basic-zipline', course: 'test_basic', start: { position: [ 6, 5.4215, 21.0 ], yaw: 0 }, seconds: 8, inputs: [
		{ at: 0.2, until: 1.1, keys: [ W ] },
		{ at: 0.9, until: 1.0, keys: [ SPACE ] },
		{ at: 1.12, until: 4.5, buttons: [ LMB ] }
	] },
	// Caught on the run, pumped forward, pushed sideways, then leapt off.
	{ name: 'test_basic-rope', course: 'test_basic', start: { position: [ 15, STAND, 12 ], yaw: 0 }, seconds: 7, inputs: [
		{ at: 0.2, until: 1.45, keys: [ W, SHIFT ] },
		jump( 1.45 ),
		{ at: 1.5, until: 4.8, buttons: [ LMB ] },
		{ at: 1.6, until: 2.5, keys: [ W ] },
		{ at: 2.5, until: 3.2, keys: [ A ] },
		{ at: 4.6, until: 4.7, keys: [ SPACE ] }
	] },
	// Up the ladder, a slide back down a little, and up and out at the top.
	{ name: 'test_basic-ladder', course: 'test_basic', start: { position: [ 7, STAND, 15.5 ], yaw: 0 }, seconds: 8, inputs: [
		{ at: 0.2, until: 2.6, keys: [ W ] },
		{ at: 0.2, until: 6, buttons: [ LMB ] },
		{ at: 2.8, until: 3.1, keys: [ S ] },
		{ at: 3.4, until: 7.5, keys: [ W ] }
	] },
	// Barged through at a sprint; the door shuts behind once the runner is clear.
	{ name: 'test_basic-door-barge', course: 'test_basic', start: { position: [ 28, STAND, 37 ], yaw: 0 }, seconds: 7, inputs: [
		{ at: 0.2, until: 2.6, keys: [ W, SHIFT ] }
	] },
	// Walked into the shut door from its far side: held back at it.
	{ name: 'test_basic-door-held', course: 'test_basic', start: { position: [ 28, STAND, 46.5 ], yaw: Math.PI }, seconds: 3, inputs: [
		{ at: 0.2, until: 2.8, keys: [ W ] }
	] },
	// Kicked open from a walk, then walked through.
	{ name: 'test_basic-door-kick', course: 'test_basic', start: { position: [ 28, STAND, 43.2 ], yaw: 0 }, seconds: 4, inputs: [
		{ at: 0.3, until: 0.4, keys: [ E ] },
		{ at: 1.4, until: 3.6, keys: [ W ] }
	] },
	// The valve turned, and the door beside it opening.
	{ name: 'test_basic-valve', course: 'test_basic', start: { position: [ 25.6, STAND, 42.5 ], yaw: 0 }, seconds: 5, inputs: [
		{ at: 0.3, until: 0.4, keys: [ E ] }
	] },
	// Walking along the wall to the button, pressed in passing, and on along the wall.
	{ name: 'test_basic-button', course: 'test_basic', start: { position: [ 29, STAND, 43.3 ], yaw: Math.PI / 2 }, seconds: 4, inputs: [
		{ at: 0.2, until: 0.6, keys: [ W ] },
		{ at: 0.6, until: 0.7, keys: [ E ] },
		{ at: 2, until: 3.5, keys: [ W ] }
	] }
];

const COURSES = [
	...PROPS,
	...courseTapes( 'test_basic', [ 0 ], 12 ),
	...courseTapes( 'test_vaults', [ 1, 5, 9, 14, 22, 30 ] ),
	...courseTapes( 'test_ledges', [ 1, 3, 6, 9 ] ),
	...courseTapes( 'test_wallruns', [ 1, 4, 8, 12, 16 ] ),
	...courseTapes( 'test_bars', [ 1, 4, 8, 12 ] ),
	...courseTapes( 'test_pipes', [ 1, 3, 5, 8 ] ),
	...courseTapes( 'test_ziplines', [ 1, 3, 5, 7 ] ),
	...courseTapes( 'test_gaps', [ 1, 10, 25, 40, 60, 80 ] ),
	...courseTapes( 'test_jumps', [ 1, 3, 5 ] ),
	...courseTapes( 'test_landings', [ 1, 4, 8 ] ),
	...courseTapes( 'test_slopes', [ 1, 4, 7 ] ),
	...courseTapes( 'test_ground', [ 1, 6, 12 ] ),
	...courseTapes( 'test_beams', [ 1, 5 ] ),
	...courseTapes( 'generated-4242', [ 0 ], 14 ),
	...courseTapes( 'generated-7', [ 0 ], 14 ),
	...courseTapes( 'generated-99', [ 0 ], 14 )
];

export { FEATURES, COURSES };
