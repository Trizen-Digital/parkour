// Obstacles met square on at a sprint: hurdled, vaulted every way, hopped onto, jumped at and caught, run up and
// climbed. The heights follow what DESIGN.md measures: a step to 0.3 m, a jump over 0.4-0.6 m, vaults over 0.7-0.9 m,
// hops onto 0.8-0.9 and 1.6-1.7 m, catches of 1.4-2.4 m edges, and wallclimbs up to edges 2.9-3.9 m high.

import { JUMP, GRAB, FLIP, WHEEL, DIVE, at, inState, onFoot, airborne, falling, any, after } from '../script.js';

// Where the obstacle's face stands along a station (m): room for a sprint from a standstill (2 m) and a straight line.
const FACE = 10;

// At a sprint (5.85 m/s), a jump held this long (s) goes this far (m) before it leaves: a tap, and a full charge.
const TAP = 0.05, FULL = 0.5, SPRINT = 5.85;

/** Where to press a jump held `hold` seconds so it leaves `before` metres short of z. */
const pressFor = ( z, before, hold ) => z - before - hold * SPRINT;

/**
 * Grab held until the runner hangs from the edge, a moment hanging, then Jump with forward held climbs up.
 * @returns {object[]} steps
 */
function hangAndClimb() {

	return [
		{ run: 'sprint', hold: [ GRAB ], until: inState( 'hanging' ), limit: 3, say: 'catch the edge' },
		{ run: 'sprint', hold: [ GRAB ], for: 0.3 },
		{ run: 'sprint', press: { [ JUMP ]: TAP }, until: inState( 'climbingUp' ), limit: 1, say: 'climb up' },
		{ run: 'sprint', until: onFoot() },
	];

}

/** A warm-up: the run's first sprint, straight down the line. */
export function warmUp() {

	return {
		id: 'warm-up', family: 'run', name: 'Sprint', size: null, length: 20,
		steps: [ { run: 'sprint', until: at( 14 ) } ],
	};

}

/**
 * A block jumped clean over: a tap of Jump a little over a metre before it.
 * @param {number} height (m)
 */
export function hurdle( height ) {

	return {
		id: `hurdle-${height}`, family: 'obstacles', name: `Hurdle ${height} m`, size: height, length: 22,
		build( b ) {

			b.block( FACE, 0.4, height );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( FACE, 1.1, TAP ) ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'rising' ] },
	};

}

// The vaults by the trick button pressed with grab, and the moves they play.
const VAULTS = {
	dash: { key: JUMP, move: /^dashVault/, name: 'Dash vault' },
	speed: { key: FLIP, move: /^speedVault/, name: 'Speed vault' },
	kong: { key: WHEEL, move: /^kongVault/, name: 'Kong vault' },
};

/**
 * A vault over a thin block: grab and the vault's trick button pressed together 1.6 m before it (pressed together, so
 * grab alone never hops onto it first).
 * @param {string} kind dash, speed or kong
 * @param {number} height (m)
 */
export function vault( kind, height ) {

	const { key, move, name } = VAULTS[ kind ];
	return {
		id: `vault-${kind}-${height}`, family: 'vaults', name: `${name} over ${height} m`, size: height, length: 24,
		build( b ) {

			b.block( FACE, 0.4, height );

		},
		steps: [
			{ run: 'sprint', until: at( FACE - 1.6 ) },
			{ run: 'sprint', hold: [ GRAB, key ], until: inState( 'vaulting' ) },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'vaulting' ], moves: [ move ] },
	};

}

/**
 * The power jump: Jump held into the approach to a low block hops onto it and leaps off its top.
 * @param {number} height (m)
 */
export function powerJump( height ) {

	return {
		id: `power-jump-${height}`, family: 'vaults', name: `Power jump off ${height} m`, size: height, length: 26,
		build( b ) {

			b.block( FACE, 0.4, height );

		},
		steps: [
			{ run: 'sprint', until: at( FACE - 3.5 ) },
			{ run: 'sprint', hold: [ JUMP ], until: inState( 'climbingUp', 'vaulting' ) },
			{ run: 'sprint', hold: [ JUMP ], until: airborne() },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { moves: [ /^powerJump/ ] },
	};

}

/**
 * A hop onto a deep block with grab alone (waist high, or head high), a run along its top and off its end.
 * @param {number} height (m)
 */
export function hop( height ) {

	const high = height > 1.2;
	return {
		id: `hop-${height}`, family: 'vaults', name: `${high ? 'High hop' : 'Hop'} onto ${height} m`, size: height, length: 26,
		build( b ) {

			b.block( FACE, 3, height );

		},
		steps: [
			{ run: 'sprint', until: at( FACE - 4 ) },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'climbingUp' ) },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { moves: [ high ? 'highHopOnto' : 'hopOnto' ] },
	};

}

/**
 * A running jump at a deep block, grab once in the air: the edge caught and climbed (or the top vaulted onto), then
 * down a slope off its far side.
 * @param {number} height (m)
 * @param {object} [options]
 * @param {number} [options.hold] how long Jump is held (s): a tap, or a full charge
 * @param {number} [options.before] how far before the face the jump leaves (m)
 */
export function catchEdge( height, { hold = TAP, before = 1.2 } = {} ) {

	return {
		id: `catch-${height}`, family: 'ledges', name: `Jump, catch and climb ${height} m`, size: height, length: 34,
		build( b ) {

			b.block( FACE, 3, height );
			b.descendFrom( FACE + 3, height );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( FACE, before, hold ) ) },
			{ run: 'sprint', press: { [ JUMP ]: hold }, until: airborne() },
			...hangAndClimb(),
		],
		expect: { states: [ 'catchingLedge' ] },
	};

}

/**
 * A wallclimb: at a sprint, up the wall below an edge out of reach to hang from it (grab alone for the lowest, a jump
 * and grab higher up), then climbed, and down a slope off the far side.
 * @param {number} height (m)
 * @param {object} [options]
 * @param {boolean} [options.jump] jump first (else grab is held from `before` metres out)
 * @param {number} [options.before] how far before the face the jump leaves, or grab is taken (m)
 * @param {number} [options.hold] how long Jump is held (s)
 */
export function wallclimb( height, { jump = height > 3.05, before = 1.2, hold = TAP } = {} ) {

	return {
		id: `wallclimb-${height}`, family: 'ledges', name: `Wallclimb ${height} m`, size: height, length: 40,
		build( b ) {

			b.block( FACE, 4, height );
			b.descendFrom( FACE + 4, height );

		},
		steps: [
			{ run: 'sprint', until: at( jump ? pressFor( FACE, before, hold ) : FACE - before ) },
			...( jump ? [ { run: 'sprint', press: { [ JUMP ]: hold }, until: airborne() } ] : [] ),
			...hangAndClimb(),
		],
		expect: { states: [ 'catchingLedge', 'hanging', 'climbingUp' ] },
	};

}

export { FACE, TAP, FULL, SPRINT, pressFor, hangAndClimb };
