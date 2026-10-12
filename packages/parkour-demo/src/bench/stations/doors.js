// Doors and the switches by them: doors of four sizes barged open at a sprint, doors kicked open from a walk, and a
// valve and a button at two heights each, worked with Interact to open the door beside them.

import { PRECISION, at, inState, notState, onFoot, slowerThan } from '../script.js';

// The door's wall stands across the way this far along a station (m), WALL_DEPTH thick; the door faces the runner.
const DOOR = 12, WALL_DEPTH = 0.3;

// Interact is the precision key: in front of a door, a valve or a button it works it.
const INTERACT = PRECISION;

/**
 * A door in a wall across the way.
 * @param {object} b the station's builder
 * @param {number} width (m)
 * @param {number} height (m)
 */
function buildDoor( b, width, height ) {

	b.add( { type: 'door', p: [ 0, 0, DOOR ], yaw: 180, width, height, wall: { width: 8, height: height + 0.8, depth: WALL_DEPTH } } );

}

/**
 * A shut door run at: the shoulder barge bursts it open and the runner goes on through.
 * @param {number} width (m)
 * @param {number} height (m)
 */
export function barge( width, height ) {

	return {
		id: `door-barge-${width}x${height}`, family: 'doors', name: `Barge a ${width} × ${height} m door`, size: height, length: 26,
		build( b ) {

			buildDoor( b, width, height );

		},
		steps: [
			{ run: 'sprint', until: at( DOOR + 1 ), limit: 6, say: 'through the door' },
		],
		expect: { moves: [ 'doorBarge' ] },
	};

}

/**
 * A shut door walked up to and kicked open with Interact, then run through.
 * @param {number} width (m)
 * @param {number} height (m)
 */
export function kick( width, height ) {

	return {
		id: `door-kick-${width}x${height}`, family: 'doors', name: `Kick open a ${width} × ${height} m door`, size: height, length: 26,
		build( b ) {

			buildDoor( b, width, height );

		},
		steps: [
			{ run: 'sprint', until: at( DOOR - 5 ) },
			{ run: 'walk', until: at( DOOR - 1.3 ) },
			{ run: 'stop', until: slowerThan( 0.05 ) },
			{ run: 'stop', press: { [ INTERACT ]: 0.05 }, until: inState( 'groundStunt' ), limit: 0.5, say: 'kick the door' },
			{ run: 'stop', until: onFoot(), limit: 2 },
			{ run: 'sprint', until: at( DOOR + 1 ), limit: 4, say: 'through the door' },
		],
		expect: { moves: [ 'doorKick' ] },
	};

}

/**
 * A valve or a button on the door's wall, beside a shut door: walked up to, worked with Interact (it opens the door),
 * then through the door.
 * @param {string} kind 'valve' or 'button'
 * @param {number} height of the switch (m)
 */
export function doorSwitch( kind, height ) {

	const x = kind === 'valve' ? 2.2 : - 2.2, face = DOOR - WALL_DEPTH / 2;
	return {
		id: `door-${kind}-${height}`, family: 'doors', name: `${kind === 'valve' ? 'Valve' : 'Button'} at ${height} m opens the door`, size: height, length: 28,
		line: ( z ) => z < DOOR - 6 ? 0 : x,
		build( b ) {

			buildDoor( b, 1, 2.2 );
			if ( kind === 'valve' ) b.add( { type: 'valve', p: [ x, height, face - 0.12 ], yaw: 180, r: 0.2 } );
			else b.add( { type: 'button', p: [ x, height, face - 0.015 ], yaw: 180 } );

		},
		steps: [
			{ run: 'sprint', until: at( DOOR - 6 ) },
			{ run: 'walk', until: at( DOOR - 1.2 ) },
			{ run: 'stop', until: slowerThan( 0.05 ) },
			{ run: 'stop', press: { [ INTERACT ]: 0.05 }, until: inState( 'groundStunt' ), limit: 0.5, say: `work the ${kind}` },
			{ run: 'stop', until: notState( 'groundStunt' ), limit: 4 },
			{ run: 'walk', x: 0, for: 0.6 },
			{ run: 'sprint', x: 0, until: at( DOOR + 1 ), limit: 5, say: 'through the door' },
		],
		expect: { moves: [ kind === 'valve' ? 'valveTurn' : 'buttonPress' ] },
	};

}
