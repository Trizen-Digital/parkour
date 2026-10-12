// Landings and falls: run off decks of four heights (landed running, landed hard, and the same heights rolled with
// Jump held into the landing), a fall too high to survive (the ragdoll, and standing up), going limp at a run, and a
// dive roll.

import { JUMP, DIVE, LIMP, at, inState, notState, onFoot, airborne, limp, after, slowerThan, rampLength } from '../script.js';

const RAMP = 4;

/**
 * Off the end of a deck `height` up at a sprint, rolled (Jump held from the edge into the landing) or not.
 * @param {number} height (m)
 * @param {boolean} roll
 */
export function drop( height, roll ) {

	const edge = RAMP + rampLength( height ) + 5, length = Math.ceil( edge + 16 );
	return {
		id: `drop-${height}${roll ? '-roll' : ''}`, family: 'landings', name: `Drop ${height} m${roll ? ', rolled' : ''}`, size: height, length,
		build( b ) {

			b.climbTo( RAMP, height, 5 );

		},
		steps: [
			{ run: 'sprint', until: at( edge ) },
			{ run: 'sprint', until: airborne(), limit: 1 },
			...( roll ? [ { run: 'sprint', hold: [ JUMP ], until: inState( 'rolling' ), limit: 3, say: 'roll the landing' } ] : [] ),
			{ run: 'sprint', until: onFoot(), limit: 4 },
		],
		expect: roll ? { moves: [ /roll/i ] } : {},
	};

}

/**
 * A fall too high to land: off a deck `height` up, the runner goes limp on landing; once the body lies still, Space
 * stands it up.
 * @param {number} height (m)
 */
export function fatalFall( height ) {

	const edge = RAMP + rampLength( height ) + 5, length = Math.ceil( edge + 18 );
	return {
		id: `fall-${height}`, family: 'landings', name: `Fall ${height} m: the ragdoll, then up`, size: height, length,
		build( b ) {

			b.climbTo( RAMP, height, 5 );

		},
		steps: [
			{ run: 'sprint', until: at( edge ) },
			{ run: 'sprint', until: limp(), limit: 4, say: 'go limp on landing' },
			{ run: 'stop', until: ( s ) => s.limp && s.runner.velocity.length() < 0.5, limit: 6, say: 'lie still' },
			{ run: 'stop', for: 0.4 },
			{ run: 'stop', hold: [ JUMP ], until: onFoot(), limit: 3, say: 'stand up' },
		],
		expect: { bail: true },
	};

}

/** Going limp at a sprint (the limp key), then up again once still. */
export function goLimp() {

	return {
		id: 'go-limp', family: 'landings', name: 'Go limp at a sprint, then up', size: null, length: 30,
		steps: [
			{ run: 'sprint', until: at( 8 ) },
			{ run: 'sprint', press: { [ LIMP ]: 0.05 }, until: limp(), limit: 1, say: 'go limp' },
			{ run: 'stop', until: ( s ) => s.limp && s.runner.velocity.length() < 0.5, limit: 6, say: 'lie still' },
			{ run: 'stop', for: 0.4 },
			{ run: 'stop', hold: [ JUMP ], until: onFoot(), limit: 3, say: 'stand up' },
		],
		expect: { bail: true },
	};

}

/** A dive roll at a sprint: Dive pressed and let go. */
export function diveRoll() {

	return {
		id: 'dive-roll', family: 'landings', name: 'Dive roll', size: null, length: 26,
		steps: [
			{ run: 'sprint', until: at( 10 ) },
			{ run: 'sprint', press: { [ DIVE ]: 0.05 }, until: ( s ) => s.stunt === 'diveOut' || s.move === 'diveOut', limit: 0.5, say: 'dive' },
			{ run: 'sprint', until: onFoot(), limit: 3 },
		],
		expect: { moves: [ 'diveOut' ] },
	};

}

export { RAMP };
