// Walls: wall runs on either side at four heights, and off a wall run every way (a jump, a turn away, a dive), a run
// along a wall across a gap, and a kick off a wall met head on.

import { JUMP, GRAB, FLIP, DIVE, at, inState, notState, onFoot, airborne, after, all } from '../script.js';
import { TAP } from './obstacles.js';

// The wall starts this far along the station (m) and runs on WALL_LENGTH.
const WALL = 12, WALL_LENGTH = 9;

// The wall's face is this far to the side of the station's line (m); the runner closes on a line this far from the
// face (m) over the last metres, inside the wall run's reach of 0.35 m from the body's centre.
const FACE = 1.2, RUN_OFF = 0.3;

// +x is the runner's left as it runs along +z.
const SIDES = { left: 1, right: - 1 };

/**
 * The wall along one side, and the line that takes the runner in beside it.
 * @param {object} b the station's builder
 * @param {string} side 'left' or 'right'
 * @param {number} height (m)
 * @param {number} [length] (m)
 */
function buildWall( b, side, height, length = WALL_LENGTH ) {

	const s = SIDES[ side ];
	b.box( s > 0 ? [ FACE, 0, WALL ] : [ - FACE - 0.4, 0, WALL ], s > 0 ? [ FACE + 0.4, height, WALL + length ] : [ - FACE, height, WALL + length ] );

}

// Along the station's middle, then beside the wall from 6 m before it.
const lineBeside = ( side ) => ( z ) => z < WALL - 6 ? 0 : SIDES[ side ] * ( FACE - RUN_OFF );

/** The steps of a running jump into a wall run beside the wall. */
function intoWallRun() {

	return [
		{ run: 'sprint', until: at( WALL - 1.2 ) },
		{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
		{ run: 'sprint', hold: [ GRAB ], until: inState( 'wallRunning' ), limit: 1, say: 'wall run' },
	];

}

/**
 * A wall run along a wall to one side, held to its end.
 * @param {number} height (m)
 * @param {string} side 'left' or 'right'
 */
export function wallRun( height, side ) {

	return {
		id: `wallrun-${side}-${height}`, family: 'walls', name: `Wall run ${side}, ${height} m wall`, size: height, length: 30, line: lineBeside( side ),
		build( b ) {

			buildWall( b, side, height );

		},
		steps: [
			...intoWallRun(),
			{ run: 'sprint', hold: [ GRAB ], until: notState( 'wallRunning' ), limit: 2 },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'wallRunning' ] },
	};

}

// The ways off a wall run: the key, how it is pressed, and what it plays.
const OFFS = {
	jump: { name: 'jump off', press: { [ JUMP ]: TAP }, moves: [ /^ticTac/ ] },
	turn: { name: 'turn away (flip let go)', press: { [ FLIP ]: TAP }, moves: [] },
	dive: { name: 'dive off', press: { [ DIVE ]: TAP }, moves: [] },
};

/**
 * A wall run left part way: jumped off (a tic-tac), turned away from (flip let go), or dived off.
 * @param {string} how jump, turn or dive
 * @param {string} side 'left' or 'right'
 */
export function offWallRun( how, side ) {

	const off = OFFS[ how ];
	return {
		id: `wallrun-${how}-${side}`, family: 'walls', name: `Wall run ${side}, ${off.name}`, size: 3, length: 32, line: lineBeside( side ),
		build( b ) {

			buildWall( b, side, 3 );

		},
		steps: [
			...intoWallRun(),
			{ run: 'sprint', hold: [ GRAB ], for: 0.3 },
			{ run: 'sprint', press: off.press, until: notState( 'wallRunning' ), limit: 0.5, say: off.name },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'wallRunning' ], moves: off.moves },
	};

}

/**
 * A wall run along a wall that carries on over a pit `gap` wide.
 * @param {number} gap (m)
 * @param {string} side
 */
export function wallRunGap( gap, side ) {

	const pit = WALL + 0.8, length = 32;
	return {
		id: `wallrun-gap-${gap}`, family: 'walls', name: `Wall run ${side} across a ${gap} m gap`, size: gap, length, ground: false, line: lineBeside( side ),
		build( b ) {

			b.floor( 0, pit );
			b.floor( pit + gap, length );
			buildWall( b, side, 4 );
			const s = SIDES[ side ];
			// The wall reaches down into the pit.
			b.box( s > 0 ? [ FACE, - 6, pit ] : [ - FACE - 0.4, - 6, pit ], s > 0 ? [ FACE + 0.4, 0, pit + gap ] : [ - FACE, 0, pit + gap ] );

		},
		steps: [
			...intoWallRun(),
			{ run: 'sprint', hold: [ GRAB ], until: notState( 'wallRunning' ), limit: 2 },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'wallRunning' ] },
	};

}

/**
 * A kick off a wall met head on: a jump at it, flip let go as the runner reaches it kicks straight back; then on
 * round its end. The wall stands across the left of the way.
 */
export function wallKick() {

	const wall = 12;
	return {
		id: 'wall-kick', family: 'walls', name: 'Kick off a wall ahead', size: null, length: 32, line: - 0.6,
		build( b ) {

			b.box( [ - 4, 0, wall ], [ 0.6, 3.5, wall + 0.4 ] );

		},
		steps: [
			{ run: 'sprint', until: at( wall - 2 ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', hold: [ FLIP ], until: at( wall - 0.45 ), limit: 1 },
			{ run: 'sprint', until: inState( 'wallKicking' ), limit: 0.3, say: 'kick off the wall' },
			{ run: 'sprint', until: onFoot(), limit: 3 },
			{ run: 'sprint', x: 2.2, until: at( wall + 2 ), limit: 6 },
		],
		expect: { states: [ 'wallKicking' ] },
	};

}

/**
 * A plant on a wall met head on in the air: a jump at it with grab held plants the runner on it; flip let go kicks
 * off it. Then on round its end.
 */
export function wallPlant() {

	const wall = 12;
	return {
		id: 'wall-plant', family: 'walls', name: 'Plant on a wall, kick off', size: null, length: 32, line: - 0.6,
		build( b ) {

			b.box( [ - 4, 0, wall ], [ 0.6, 5, wall + 0.4 ] );

		},
		steps: [
			{ run: 'sprint', until: at( wall - 2.2 ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'wallPlanted' ), limit: 1, say: 'plant on the wall' },
			{ run: 'sprint', hold: [ GRAB, FLIP ], for: 0.15 },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'wallKicking' ), limit: 0.3, say: 'kick off' },
			{ run: 'sprint', until: onFoot(), limit: 3 },
			{ run: 'sprint', x: 2.2, until: at( wall + 2 ), limit: 6 },
		],
		expect: { states: [ 'wallPlanted', 'wallKicking' ] },
	};

}
