// Reshapes a kept take by hand-picked amounts, for a take whose timing or pose is off and has no capture to rebuild it
// from:
//
//   --warp old:new,…   re-times the clip, its keys moved by straight lines between the pairs (seconds as played; the
//                      first pair from 0 holds the first pose that long, the last sets the length)
//   --lean deg,from,to,ease      tips the body forward about its across axis (backward when negative)
//   --elbows deg,from,to,ease    bends both elbows that much further, about the way each bends in the take
//   --swing share,from,to,ease   keeps that share of the upper arms' swing about where they swing from
//
// Each pose change is all there from `from` to `to` (seconds, after the warp), eased in and out over `ease` either
// side. Run tools/moves/tuck.mjs after it for the legs' tuck.
//
//   node tools/moves/reshape.mjs <take> [options] [--write]
//
// With --write the clip is stored; otherwise it prints what it would do.

import '../headless/env.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { clipUrl, formatClip, round } from './lib/clips.js';

const THREE = await import( 'three' );
const { Motion } = await import( '@trizen/parkour/motion/Motion.js' );
const { YBotFigure } = await import( '../../src/figure/YBotFigure.js' );

const X = new THREE.Vector3( 1, 0, 0 );

const args = process.argv.slice( 2 );
const option = ( name ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : null;
const numbers = ( name ) => option( name )?.split( ',' ).map( Number ) ?? null;
const [ name ] = args;
const write = args.includes( '--write' );

const clip = JSON.parse( readFileSync( clipUrl( name ), 'utf8' ) );

// The warp: each key's time put through the pairs; a pause at the start repeats the first key at 0.
const warp = option( '--warp' )?.split( ',' ).map( ( pair ) => pair.split( ':' ).map( Number ) );
if ( warp ) {

	const map = ( t ) => {

		const i = Math.max( 0, warp.findIndex( ( [ old ], k ) => k === warp.length - 1 || warp[ k + 1 ][ 0 ] >= t ) );
		const [ a, b ] = [ warp[ i ], warp[ Math.min( i + 1, warp.length - 1 ) ] ];
		return b[ 0 ] === a[ 0 ] ? a[ 1 ] : a[ 1 ] + ( t - a[ 0 ] ) * ( b[ 1 ] - a[ 1 ] ) / ( b[ 0 ] - a[ 0 ] );

	};

	const times = clip.times.map( ( t ) => round( map( t ) ) );
	if ( times[ 0 ] > 0 ) {

		times.unshift( 0 );
		for ( const [ track, values ] of Object.entries( clip.tracks ) ) {

			const size = track.endsWith( '.quaternion' ) ? 4 : 3;
			clip.tracks[ track ] = [ ...values.slice( 0, size ), ...values ];

		}

	}

	clip.times = times;
	clip.length = round( map( clip.length ) );
	console.log( `${name}: re-timed to ${clip.length} s` );

}

const times = clip.times;
const share = ( [ , from, to, ease ] ) => ( t ) => {

	if ( t < from - ease || t > to + ease ) return 0;
	const edge = Math.min( t - ( from - ease ), ( to + ease ) - t );
	if ( ease <= 0 || edge >= ease ) return 1;
	const s = edge / ease;
	return s * s * ( 3 - 2 * s );

};
const keys = ( track ) => times.map( ( _, i ) => new THREE.Quaternion().fromArray( clip.tracks[ track ], i * 4 ) );
const store = ( track, quaternions ) => {

	clip.tracks[ track ] = quaternions.flatMap( ( q ) => q.normalize().toArray().map( round ) );

};

const lean = numbers( '--lean' );
if ( lean ) {

	const at = share( lean );
	store( 'mixamorigHips.quaternion', keys( 'mixamorigHips.quaternion' ).map( ( q, i ) => q.premultiply( new THREE.Quaternion().setFromAxisAngle( X, lean[ 0 ] * Math.PI / 180 * at( times[ i ] ) ) ) ) );
	console.log( `${name}: body tipped ${lean[ 0 ]}° forward from ${lean[ 1 ]} to ${lean[ 2 ]} s` );

}

const motion = await new Motion().load();
const figure = await new YBotFigure().load( motion.takes );
const rest = ( bone ) => figure.sampler.rest[ figure.sampler.index.get( bone ) ].quaternion;
const fromRest = ( bone, q ) => {

	const turn = rest( bone ).clone().invert().multiply( q );
	if ( turn.w < 0 ) turn.set( - turn.x, - turn.y, - turn.z, - turn.w );
	return turn;

};

const elbows = numbers( '--elbows' );
if ( elbows ) {

	const at = share( elbows );
	for ( const bone of [ 'mixamorigLeftForeArm', 'mixamorigRightForeArm' ] ) {

		const track = bone + '.quaternion', all = keys( track );
		// The way it bends: the axis of its deepest bend in the take.
		const deepest = all.map( ( q ) => fromRest( bone, q ) ).reduce( ( a, b ) => ( b.w < a.w ? b : a ) );
		const axis = new THREE.Vector3( deepest.x, deepest.y, deepest.z ).normalize();
		store( track, all.map( ( q, i ) => q.multiply( new THREE.Quaternion().setFromAxisAngle( axis, elbows[ 0 ] * Math.PI / 180 * at( times[ i ] ) ) ) ) );

	}

	console.log( `${name}: elbows bent ${elbows[ 0 ]}° more from ${elbows[ 1 ]} to ${elbows[ 2 ]} s` );

}

const swing = numbers( '--swing' );
if ( swing ) {

	const at = share( swing );
	for ( const bone of [ 'mixamorigLeftArm', 'mixamorigRightArm' ] ) {

		const track = bone + '.quaternion', all = keys( track );
		const mean = new THREE.Vector4();
		for ( const q of all ) {

			const sign = q.dot( all[ 0 ] ) < 0 ? - 1 : 1;
			mean.x += q.x * sign; mean.y += q.y * sign; mean.z += q.z * sign; mean.w += q.w * sign;

		}

		const middle = new THREE.Quaternion( mean.x, mean.y, mean.z, mean.w ).normalize();
		store( track, all.map( ( q, i ) => q.clone().slerp( middle, ( 1 - swing[ 0 ] ) * at( times[ i ] ) ) ) );

	}

	console.log( `${name}: upper arms keep ${swing[ 0 ]} of their swing from ${swing[ 1 ]} to ${swing[ 2 ]} s` );

}

if ( write ) {

	writeFileSync( clipUrl( name ), formatClip( clip ) );
	console.log( `wrote ${clipUrl( name ).pathname.split( '/public/' )[ 1 ]}` );

}
