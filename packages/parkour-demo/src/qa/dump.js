// A run's state as flat `path: value` lines, to find what two runs that should be the same disagree on: a respawned
// run against a fresh one, a restored run against the one it came from. It reads exactly what a snapshot copies.

import { snapshotRoots, takeSnapshot } from '@trizen/parkour/sim/snapshot.js';

// The roots in the order their paths are named: an object held in two places is listed under the first. The input
// comes first, so the devices read `input.…` wherever else they are held.
const ORDER = [ 'input', 'random', 'position', 'view', 'followCamera', 'motion', 'poseInputs', 'ragdoll', 'figure', 'queries', 'mover', 'runner' ];

/**
 * @param {Simulation} sim
 * @returns {Object<string, *>} every value of the run by its path (`runner.velocity.x`); an object met again is
 *   `@` and the path it was first met at
 */
function stateDump( sim ) {

	const snapshot = takeSnapshot( sim ), copies = snapshot.copies, out = {}, seen = new Map();
	const walk = ( value, path ) => {

		if ( value === null || typeof value !== 'object' ) {

			if ( typeof value !== 'function' ) out[ path ] = value;
			return;

		}

		if ( ! copies.has( value ) ) return;
		if ( seen.has( value ) ) {

			out[ path ] = `@${seen.get( value )}`;
			return;

		}

		seen.set( value, path );
		if ( ArrayBuffer.isView( value ) ) {

			out[ path ] = `${value.constructor.name}[${Array.from( value ).join( ',' )}]`;

		} else if ( value instanceof Map ) {

			out[ `${path}.size` ] = value.size;
			let i = 0;
			for ( const [ key, child ] of value ) walk( child, `${path}[${key !== null && typeof key === 'object' ? `#${i ++}` : String( key )}]` );

		} else if ( value instanceof Set || Array.isArray( value ) ) {

			out[ `${path}.length` ] = value instanceof Set ? value.size : value.length;
			let i = 0;
			for ( const child of value ) walk( child, `${path}[${i ++}]` );

		} else {

			for ( const key of Object.keys( value ) ) walk( value[ key ], `${path}.${key}` );

		}

	};

	const roots = snapshotRoots( sim ).sort( ( a, b ) => ORDER.indexOf( a[ 0 ] ) - ORDER.indexOf( b[ 0 ] ) );
	for ( const [ name, root ] of roots ) walk( root, name );
	for ( const [ key, value ] of Object.entries( snapshot.own ) ) walk( value, `sim.${key}` );
	for ( const [ key, value ] of Object.entries( snapshot.camera ) ) out[ `camera.${key}` ] = JSON.stringify( value );
	snapshot.figure.forEach( ( [ node, ...transform ], i ) => out[ `figure[${i}:${node.name}]` ] = JSON.stringify( transform ) );
	return out;

}

/**
 * @param {Object<string, *>} a a stateDump()
 * @param {Object<string, *>} b another
 * @returns {string[]} `path: a | b` for every value that differs
 */
function diffDumps( a, b ) {

	const same = ( x, y ) => Object.is( x, y ) || ( Number.isNaN( x ) && Number.isNaN( y ) );
	return [ ...new Set( [ ...Object.keys( a ), ...Object.keys( b ) ] ) ]
		.filter( ( key ) => ! same( a[ key ], b[ key ] ) )
		.map( ( key ) => `${key}: ${a[ key ]} | ${b[ key ]}` );

}

export { stateDump, diffDumps };
