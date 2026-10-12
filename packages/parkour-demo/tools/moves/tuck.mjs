// Tucks a take's legs more, or less: each knee's and hip's bend from the skeleton's rest (the legs straight down),
// scaled, so a bent leg bends further (or eases off) and a straight one stays as it was. Over the whole take, or a
// stretch of it with the change eased in and out at its ends. For a kept take whose tuck is too shallow or too deep.
//
//   node tools/moves/tuck.mjs <take> --knees <share> [--hips <share>] [--from s --to s --ease s] [--write]
//
// Times are the stored clip's (as played). A knee bends no further than KNEE_MOST. With --write the clip is stored;
// otherwise it prints what it would do.

import '../headless/env.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { clipUrl, formatClip, round } from './lib/clips.js';

const THREE = await import( 'three' );
const { Motion } = await import( '@trizen/parkour/motion/Motion.js' );
const { YBotFigure } = await import( '../../src/figure/YBotFigure.js' );

// The most a knee bends (rad): about 150°, where the calf meets the thigh.
const KNEE_MOST = 2.6;

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? Number( args[ args.indexOf( name ) + 1 ] ) : fallback;
const [ name ] = args;
const knees = option( '--knees', 1 ), hips = option( '--hips', knees );
const write = args.includes( '--write' );

const clip = JSON.parse( readFileSync( clipUrl( name ), 'utf8' ) );
const times = clip.times;
const from = option( '--from', 0 ), to = option( '--to', clip.length ), ease = option( '--ease', 0 );

// How much of the change at a time: all of it inside the stretch, eased to none over `ease` either side.
const share = ( t ) => {

	if ( t < from - ease || t > to + ease ) return 0;
	const edge = Math.min( t - ( from - ease ), ( to + ease ) - t );
	if ( ease <= 0 || edge >= ease ) return 1;
	const s = edge / ease;
	return s * s * ( 3 - 2 * s );

};

const motion = await new Motion().load();
const figure = await new YBotFigure().load( motion.takes );
const rest = ( bone ) => figure.sampler.rest[ figure.sampler.index.get( bone ) ].quaternion;

const legs = [ [ 'mixamorigLeftUpLeg', hips, Infinity ], [ 'mixamorigRightUpLeg', hips, Infinity ], [ 'mixamorigLeftLeg', knees, KNEE_MOST ], [ 'mixamorigRightLeg', knees, KNEE_MOST ] ];
for ( const [ bone, scale, most ] of legs ) {

	const values = clip.tracks[ bone + '.quaternion' ];
	const base = rest( bone );
	let before = 0, after = 0;

	times.forEach( ( t, i ) => {

		const q = new THREE.Quaternion().fromArray( values, i * 4 );
		const bend = base.clone().invert().multiply( q );
		if ( bend.w < 0 ) bend.set( - bend.x, - bend.y, - bend.z, - bend.w );
		const angle = 2 * Math.acos( Math.min( 1, bend.w ) ), sin = Math.sqrt( Math.max( 0, 1 - bend.w * bend.w ) );
		if ( sin < 1e-9 ) return;

		const k = 1 + ( scale - 1 ) * share( t );
		const turned = Math.min( angle * k, Math.max( angle, most ) );
		const out = base.clone().multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( bend.x / sin, bend.y / sin, bend.z / sin ), turned ) ).normalize();
		out.toArray( values, i * 4 );
		before = Math.max( before, angle );
		after = Math.max( after, turned );

	} );

	clip.tracks[ bone + '.quaternion' ] = values.map( round );
	console.log( `${name} ${bone}: most bend ${( before * 180 / Math.PI ).toFixed( 1 )}° -> ${( after * 180 / Math.PI ).toFixed( 1 )}°` );

}

if ( write ) {

	writeFileSync( clipUrl( name ), formatClip( clip ) );
	console.log( `wrote ${clipUrl( name ).pathname.split( '/public/' )[ 1 ]}` );

}
