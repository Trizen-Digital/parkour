// Swings: poles beside decks at four heights (slid down to the floor, or kicked off part way), bars at four heights,
// bar to bar, and ropes hung from four anchor heights, caught in a running jump and leapt off on the swing forward.

import { JUMP, GRAB, D, at, inState, notState, onFoot, airborne, any, rampLength } from '../script.js';
import { TAP, FULL, pressFor } from './obstacles.js';

// Slopes up to decks start here (m).
const RAMP = 4;

/**
 * A pole beside the end of a deck: a running jump off the deck past it, grab held, caught; then slid down to the
 * floor (or turning round it with the stick to the right as it slides), or kicked off part way down (Jump held on the
 * pole, let go).
 * @param {number} deck the deck's height (m)
 * @param {number} pole the pole's height (m)
 * @param {string} off 'slide', 'turn' or 'kick'
 */
export function pole( deck, pole, off ) {

	const edge = RAMP + rampLength( deck ) + 6, length = Math.ceil( edge + 20 );
	return {
		id: `pole-${pole}-${off}`, family: 'swings', name: `Pole ${pole} m from a ${deck} m deck, ${{ slide: 'slid to the floor', turn: 'turned round sliding down', kick: 'kicked off' }[ off ]}`, size: pole, length,
		build( b ) {

			b.climbTo( RAMP, deck, 6 );
			// Beside the line, so the runner's look ahead for a wall misses it.
			b.add( { type: 'cylinder', p: [ 0.45, 0, edge + 1.1 ], r: 0.09, h: pole } );

		},
		steps: [
			{ run: 'sprint', until: at( edge - 0.6 ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', hold: [ GRAB, ...( off === 'kick' ? [ JUMP ] : [] ) ], until: inState( 'onPole' ), limit: 1.5, say: 'catch the pole' },
			...( off === 'turn' ? [
				{ run: [ D ], hold: [ GRAB ], until: notState( 'onPole' ), limit: 4, say: 'slide down, turning round' },
			] : off === 'kick' ? [
				{ run: 'sprint', hold: [ GRAB, JUMP ], for: 0.35 },
				{ run: 'sprint', hold: [ GRAB ], until: notState( 'onPole' ), limit: 0.3, say: 'kick off the pole' },
				// Off a tall pole the landing is rolled: Jump held to tuck once the kick is away, let go just before
				// touchdown.
				...( pole > 8 ? [
					{ run: 'sprint', for: 0.15 },
					{ run: 'sprint', hold: [ JUMP ], until: ( s ) => s.vy < 0 && s.y < 0.6, limit: 3, say: 'tuck to roll' },
				] : [] ),
			] : [
				{ run: 'stop', hold: [ GRAB ], until: notState( 'onPole' ), limit: 4, say: 'slide down' },
			] ),
			{ run: 'sprint', until: onFoot(), limit: 4 },
		],
		expect: { states: [ 'onPole' ] },
	};

}

/**
 * A swing bar across the way between two posts: a running jump at it, grab held; it swings and launches the runner
 * on.
 * @param {number} height (m)
 */
export function bar( height ) {

	const at_ = 11, jump = height > 2.6 ? { hold: FULL, before: 1.6 } : { hold: TAP, before: 1.2 };
	return {
		id: `bar-${height}`, family: 'swings', name: `Swing bar at ${height} m`, size: height, length: 30,
		build( b ) {

			b.add( { type: 'bar', a: [ - 1.5, height, at_ ], b: [ 1.5, height, at_ ], posts: true } );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( at_, jump.before, jump.hold ) ) },
			{ run: 'sprint', press: { [ JUMP ]: jump.hold }, until: airborne() },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'onBar' ), limit: 1.5, say: 'catch the bar' },
			{ run: 'sprint', until: notState( 'onBar' ), limit: 2 },
			{ run: 'sprint', until: onFoot(), limit: 3 },
		],
		expect: { states: [ 'onBar' ] },
	};

}

/**
 * Bar to bar: two bars `gap` apart at 2.4 m, the second caught from the first's launch with grab held on.
 * @param {number} gap (m)
 */
export function barToBar( gap ) {

	const first = 11, height = 2.4;
	return {
		id: `bar-to-bar-${gap}`, family: 'swings', name: `Bar to bar ${gap} m apart`, size: gap, length: 34,
		build( b ) {

			b.add( { type: 'bar', a: [ - 1.5, height, first ], b: [ 1.5, height, first ], posts: true } );
			b.add( { type: 'bar', a: [ - 1.5, height, first + gap ], b: [ 1.5, height, first + gap ], posts: true } );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( first, 1.2, TAP ) ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'onBar' ), limit: 1.5, say: 'catch the first bar' },
			{ run: 'sprint', hold: [ GRAB ], until: notState( 'onBar' ), limit: 2 },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'onBar' ), limit: 1.5, say: 'catch the second bar' },
			{ run: 'sprint', until: notState( 'onBar' ), limit: 2 },
			{ run: 'sprint', until: onFoot(), limit: 3 },
		],
		expect: { states: [ 'onBar' ] },
	};

}

/**
 * A rope hung from a beam `anchor` up, its end 2 m off the floor: a running jump at it, grab held, caught; Jump held as
 * it swings forward, and let go past the anchor to leap off.
 * @param {number} anchor (m)
 */
export function rope( anchor ) {

	const at_ = 12;
	return {
		id: `rope-${anchor}`, family: 'swings', name: `Rope from ${anchor} m`, size: anchor, length: 34,
		build( b ) {

			b.add( { type: 'rope', a: [ 0, anchor, at_ ], length: anchor - 2 } );
			// The beam it hangs from, on posts well clear of the swing.
			b.box( [ - 2.2, anchor, at_ - 0.1 ], [ 2.2, anchor + 0.2, at_ + 0.1 ], { roles: [ 'decor' ] } );
			b.box( [ - 2.2, 0, at_ - 0.1 ], [ - 2, anchor, at_ + 0.1 ], { roles: [ 'decor' ] } );
			b.box( [ 2, 0, at_ - 0.1 ], [ 2.2, anchor, at_ + 0.1 ], { roles: [ 'decor' ] } );

		},
		steps: [
			{ run: 'sprint', until: at( pressFor( at_, 1.6, TAP ) ) },
			{ run: 'sprint', press: { [ JUMP ]: TAP }, until: airborne() },
			{ run: 'sprint', hold: [ GRAB ], until: inState( 'onRope' ), limit: 1.5, say: 'catch the rope' },
			{ run: 'sprint', hold: [ GRAB, JUMP ], until: any( ( s ) => s.z > at_ + 0.8 && s.runner.velocity.z > 1, notState( 'onRope' ) ), limit: 4, say: 'swing forward' },
			{ run: 'sprint', hold: [ GRAB ], until: notState( 'onRope' ), limit: 0.3, say: 'leap off' },
			{ run: 'sprint', until: onFoot(), limit: 4 },
		],
		expect: { states: [ 'onRope' ] },
	};

}
