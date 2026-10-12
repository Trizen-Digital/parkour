// Ground moves: a slide on the level, slides under bars at four heights and down slopes at four angles, balance beams
// of four widths run along, a skid stop, and slopes of four angles run up and down.

import { SLIDE, at, inState, notState, onFoot, slowerThan, rampLength } from '../script.js';

// Where the station's feature starts along it (m).
const FEATURE = 12;

/** A slide on the level at a sprint: Slide held. */
export function slide() {

	return {
		id: 'slide', family: 'ground', name: 'Slide on the level', size: 0, length: 26,
		steps: [
			{ run: 'sprint', until: at( FEATURE ) },
			{ run: 'sprint', hold: [ SLIDE ], until: inState( 'sliding' ), limit: 0.5, say: 'slide' },
			{ run: 'sprint', hold: [ SLIDE ], until: notState( 'sliding' ), limit: 3 },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'sliding' ] },
	};

}

/**
 * A slide under a bar across the way, its underside `height` up: begun 4 m short of it.
 * @param {number} height (m)
 */
export function slideUnder( height ) {

	return {
		id: `slide-under-${height}`, family: 'ground', name: `Slide under a bar ${height} m up`, size: height, length: 28,
		build( b ) {

			b.box( [ - 4, height, FEATURE ], [ 4, height + 0.25, FEATURE + 0.25 ] );
			b.box( [ - 4, 0, FEATURE ], [ - 3.8, height, FEATURE + 0.25 ], { roles: [ 'decor' ] } );
			b.box( [ 3.8, 0, FEATURE ], [ 4, height, FEATURE + 0.25 ], { roles: [ 'decor' ] } );

		},
		steps: [
			{ run: 'sprint', until: at( FEATURE - 4 ) },
			{ run: 'sprint', hold: [ SLIDE ], until: inState( 'sliding' ), limit: 0.5, say: 'slide' },
			{ run: 'sprint', hold: [ SLIDE ], until: at( FEATURE + 1 ), limit: 3, say: 'under the bar' },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'sliding' ] },
	};

}

/**
 * A slide down a slope from a 3 m deck: Slide held as the runner goes over its top.
 * @param {number} angle the slope's (degrees)
 */
export function slideDown( angle ) {

	const height = 3, ramp = 4, top = ramp + rampLength( height ) + 4, run = height / Math.tan( angle * Math.PI / 180 );
	const length = Math.ceil( top + run + 14 );
	return {
		id: `slide-down-${angle}`, family: 'ground', name: `Slide down a ${angle}° slope`, size: angle, length,
		build( b ) {

			b.climbTo( ramp, height, 4 );
			b.rampDown( top, run, height );

		},
		steps: [
			{ run: 'sprint', until: at( top - 0.5 ) },
			{ run: 'sprint', hold: [ SLIDE ], until: inState( 'sliding' ), limit: 1, say: 'slide' },
			{ run: 'sprint', hold: [ SLIDE ], until: notState( 'sliding' ), limit: 4 },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'sliding' ] },
	};

}

/**
 * A balance beam a metre up between two slopes: walked along when narrow, run along from 0.35 m wide.
 * @param {number} width (m)
 */
export function beam( width ) {

	const from = 10, along = 6, pace = width < 0.35 ? 'walk' : 'sprint';
	return {
		id: `beam-${width}`, family: 'ground', name: `${width < 0.35 ? 'Walk' : 'Run'} along a ${width} m beam`, size: width, length: 30, low: - 1,
		build( b ) {

			b.ramp( from - 3, 3, 1, { width: 2 } );
			b.add( { type: 'beam', a: [ 0, 1, from ], b: [ 0, 1, from + along ], width } );
			b.rampDown( from + along, 3, 1, { width: 2 } );

		},
		steps: [
			{ run: 'sprint', until: at( from - 6 ) },
			{ run: pace, until: at( from + along + 2 ), limit: 8, say: 'along the beam' },
		],
		expect: { states: [ pace === 'walk' ? 'walking' : 'sprinting' ] },
	};

}

/** A skid stop: the stick let go at a sprint, then off again. First person stops without the skid. */
export function skidStop() {

	return {
		id: 'skid-stop', family: 'ground', name: 'Skid stop', size: null, length: 26,
		steps: [
			{ run: 'sprint', until: at( FEATURE ) },
			{ run: 'stop', until: slowerThan( 0.05 ), limit: 3, say: 'stop' },
			{ run: 'stop', for: 0.3 },
		],
		expect: ( { view } ) => view === 'first' ? {} : { moves: [ 'skidStop' ] },
	};

}

/**
 * A slope `angle` steep and 2 m high run up at a sprint, along its top and down the far side.
 * @param {number} angle (degrees)
 */
export function slope( angle ) {

	const height = 2, run = height / Math.tan( angle * Math.PI / 180 ), from = 8;
	return {
		id: `slope-${angle}`, family: 'ground', name: `Run up and down a ${angle}° slope`, size: angle, length: Math.ceil( from + 2 * run + 3 + 10 ),
		build( b ) {

			b.ramp( from, run, height, { width: 4 } );
			b.box( [ - 2, 0, from + run ], [ 2, height, from + run + 3 ] );
			b.rampDown( from + run + 3, run, height, { width: 4 } );

		},
		steps: [
			{ run: 'sprint', until: at( from + 2 * run + 4 ), limit: 10, say: 'over the slope' },
		],
	};

}
