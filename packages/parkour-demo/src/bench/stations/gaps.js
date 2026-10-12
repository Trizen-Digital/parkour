// Running jumps across gaps onto decks higher and lower than the take-off, a walking jump, and precision jumps from a
// standstill onto perches. The gaps sit inside what DESIGN.md measures the runner clearing (a tap, or a full charge,
// let go at the edge), with room to spare.

import { JUMP, GRAB, PRECISION, at, onFoot, airborne, grounded, inState, notState, slowerThan, rampLength } from '../script.js';
import { TAP, FULL, pressFor } from './obstacles.js';

// The take-off edge along a station (m), and how long the landing deck is (m).
const EDGE = 10, DECK = 6;

// The block under a deck reaches down this far (m), past any pit's bottom.
const FOOT = - 8;

/**
 * Takes off from the floor at EDGE over a pit `gap` wide onto a deck `rise` above it, then back to the floor's
 * height (a slope down from a higher deck, up from a lower one).
 * @param {object} b the station's builder
 * @returns {number} where the station's floor carries on (m)
 */
function buildGap( b, gap, rise ) {

	b.floor( 0, EDGE );
	const land = EDGE + gap;
	b.box( [ - 2, FOOT, land ], [ 2, rise, land + DECK ] );
	let z = land + DECK;
	if ( rise > 0 ) z = b.descendFrom( z, rise );
	if ( rise < 0 ) {

		b.ramp( z, rampLength( - rise ), - rise, { y: rise } );
		z += rampLength( - rise );

	}

	return z;

}

/**
 * A running jump at a sprint across a gap onto a deck `rise` up (or down).
 * @param {number} rise (m)
 * @param {number} gap (m)
 * @param {object} [options]
 * @param {number} [options.hold] Jump held (s): a tap or a full charge
 * @param {boolean} [options.roll] Jump held into the landing, to roll it
 */
export function gapJump( rise, gap, { hold = TAP, roll = false } = {} ) {

	const length = Math.ceil( EDGE + gap + DECK + rampLength( Math.abs( rise ) ) + 8 );
	return {
		id: `gap-${gap}-to-${rise}`, family: 'gaps', name: `${gap} m gap to ${rise > 0 ? '+' : ''}${rise} m`, size: rise, length, ground: false, low: Math.min( 0, rise ),
		build( b ) {

			const z = buildGap( b, gap, rise );
			b.floor( z, length );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( EDGE, 0.35, hold ) ) },
			{ run: 'sprint', press: { [ JUMP ]: hold }, until: airborne() },
			...( roll ? [ { run: 'sprint', for: 0.2 }, { run: 'sprint', hold: [ JUMP ], until: onFoot() } ] : [] ),
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'rising' ] },
	};

}

/** A walking jump over a 1 m gap: Jump tapped at the edge. */
export function walkingJump() {

	const gap = 1, length = 26;
	return {
		id: 'gap-walking-1', family: 'gaps', name: 'Walking jump over 1 m', size: 0, length, ground: false,
		build( b ) {

			b.floor( 0, EDGE );
			b.box( [ - 2, FOOT, EDGE + gap ], [ 2, 0, length ] );

		},
		steps: [
			{ run: 'walk', until: at( pressFor( EDGE, 0.25, 0 ) ) },
			{ run: 'walk', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'walk', until: onFoot() },
		],
		expect: { states: [ 'rising' ] },
	};

}

// The precision jump flies at 6.5 m/s per unit of charge for about 0.73 s, and the crouch charges it by 1.2 a second
// (at least 0.45 counts), so it goes about 5.8 m for every second crouched (measured: 3.09 m from 0.53 s).
const CROUCH_PER_METRE = 0.53 / 3.09;

// The runner stops this far short of the take-off edge (m): the stick let go from a walk carries it 0.07 m on.
const STOP_SHORT = 0.2;

/**
 * A precision jump from a standstill onto a perch (a 0.4 m pillar's top, level with the take-off, over a pit) with
 * precision held into the landing to balance on it, then off it while balancing: a jump on (Space), or a step off
 * (grab), onto the floor beyond.
 * @param {number} distance from the take-off edge to the perch's middle (m)
 * @param {string} off 'jump' or 'step'
 */
export function precisionJump( distance, off = 'jump' ) {

	const stand = 10, perch = stand + distance, length = Math.ceil( perch + 14 );
	const crouch = ( distance + STOP_SHORT ) * CROUCH_PER_METRE;
	return {
		id: `precision-${distance}`, family: 'precision', name: `Precision jump ${distance} m onto a perch, ${off} off`, size: distance, length, ground: false,
		build( b ) {

			b.floor( 0, stand );
			b.box( [ - 0.2, FOOT, perch - 0.2 ], [ 0.2, 0, perch + 0.2 ] );
			b.box( [ - 2, FOOT, perch + 1 ], [ 2, 0, length ] );

		},
		steps: [
			{ run: 'sprint', until: at( stand - 4 ) },
			{ run: 'walk', until: at( stand - STOP_SHORT - 0.07 ) },
			{ run: 'stop', until: slowerThan( 0.05 ) },
			{ run: 'stop', hold: [ PRECISION ], until: inState( 'aiming' ), limit: 1, say: 'crouch' },
			{ run: 'stop', hold: [ PRECISION ], for: crouch },
			{ run: 'stop', hold: [ PRECISION ], press: { [ JUMP ]: TAP }, until: airborne(), limit: 1, say: 'precision jump' },
			{ run: 'stop', hold: [ PRECISION ], until: grounded() },
			{ run: 'stop', for: 0.15 },
			{ run: 'walk', press: { [ off === 'jump' ? JUMP : GRAB ]: 0.1 }, until: airborne(), limit: 0.5, say: `${off} off the perch` },
			{ run: 'walk', until: onFoot() },
		],
		expect: { states: [ 'aiming', 'precisionJump' ], moves: [ 'perchLand' ] },
	};

}

/**
 * A stride: walked to the edge of the floor with grab held, the runner strides across a gap onto the deck beyond (the
 * precision target it finds 2.25-3.5 m ahead).
 * @param {number} gap from the edge to the deck (m)
 */
export function stride( gap ) {

	const edge = 10, length = Math.ceil( edge + gap + 14 );
	return {
		id: `stride-${gap}`, family: 'precision', name: `Stride ${gap} m onto a deck`, size: gap, length, ground: false,
		build( b ) {

			b.floor( 0, edge );
			b.box( [ - 2, FOOT, edge + gap ], [ 2, 0, length ] );

		},
		steps: [
			{ run: 'sprint', until: at( edge - 4 ) },
			{ run: 'walk', hold: [ GRAB ], until: inState( 'striding' ), limit: 4, say: 'stride' },
			{ run: 'walk', until: notState( 'striding' ), limit: 2 },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'striding' ] },
	};

}
