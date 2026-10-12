// Ledges: hanging and shimmying at four heights, round an outside corner, leaping up to a higher ledge and across to
// one beside, letting go and kicking off, and a free hang from a lip with no wall below.

import { JUMP, GRAB, FLIP, DIVE, A, D, W, SHIFT, at, inState, notState, onFoot, airborne, after, all, grounded, rampLength } from '../script.js';
import { TAP, FULL, pressFor } from './obstacles.js';

// The ledged block's face stands this far along a station (m).
const FACE = 10;

/**
 * The steps that take the runner up to hang: a running jump (or grab alone, for an edge in the wallclimb's reach).
 * @param {number} height the edge's height (m)
 */
function upToHang( height ) {

	const jump = height < 2.6 ? { hold: FULL, before: height > 2.1 ? 2.4 : 1.6 } : height > 3.05 ? { hold: TAP, before: 1.2 } : null;
	return [
		{ run: 'sprint', until: at( jump ? pressFor( FACE, jump.before, jump.hold ) : FACE - 1.2 ) },
		...( jump ? [ { run: 'sprint', press: { [ JUMP ]: jump.hold }, until: airborne() } ] : [] ),
		{ run: 'sprint', hold: [ GRAB ], until: inState( 'hanging' ), limit: 3, say: 'catch the edge' },
		{ run: 'stop', hold: [ GRAB ], for: 0.4 },
	];

}

/** Jump with forward held climbs up; then off the far side. */
function climbOut() {

	return [
		{ run: 'walk', hold: [ GRAB ], for: 0.1 },
		{ run: 'walk', press: { [ JUMP ]: TAP }, until: inState( 'climbingUp' ), limit: 1, say: 'climb up' },
		{ run: 'sprint', until: onFoot() },
	];

}

/**
 * A hang from a block's edge, a shimmy along it one way and back, then a climb up.
 * @param {number} height (m)
 * @param {string} first which way the shimmy goes first: 'left' or 'right'
 */
export function shimmy( height, first = 'left' ) {

	const [ one, two ] = first === 'left' ? [ A, D ] : [ D, A ];
	return {
		id: `shimmy-${height}`, family: 'ledges', name: `Hang and shimmy at ${height} m`, size: height, length: 30,
		build( b ) {

			b.block( FACE, 3, height, { width: 6 } );
			b.descendFrom( FACE + 3, height );

		},
		steps: [
			...upToHang( height ),
			{ run: [ one ], hold: [ GRAB ], for: 1.2 },
			{ run: 'stop', hold: [ GRAB ], for: 0.3 },
			{ run: [ two ], hold: [ GRAB ], for: 1.2 },
			{ run: 'stop', hold: [ GRAB ], for: 0.3 },
			...climbOut(),
		],
		expect: { states: [ 'hanging' ] },
	};

}

/**
 * Round an outside corner: a hang near the corner of a narrow block, a shimmy to it and the leap round onto its side,
 * then back round onto the front, and a climb up.
 * @param {string} side which corner: 'left' or 'right'
 */
export function corner( side ) {

	const [ out, back ] = side === 'left' ? [ A, D ] : [ D, A ];
	return {
		id: `ledge-corner-${side}`, family: 'ledges', name: `Shimmy round an outside corner, ${side}`, size: 3.2, length: 30,
		build( b ) {

			b.block( FACE, 3, 3.2, { width: 2.4 } );
			b.descendFrom( FACE + 3, 3.2 );

		},
		steps: [
			...upToHang( 3.2 ),
			{ run: [ out ], hold: [ GRAB ], until: inState( 'leapingToLedge' ), limit: 4, say: 'leap round the corner' },
			{ run: 'stop', hold: [ GRAB ], until: inState( 'hanging' ), limit: 2 },
			{ run: 'stop', hold: [ GRAB ], for: 0.5 },
			{ run: [ back ], hold: [ GRAB ], until: inState( 'leapingToLedge' ), limit: 4, say: 'leap back round' },
			{ run: 'stop', hold: [ GRAB ], until: inState( 'hanging' ), limit: 2 },
			{ run: [ back ], hold: [ GRAB ], for: 0.4 },
			{ run: 'stop', hold: [ GRAB ], for: 0.3 },
			...climbOut(),
		],
		expect: { states: [ 'hanging', 'leapingToLedge' ], moves: [ /^ledgeLeapSide/ ] },
	};

}

/**
 * A leap up from a hang to a ledge above: a shelf 3.2 m up, and over it a lip `rise` higher on the same face (a tall
 * block set back behind them), leapt to with Jump and forward held, then climbed. Both jut half a metre out: the leap
 * looks for the ledge above with spheres reaching about 0.55 m out from the hanging body and takes the first wall they
 * meet, so a wall between the two any closer would hide the lip. The lip is thin: its top is looked for no more than
 * 0.2 m above where the first sphere touches its underside.
 * @param {number} rise (m)
 */
export function leapUp( rise ) {

	const low = 3.2, high = low + rise, shelf = 0.5;
	return {
		id: `ledge-leap-up-${rise}`, family: 'ledges', name: `Leap up ${rise} m to a higher ledge`, size: rise, length: 34,
		build( b ) {

			b.block( FACE, shelf, low, { width: 4 } );
			b.box( [ - 2, high - 0.15, FACE ], [ 2, high, FACE + shelf ] );
			b.block( FACE + shelf, 3, high, { width: 4 } );
			b.descendFrom( FACE + shelf + 3, high );

		},
		steps: [
			...upToHang( low ),
			{ run: 'walk', hold: [ GRAB ], for: 0.05 },
			{ run: 'walk', hold: [ GRAB ], press: { [ JUMP ]: TAP }, until: inState( 'leapingToLedge' ), limit: 0.5, say: 'leap up' },
			{ run: 'stop', hold: [ GRAB ], until: inState( 'hanging' ), limit: 2 },
			{ run: 'stop', hold: [ GRAB ], for: 0.4 },
			...climbOut(),
		],
		expect: { states: [ 'leapingToLedge' ], moves: [ /^ledgeLeapUp/ ] },
	};

}

/**
 * A leap sideways from one ledge to another a gap away along the same wall: a hang half a metre in from the near
 * ledge's end, Jump with the stick to that side, then a climb onto the far ledge and off its far side, back to the
 * line after the slope down.
 * @param {number} gap between the ledges (m)
 * @param {string} side 'left' or 'right'
 */
export function leapAcross( gap, side ) {

	const s = side === 'left' ? 1 : - 1, height = 3.2, key = side === 'left' ? A : D, width = 2.4, inFromEnd = 0.5;
	// The far ledge's middle across the station, where the leap holds it (a quarter metre in from its end, where both
	// hands have its top under them), and where its slope down ends (m).
	const far = s * ( inFromEnd + gap + width / 2 ), hold = s * ( inFromEnd + gap + 0.25 ), down = FACE + 3 + rampLength( height );
	const back = ( z ) => hold * Math.max( 0, 1 - ( z - down ) / 8 );
	return {
		id: `ledge-leap-${side}-${gap}`, family: 'ledges', name: `Leap ${side} ${gap} m to the next ledge`, size: gap, length: 40,
		build( b ) {

			// The near block with its end half a metre past the line, the far one `gap` beyond; a wall of the same face
			// between them, set back and too high to hang from.
			b.block( FACE, 3, height, { width, x: s * ( inFromEnd - width / 2 ) } );
			b.block( FACE, 3, height, { width, x: far } );
			b.block( FACE + 0.6, 2.4, height + 1.5, { width: gap, x: s * ( inFromEnd + gap / 2 ) } );
			b.descendFrom( FACE + 3, height, { width, x: far } );

		},
		steps: [
			...upToHang( height ),
			{ run: [ key ], hold: [ GRAB ], for: 0.05 },
			{ run: [ key ], hold: [ GRAB ], press: { [ JUMP ]: TAP }, until: inState( 'leapingToLedge' ), limit: 0.5, say: `leap ${side}` },
			{ run: 'stop', hold: [ GRAB ], until: inState( 'hanging' ), limit: 2 },
			{ run: 'stop', hold: [ GRAB ], for: 0.4 },
			// Up onto the far ledge, along it and down its slope, then back to the middle.
			...climbOut().map( ( step ) => ( { ...step, x: ( z ) => z < down ? hold : back( z ) } ) ),
			{ run: 'sprint', x: back, until: at( down + 10 ) },
		],
		expect: { states: [ 'leapingToLedge' ], moves: [ /^ledgeLeapSide/ ] },
	};

}

/**
 * Off a hang without climbing: dive lets go and drops, flip kicks off backwards. Then round the block.
 * @param {string} how 'drop' or 'kick'
 */
export function letGo( how ) {

	return {
		id: `ledge-${how}`, family: 'ledges', name: how === 'drop' ? 'Hang and let go' : 'Hang and kick off', size: 3.2, length: 30, line: 0,
		build( b ) {

			b.block( FACE, 3, 3.2, { width: 2.4 } );

		},
		steps: [
			...upToHang( 3.2 ),
			{ run: 'stop', press: { [ how === 'drop' ? DIVE : FLIP ]: TAP }, until: notState( 'hanging' ), limit: 0.5, say: how === 'drop' ? 'let go' : 'kick off' },
			{ run: 'stop', until: onFoot(), limit: 3 },
			{ run: 'sprint', x: 2.6, until: at( FACE + 4 ), limit: 8 },
		],
		expect: { states: [ 'hanging' ] },
	};

}

/**
 * A free hang: a lip with no face under it (a 0.3 m thick slab jutting a metre out from a block), caught from a full
 * running jump (an edge is caught once the body has risen past it: a standing jump does not reach one this high),
 * then climbed.
 */
export function freeHang() {

	const lip = 2;
	return {
		id: 'ledge-free-hang', family: 'ledges', name: `Free hang from a ${lip} m lip`, size: lip, length: 30,
		build( b ) {

			b.box( [ - 2, lip - 0.3, FACE ], [ 2, lip, FACE + 1 ] );
			b.block( FACE + 1, 3, lip, { width: 4 } );
			b.descendFrom( FACE + 4, lip );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( FACE, 1.4, FULL ) ) },
			{ run: 'sprint', press: { [ JUMP ]: FULL }, until: airborne() },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'hanging' ), limit: 3, say: 'catch the lip' },
			{ run: 'stop', hold: [ GRAB ], for: 0.4 },
			...climbOut(),
		],
		expect: { states: [ 'hanging' ] },
	};

}
