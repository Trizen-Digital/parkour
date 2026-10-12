// Climbs: drainpipes and ladders up towers of four heights (taken at their foot, climbed, climbed out over the top),
// a pipe slid back down and jumped off, a ladder slid down, and ziplines of four slopes ridden from a deck's edge.

import { JUMP, GRAB, DIVE, D, at, inState, notState, onFoot, airborne, after, any, rampLength } from '../script.js';
import { TAP } from './obstacles.js';

// The tower's face stands this far along a station (m); it is TOWER wide and deep.
const FACE = 10, TOWER = 3;

/**
 * A tower with a drainpipe or a ladder up its face: run to its foot with grab held, climb with forward, out over the
 * top, and down a slope off the back.
 * @param {string} kind 'pipe' or 'ladder'
 * @param {number} height (m)
 */
export function climb( kind, height ) {

	const length = Math.ceil( FACE + TOWER + rampLength( height ) + 8 );
	return {
		id: `${kind}-${height}`, family: 'climbs', name: `${kind === 'pipe' ? 'Drainpipe' : 'Ladder'} up ${height} m`, size: height, length,
		build( b ) {

			b.block( FACE, TOWER, height, { width: TOWER } );
			if ( kind === 'pipe' ) b.add( { type: 'pipe', a: [ 0, 0, FACE - 0.07 ], b: [ 0, height, FACE - 0.07 ], r: 0.06 } );
			else b.add( { type: 'ladder', p: [ 0, 0, FACE - 0.15 ], h: height, yaw: 180, width: 0.5 } );
			b.descendFrom( FACE + TOWER, height );

		},
		steps: [
			{ run: 'sprint', until: at( FACE - 4 ) },
			{ run: 'walk', hold: [ GRAB ], until: inState( kind === 'pipe' ? 'onPipe' : 'onLadder' ), limit: 3, say: `take the ${kind}` },
			{ run: 'walk', until: inState( 'toppingOut' ), limit: height / ( kind === 'pipe' ? 2.5 : 1.2 ) + 3, say: 'climb out at the top' },
			{ run: 'walk', until: notState( 'toppingOut' ), limit: 3 },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ kind === 'pipe' ? 'onPipe' : 'onLadder', 'toppingOut' ] },
	};

}

/**
 * Part way up a tall tower's pipe or ladder, back down (sliding), and off: a pipe jumped off to the side (Jump held,
 * then let go with the stick to the left), a ladder let go of (dive) a little above its foot. Then back a step, clear
 * of the ladder's rails, and on round the tower.
 * @param {string} kind 'pipe' or 'ladder'
 */
export function climbDown( kind ) {

	const height = 8, up = kind === 'pipe' ? 1.6 : 2.5;
	return {
		id: `${kind}-down`, family: 'climbs', name: kind === 'pipe' ? 'Drainpipe: up, slide down, jump off' : 'Ladder: up, slide down', size: height, length: 30, line: 0,
		build( b ) {

			b.block( FACE, TOWER, height, { width: TOWER } );
			if ( kind === 'pipe' ) b.add( { type: 'pipe', a: [ 0, 0, FACE - 0.07 ], b: [ 0, height, FACE - 0.07 ], r: 0.06 } );
			else b.add( { type: 'ladder', p: [ 0, 0, FACE - 0.15 ], h: height, yaw: 180, width: 0.5 } );

		},
		steps: [
			{ run: 'sprint', until: at( FACE - 4 ) },
			{ run: 'walk', hold: [ GRAB ], until: inState( kind === 'pipe' ? 'onPipe' : 'onLadder' ), limit: 3, say: `take the ${kind}` },
			{ run: 'walk', for: up },
			{ run: 'back', for: kind === 'pipe' ? 0.5 : 1 },
			...( kind === 'pipe' ? [
				{ run: [ D ], hold: [ JUMP ], for: 0.2 },
				{ run: [ D ], until: notState( 'onPipe' ), limit: 0.3, say: 'jump off' },
			] : [
				{ run: 'back', for: 1.2 },
				{ run: 'stop', press: { [ DIVE ]: TAP }, until: notState( 'onLadder' ), limit: 0.3, say: 'let go' },
			] ),
			{ run: 'stop', until: onFoot(), limit: 3 },
			{ run: 'back', for: 0.3 },
			{ run: 'sprint', x: 2.8, until: at( FACE + TOWER + 1 ), limit: 8 },
		],
		expect: { states: [ kind === 'pipe' ? 'onPipe' : 'onLadder' ] },
	};

}

/**
 * A zipline down along the way from a deck's edge: run off the edge, grab pressed in the air as the cable's end is
 * reached, ridden to its low end, which throws the runner off.
 * @param {number} slope (degrees)
 */
export function zipline( slope ) {

	const run = 16, drop = run * Math.tan( slope * Math.PI / 180 ), deck = Math.round( drop * 100 ) / 100, ramp = 4;
	const edge = ramp + rampLength( deck ) + 5, length = Math.ceil( edge + run + 14 );
	return {
		id: `zipline-${slope}`, family: 'climbs', name: `Zipline at ${slope}°`, size: slope, length,
		build( b ) {

			b.climbTo( ramp, deck, 5 );
			// The cable's high end over the deck's edge, 2.6 m up; its low end 2.6 m over the floor.
			b.add( { type: 'cable', a: [ 0, deck + 2.6, edge - 0.2 ], b: [ 0, 2.6, edge - 0.2 + run ], anchors: true } );

		},
		steps: [
			{ run: 'sprint', until: at( edge - 0.5 ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', for: 0.1 },
			{ run: 'sprint', press: { [ GRAB ]: 0.2 }, until: inState( 'onZipline' ), limit: 1, say: 'take the zipline' },
			{ run: 'sprint', hold: [ GRAB ], until: notState( 'onZipline' ), limit: 6, say: 'ride to the end' },
			{ run: 'sprint', until: onFoot(), limit: 4 },
		],
		expect: { states: [ 'onZipline' ] },
	};

}
