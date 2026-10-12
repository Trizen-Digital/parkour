// Tricks. On the ground at a sprint: the cartwheel, the spin dive; standing: the back flip out of the precision crouch.
// In the air: every trick button with every direction it has (a mouse flick points it), each off a drop of four
// heights (a running jump on the level, and off decks 2, 4 and 6 m up, rolled into the landing), and a trick repeated
// in one air.

import { JUMP, FLIP, WHEEL, DIVE, BACKFLIP, PRECISION, at, inState, onFoot, airborne, playing, slowerThan, any, rampLength } from '../script.js';
import { FULL, TAP, pressFor } from './obstacles.js';
import { RAMP } from './landings.js';

// Where a ground trick starts along its station (m): past a full sprint.
const START = 10;

/**
 * The steps that start a trick on the ground with a press and wait for its move.
 * @param {string} key
 * @param {string|RegExp} move
 * @param {string} say
 */
function groundTrick( key, move, say, hold = [] ) {

	return { run: 'sprint', hold, press: { [ key ]: TAP }, until: playing( move ), limit: 0.5, say };

}

/** The cartwheel: Wheel at a sprint. */
export function cartwheel() {

	return {
		id: 'trick-cartwheel', family: 'tricks', name: 'Cartwheel', size: null, length: 28,
		steps: [
			{ run: 'sprint', until: at( START ) },
			groundTrick( WHEEL, 'cartwheel', 'cartwheel' ),
			{ run: 'sprint', until: onFoot(), limit: 3 },
		],
		expect: { moves: [ 'cartwheel' ] },
	};

}

/** The spin dive: Flip, then Dive within half a second, at a sprint. */
export function spinDive() {

	return {
		id: 'trick-spin-dive', family: 'tricks', name: 'Spin dive', size: null, length: 28,
		steps: [
			{ run: 'sprint', until: at( START ) },
			{ run: 'sprint', press: { [ FLIP ]: TAP }, for: 0.15 },
			groundTrick( DIVE, 'spinDiveRoll', 'spin dive' ),
			{ run: 'sprint', until: onFoot(), limit: 3 },
		],
		expect: { moves: [ 'spinDiveRoll' ] },
	};

}

/** The standing back flip: stopped, the precision crouch, then Flip. */
export function standingBackflip() {

	return {
		id: 'trick-standing-backflip', family: 'tricks', name: 'Standing back flip', size: null, length: 26,
		steps: [
			{ run: 'sprint', until: at( START - 4 ) },
			{ run: 'walk', until: at( START ) },
			{ run: 'stop', until: slowerThan( 0.05 ), limit: 2 },
			{ run: 'stop', hold: [ PRECISION ], until: inState( 'aiming' ), limit: 0.5, say: 'crouch' },
			{ run: 'stop', hold: [ PRECISION ], for: 0.3 },
			{ run: 'stop', hold: [ PRECISION, FLIP ], until: any( airborne(), inState( 'groundStunt', 'airStunt' ) ), limit: 0.5, say: 'back flip' },
			{ run: 'stop', until: onFoot(), limit: 3 },
			{ run: 'stop', for: 0.3 },
		],
		expect: { moves: [ /backflip/i ] },
	};

}

// The air tricks: the button, the direction flicked, and the move it plays.
const AIR = [
	[ FLIP, 'up', 'sideFlip' ], [ FLIP, 'right', 'vortex' ], [ FLIP, 'down', 'backCork' ], [ FLIP, 'left', 'spin' ],
	[ WHEEL, 'up', 'frontFlip' ], [ WHEEL, 'down', 'diveFrontFlip' ], [ WHEEL, 'left', 'deathDive' ], [ WHEEL, 'right', 'spinFrontFlip' ],
	[ BACKFLIP, 'up', 'runningBackflip' ], [ BACKFLIP, 'down', 'layoutBackflip' ], [ BACKFLIP, 'right', 'heldBackflip' ],
];

// The tricks start this long after the jump leaves (s): the air combo opens soon after a jump.
const TRICK_AFTER = 0.25;

// Jump held to roll a landing is let go of this high over the floor, coming down (m): a release on the ground would
// be a jump.
const ROLL_LET_GO = 0.6;

/**
 * An air trick off a full running jump, on the level or off a deck `drop` up (rolled into the landing: Jump held once
 * the trick has begun, as a held Jump key would turn the back flip button off).
 * @param {string} move one of AIR's
 * @param {number} drop (m)
 * @param {object} [options]
 * @param {boolean} [options.repeat] the trick pressed again in the same air, once its combo opens: its repeat
 */
export function airTrick( move, drop, { repeat = false } = {} ) {

	const [ key, flick ] = AIR.find( ( [ , , name ] ) => name === move );
	const edge = drop ? RAMP + rampLength( drop ) + 7 : 14, length = Math.ceil( edge + 18 );
	return {
		id: `air-${move}${repeat ? '-repeat' : ''}-${drop}`, family: 'air tricks', name: `${move}${repeat ? ' twice' : ''} ${drop ? `off ${drop} m` : 'on the level'}`, size: drop, length,
		build( b ) {

			if ( drop ) b.climbTo( RAMP, drop, 7 );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( edge, 0.35, FULL ) ) },
			{ run: 'sprint', press: { [ JUMP ]: FULL }, until: airborne() },
			{ run: 'sprint', for: TRICK_AFTER },
			{ run: 'sprint', flick, press: { [ key ]: TAP }, until: any( playing( move ), ( s ) => s.stunt === move ), limit: 0.3, say: move },
			...( repeat ? [
				{ run: 'sprint', until: ( s ) => s.runner.airComboOpen, limit: 1.5, say: 'the combo opens' },
				{ run: 'sprint', flick, press: { [ key ]: TAP }, until: ( s ) => /Repeat$/.test( s.stunt ?? '' ), limit: 0.3, say: `${move} again` },
			] : [] ),
			// Let go of just before touchdown: the roll window stays open 0.35 s after.
			...( drop ? [ { run: 'sprint', for: 0.15 }, { run: 'sprint', hold: [ JUMP ], until: ( s ) => s.vy < 0 && s.y < ROLL_LET_GO, limit: 4 } ] : [] ),
			{ run: 'sprint', until: onFoot(), limit: 4 },
		],
		expect: { moves: [ move, ...( repeat ? [ /Repeat$/ ] : [] ) ] },
	};

}

export { AIR };
