// Captures in, clips out.
//
// A capture is a mocap clip in `assets/mocap/<clip>.json` (three.js clip JSON: per-track times and values). A clip
// is what the game samples for a take (`public/data/takes/<take>.json`): the take's length, one row of key times
// shared by every track, and each track's values, all to five decimals (a hundredth of a millimetre, a few
// millionths of a radian: well under anything the eye sees, and a third of the file).

import { existsSync, readFileSync } from 'node:fs';
import { QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { specLength, takePace } from './specs.js';

const ROOT = new URL( '../../../', import.meta.url );
const CAPTURES = new URL( 'assets/mocap/', ROOT );
const CLIPS = new URL( 'public/data/takes/', ROOT );

// The captures' frame rate: a take gets a key on every frame of its capture.
const FRAMES_PER_SECOND = 60;

// An anchor this close to a frame (s of capture) adds no key; farther, it gets a key of its own so its beat lands on
// one.
const BEAT_SNAP = 1e-3;

// The track a take's shift moves: the hips', which carry the whole body.
const HIPS = 'mixamorigHips.position';

function round( value ) {

	return Math.round( value * 1e5 ) / 1e5 || 0;

}

function captureUrl( clip ) {

	return new URL( clip + '.json', CAPTURES );

}

function readCapture( clip ) {

	return JSON.parse( readFileSync( captureUrl( clip ), 'utf8' ) );

}

// A capture's length in seconds, or undefined when there is none by that name.
function captureLength( clip ) {

	return existsSync( captureUrl( clip ) ) ? readCapture( clip ).duration : undefined;

}

function clipUrl( take ) {

	return new URL( take + '.json', CLIPS );

}

function readClip( take ) {

	return existsSync( clipUrl( take ) ) ? readFileSync( clipUrl( take ), 'utf8' ) : null;

}

// Take time at a clip time: straight lines between the anchors (`[ clipTime, takeTime ]`).
function takeTimeAt( anchors, clipTime ) {

	for ( let i = 1; i < anchors.length; i ++ ) {

		const [ c0, t0 ] = anchors[ i - 1 ], [ c1, t1 ] = anchors[ i ];
		if ( clipTime <= c1 && c1 > c0 ) return t0 + ( clipTime - c0 ) * ( t1 - t0 ) / ( c1 - c0 );

	}

	return anchors.at( - 1 )[ 1 ];

}

/**
 * Cuts a take out of its capture: a key on every capture frame the anchors cover and on every anchor, each moved to
 * its take time by the anchors and divided by the take's pace. A looping take wraps clip time round its span;
 * otherwise a clip time past the span holds the span's last pose.
 */
function cut( take, capture = readCapture( take.from.clip ) ) {

	const anchors = take.anchors, pace = takePace( take );
	const [ start, end ] = take.from.span;
	const first = anchors[ 0 ][ 0 ], last = anchors.at( - 1 )[ 0 ];

	const clipTimes = anchors.map( ( [ clipTime ] ) => clipTime );
	for ( let frame = Math.ceil( first * FRAMES_PER_SECOND ); frame / FRAMES_PER_SECOND < last; frame ++ ) {

		const time = frame / FRAMES_PER_SECOND;
		if ( clipTimes.every( ( clipTime ) => Math.abs( time - clipTime ) > BEAT_SNAP ) ) clipTimes.push( time );

	}

	clipTimes.sort( ( a, b ) => a - b );

	const at = take.loop ?
		( time ) => time > end ? start + ( time - start ) % ( end - start ) : Math.max( time, start ) :
		( time ) => Math.min( Math.max( time, start ), end );

	const keys = [];
	for ( const clipTime of clipTimes ) {

		const time = round( takeTimeAt( anchors, clipTime ) / pace );
		if ( keys.length === 0 || time > keys.at( - 1 ).time ) keys.push( { time, clipTime: at( clipTime ) } );

	}

	// A shift moves the whole body (the hips carry it) against the take's origin, the runner's centre.
	const shift = take.shift ?? [ 0, 0, 0 ];
	const tracks = {};
	for ( const track of capture.tracks ) {

		const Track = track.name.endsWith( '.quaternion' ) ? QuaternionKeyframeTrack : VectorKeyframeTrack;
		const interpolant = new Track( track.name, track.times, track.values ).createInterpolant();
		const offset = track.name === HIPS ? shift : null;
		tracks[ track.name ] = keys.flatMap( ( key ) => Array.from( interpolant.evaluate( key.clipTime ), ( value, i ) => round( offset ? value + offset[ i ] : value ) ) );

	}

	return { length: specLength( take ) / pace, times: keys.map( ( key ) => key.time ), tracks };

}

// One track per line, so a rebuilt take shows which bones changed.
function formatClip( clip ) {

	const tracks = Object.entries( clip.tracks ).map( ( [ name, values ] ) => `\t\t${ JSON.stringify( name ) }: ${ JSON.stringify( values ) }` );

	return `{\n\t"length": ${ JSON.stringify( clip.length ) },\n\t"times": ${ JSON.stringify( clip.times ) },\n\t"tracks": {\n${ tracks.join( ',\n' ) }\n\t}\n}\n`;

}

/**
 * Everything wrong with a stored clip for a take of the given length, as sentences.
 */
function clipProblems( text, length ) {

	const problems = [];
	let clip;

	try {

		clip = JSON.parse( text );

	} catch ( error ) {

		return [ 'is not JSON: ' + error.message ];

	}

	if ( clip.length !== length ) problems.push( `is ${ clip.length } s long; the table says ${ length }` );
	const times = clip.times ?? [];
	// Before its first key a clip holds that pose (one kept take starts a millisecond in).
	if ( ! ( times[ 0 ] >= 0 ) || times.some( ( time, i ) => i > 0 && ! ( time > times[ i - 1 ] ) ) || times.at( - 1 ) > length + 1e-5 ) problems.push( 'key times must rise within the take' );

	for ( const [ name, values ] of Object.entries( clip.tracks ?? {} ) ) {

		const size = name.endsWith( '.quaternion' ) ? 4 : name.endsWith( '.position' ) ? 3 : 0;
		if ( ! size ) problems.push( `track ${ name } is neither a position nor a quaternion` );
		else if ( values.length !== times.length * size ) problems.push( `track ${ name } has ${ values.length } values for ${ times.length } keys` );

	}

	return problems;

}

export { cut, formatClip, readClip, readCapture, captureLength, clipUrl, clipProblems, takeTimeAt, round, CLIPS };
