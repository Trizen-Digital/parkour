// Lengthens a walk's strides: the legs swing further about where they swing from through the cycle (each thigh's and
// shin's turn from its mean over the take, scaled), the hips go down by however much higher that leaves the lower foot,
// and the take's stride grows by the same share. At the same speed the take then plays that much slower, the feet still
// keeping to the ground. For a kept walking take whose steps look quick for the speed it walks at.
//
//   node tools/moves/stride.mjs <take> --scale <share> [--write]
//
// With --write the clip is stored and the family's spec gets the new stride; otherwise it prints what it would do.

import '../headless/env.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSpecs } from './lib/specs.js';
import { clipUrl, formatClip, round } from './lib/clips.js';

const THREE = await import( 'three' );
const { Motion } = await import( '@trizendigital/parkour/motion/Motion.js' );
const { YBotFigure } = await import( '../../src/figure/YBotFigure.js' );

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : fallback;
const [ name ] = args;
const scale = Number( option( '--scale', 1 ) );
const write = args.includes( '--write' );

const specs = await loadSpecs();
const spec = specs.takes.get( name );
if ( ! spec?.stride ) throw new Error( `no walking take ${name} with a stride` );

const clip = JSON.parse( readFileSync( clipUrl( name ), 'utf8' ) );
const times = clip.times, n = times.length;
const LEGS = [ 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigRightUpLeg', 'mixamorigRightLeg' ];
const FEET = [ 'mixamorigLeftFoot', 'mixamorigLeftToeBase', 'mixamorigRightFoot', 'mixamorigRightToeBase' ];
const HIPS = 'mixamorigHips.position';

// Each leg bone's turn, scaled about its mean.
const scaled = structuredClone( clip );
for ( const bone of LEGS ) {

	const values = clip.tracks[ bone + '.quaternion' ];
	const keys = times.map( ( _, i ) => new THREE.Quaternion().fromArray( values, i * 4 ) );
	const mean = new THREE.Vector4();
	for ( const q of keys ) {

		const sign = q.dot( keys[ 0 ] ) < 0 ? - 1 : 1;
		mean.x += q.x * sign; mean.y += q.y * sign; mean.z += q.z * sign; mean.w += q.w * sign;

	}

	const middle = new THREE.Quaternion( mean.x, mean.y, mean.z, mean.w ).normalize();
	const out = scaled.tracks[ bone + '.quaternion' ];
	keys.forEach( ( q, i ) => {

		const from = middle.clone().invert().multiply( q );
		if ( from.w < 0 ) from.set( - from.x, - from.y, - from.z, - from.w );
		const angle = 2 * Math.acos( Math.min( 1, from.w ) ), sin = Math.sqrt( Math.max( 0, 1 - from.w * from.w ) );
		const turn = sin < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( from.x / sin, from.y / sin, from.z / sin ), angle * scale );
		middle.clone().multiply( turn ).normalize().toArray( out, i * 4 );

	} );

}

// The lowest foot at each key, as a clip poses the figure (the skeleton's space, so the hips' height counts).
const motion = await new Motion().load();
const figure = await new YBotFigure().load( motion.takes );
const feet = FEET.map( ( bone ) => figure.model.getObjectByName( bone ) );
const lowest = ( data, label ) => {

	const tracks = Object.entries( data.tracks ).map( ( [ track, values ] ) => new ( track.endsWith( '.quaternion' ) ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack )( track, new Float32Array( times ), new Float32Array( values ) ) );
	figure.sampler.clips.set( label, new THREE.AnimationClip( label, data.length, tracks ) );
	return times.map( ( t ) => {

		figure.step( 1 / 120, { kind: 'clip', take: label, time: t }, new THREE.Vector3(), 0, {} );
		figure.root.updateMatrixWorld( true );
		return Math.min( ...feet.map( ( foot ) => foot.getWorldPosition( new THREE.Vector3() ).y ) );

	} );

};

const before = lowest( clip, 'stride:before' ), after = lowest( scaled, 'stride:after' );
const hips = scaled.tracks[ HIPS ];
for ( let i = 0; i < n; i ++ ) hips[ i * 3 + 1 ] = round( hips[ i * 3 + 1 ] - ( after[ i ] - before[ i ] ) );
for ( const bone of LEGS ) scaled.tracks[ bone + '.quaternion' ] = scaled.tracks[ bone + '.quaternion' ].map( round );

const check = lowest( scaled, 'stride:check' );
const stride = round( spec.stride * scale );
console.log( `${name}: legs swing ${scale}x about their mean; hips down ${Math.min( ...after.map( ( v, i ) => v - before[ i ] ) ).toFixed( 3 )} to ${Math.max( ...after.map( ( v, i ) => v - before[ i ] ) ).toFixed( 3 )} m; the lowest foot now within ${Math.max( ...check.map( ( v, i ) => Math.abs( v - before[ i ] ) ) ).toFixed( 4 )} m of where it was; stride ${spec.stride} -> ${stride} m` );

if ( write ) {

	writeFileSync( clipUrl( name ), formatClip( scaled ) );
	const file = new URL( `families/${spec.family}.js`, import.meta.url );
	const source = readFileSync( file, 'utf8' );
	const at = source.indexOf( `\t${name}: {` ), from = source.indexOf( '\t\tstride: ', at ), to = source.indexOf( ',', from );
	writeFileSync( file, source.slice( 0, from ) + `\t\tstride: ${stride}` + source.slice( to ) );
	console.log( `wrote ${clipUrl( name ).pathname.split( '/public/' )[ 1 ]} and ${spec.family}.js's stride` );

}
