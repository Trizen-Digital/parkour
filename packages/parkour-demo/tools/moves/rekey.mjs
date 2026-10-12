// Keys a climbing take's root along its own body: the root (which the runner, and so the camera, follows) rises and
// moves on when the hips do, not ahead of them, and the hips are kept where they showed. For a kept take whose clip was
// fitted against a root that ran ahead of the body (its keyed root, or the placement that carried it).
//
//   node tools/moves/rekey.mjs <take> [--against root | --against <rise>,<forward>,<seconds>] [--window s] [--risen m]
//                              [--write]
//
// What showed is the hips' path: the clip's hips over what carried them (`root`, the take's keyed root track; or a
// straight carry of `rise` up and `forward` on over `seconds`, as a placement did). That path, smoothed over `window`
// seconds, gives the root its timing: the new root makes the travel the old one made by the time the hips stop rising,
// rising and moving on as they do (never down, never back), then moves on with them as they walk off. The hips track is
// moved by the difference, so the body shows as before with the runner carried by the new root. The root keys go into
// the family's spec and the hips into the stored clip (with --write; otherwise it prints what it would do).

import { readFileSync, writeFileSync } from 'node:fs';
import { loadSpecs, specLength } from './lib/specs.js';
import { clipUrl, formatClip, round } from './lib/clips.js';

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : fallback;
const [ name ] = args;
const window = Number( option( '--window', 0.15 ) );
const against = option( '--against', 'root' );
const write = args.includes( '--write' );

const specs = await loadSpecs();
const spec = specs.takes.get( name );
if ( ! spec ) throw new Error( `no take ${name}` );
const pace = spec.pace ?? 1;
const clip = JSON.parse( readFileSync( clipUrl( name ), 'utf8' ) );
const HIPS = 'mixamorigHips.position';
const hips = clip.tracks[ HIPS ];
const times = clip.times;
const n = times.length;

// The old carry at a take time (the spec's root keys are on the take's own timeline, before the pace).
function sampler( keyTimes, positions ) {

	return ( t ) => {

		let i = 0;
		while ( i < keyTimes.length - 1 && keyTimes[ i + 1 ] <= t ) i ++;
		const j = Math.min( i + 1, keyTimes.length - 1 );
		const w = j === i ? 0 : Math.min( 1, Math.max( 0, ( t - keyTimes[ i ] ) / ( keyTimes[ j ] - keyTimes[ i ] ) ) );
		return [ 0, 1, 2 ].map( ( k ) => positions[ i * 3 + k ] * ( 1 - w ) + positions[ j * 3 + k ] * w );

	};

}

let carry;
if ( against === 'root' ) {

	if ( ! spec.root ) throw new Error( `${name} has no root keys to key against` );
	carry = sampler( spec.root.times.map( ( t ) => t / pace ), spec.root.positions );

} else {

	const [ rise, forward, seconds ] = against.split( ',' ).map( Number );
	carry = ( t ) => {

		const a = Math.min( 1, Math.max( 0, t / seconds ) );
		return [ 0, rise * a, forward * a ];

	};

}

// What showed: the hips over the carry.
const shown = times.map( ( t, i ) => {

	const c = carry( t );
	return [ 0, 1, 2 ].map( ( k ) => c[ k ] + hips[ i * 3 + k ] );

} );

// Smoothed over the window, by time (each key the mean of the keys within half the window of it).
const smooth = shown.map( ( _, i ) => {

	const sum = [ 0, 0, 0 ];
	let count = 0;
	for ( let j = 0; j < n; j ++ ) {

		if ( Math.abs( times[ j ] - times[ i ] ) > window / 2 ) continue;
		for ( let k = 0; k < 3; k ++ ) sum[ k ] += shown[ j ][ k ];
		count ++;

	}

	return sum.map( ( v ) => v / count );

} );

// The hips have risen where they first come within RISEN (m) of their highest: past that they only bob with the steps.
const RISEN = Number( option( '--risen', 0.06 ) );
const top = Math.max( ...smooth.map( ( v ) => v[ 1 ] ) );
const risen = smooth.findIndex( ( v ) => v[ 1 ] >= top - RISEN );
const start = carry( 0 ), end = carry( times[ risen ] ), last = carry( times[ n - 1 ] );

// The new root: the old one's travel by the time the hips have risen, made as they rise and move on; then on as they
// walk off, to its own last height and to under the hips at the end (so the move hands the body back with the hips over
// the runner), never down and never back.
const climbed = [ 1, 2 ].map( ( k ) => smooth[ risen ][ k ] - smooth[ 0 ][ k ] );
const walked = smooth[ n - 1 ][ 2 ] - smooth[ risen ][ 2 ];
const goal = Math.max( end[ 2 ], smooth[ n - 1 ][ 2 ] );
const share = ( value, whole, time, from, to ) => Math.min( 1, Math.max( 0, Math.abs( whole ) > 1e-6 ? value / whole : ( time - from ) / Math.max( to - from, 1e-9 ) ) );
let highest = [ - Infinity, - Infinity, - Infinity ];
const root = smooth.map( ( v, i ) => {

	const out = [ start[ 0 ], 0, 0 ], t = times[ i ], tr = times[ risen ], tn = times[ n - 1 ];

	for ( const [ index, k ] of [ [ 0, 1 ], [ 1, 2 ] ] ) {

		if ( i <= risen ) {

			out[ k ] = start[ k ] + ( end[ k ] - start[ k ] ) * share( v[ k ] - smooth[ 0 ][ k ], climbed[ index ], t, 0, tr );

		} else if ( k === 1 ) {

			out[ k ] = end[ 1 ] + ( last[ 1 ] - end[ 1 ] ) * ( t - tr ) / Math.max( tn - tr, 1e-9 );

		} else {

			out[ k ] = end[ 2 ] + ( goal - end[ 2 ] ) * share( v[ 2 ] - smooth[ risen ][ 2 ], walked, t, tr, tn );

		}

		highest[ k ] = Math.max( highest[ k ], out[ k ] );
		out[ k ] = highest[ k ];

	}

	return out;

} );

// The hips moved by what the root no longer carries, so the body shows as before.
const moved = hips.slice();
for ( let i = 0; i < n; i ++ ) {

	const c = carry( times[ i ] );
	for ( const k of [ 1, 2 ] ) moved[ i * 3 + k ] = round( hips[ i * 3 + k ] + c[ k ] - root[ i ][ k ] );

}

console.log( `${name}: hips rise ${climbed[ 0 ].toFixed( 3 )} m and move on ${climbed[ 1 ].toFixed( 3 )} m by ${times[ risen ].toFixed( 3 )} s of ${clip.length.toFixed( 3 )} s; the root rises ${( end[ 1 ] - start[ 1 ] ).toFixed( 3 )} m and moves on ${( end[ 2 ] - start[ 2 ] ).toFixed( 3 )} m by then, ${( root.at( - 1 )[ 2 ] - start[ 2 ] ).toFixed( 3 )} m in all` );
for ( let i = 0; i < n; i += Math.max( 1, Math.round( n / 16 ) ) ) console.log( times[ i ].toFixed( 3 ), 'shown', shown[ i ].map( ( v ) => v.toFixed( 3 ) ).join( ' ' ), ' root', root[ i ].map( ( v ) => v.toFixed( 3 ) ).join( ' ' ), ' hips', [ 0, 1, 2 ].map( ( k ) => moved[ i * 3 + k ].toFixed( 3 ) ).join( ' ' ) );

if ( write ) {

	// The clip's hips, and the root keyed at the clip's keys on the spec's timeline (before the pace).
	clip.tracks[ HIPS ] = moved;
	writeFileSync( clipUrl( name ), formatClip( clip ) );

	const keys = { times: times.map( ( t ) => Math.min( round( t * pace ), specLength( spec ) ) ), positions: root.flatMap( ( v ) => v.map( round ) ) };
	const file = new URL( `families/${spec.family}.js`, import.meta.url );
	const source = readFileSync( file, 'utf8' );
	const at = source.indexOf( `\t${name}: {` );
	const from = source.indexOf( '\t\troot: {', at ), to = source.indexOf( '\n\t\t}', from ) + 4;
	const block = `\t\troot: {\n\t\t\ttimes: ${JSON.stringify( keys.times ).replace( /,/g, ', ' ).replace( '[', '[ ' ).replace( ']', ' ]' )},\n\t\t\tpositions: ${JSON.stringify( keys.positions ).replace( /,/g, ', ' ).replace( '[', '[ ' ).replace( ']', ' ]' )}\n\t\t}`;
	const replaced = from > at && from >= 0 && ( source.indexOf( '\n\t},', at ) < 0 || from < source.indexOf( '\n\t},', at ) ) ?
		source.slice( 0, from ) + block + source.slice( to ) :
		source.slice( 0, source.indexOf( '\n\t}', at ) ) + ',\n' + block + source.slice( source.indexOf( '\n\t}', at ) );
	writeFileSync( file, replaced );
	console.log( `wrote ${clipUrl( name ).pathname.split( '/public/' )[ 1 ]} and ${spec.family}.js's root keys` );

}
