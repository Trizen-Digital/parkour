// A snapshot restores a run exactly: each golden tape is played straight, and again with a snapshot taken halfway,
// three seconds of other input, and the snapshot restored; the second halves must match bit for bit. (A snapshot
// taken while the ragdoll has the body cannot be restored; those tapes are skipped.)
//
//   node tools/headless/snapshot-check.mjs [filter] [--figure ybot|stub] [--engine rapier|box3d]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { build } = await import( './run.mjs' );
const { DeviceState } = await import( '@trizen/parkour/input/deviceState.js' );
const { Trace } = await import( './trace.mjs' );
const { takeSnapshot, restoreSnapshot } = await import( '@trizen/parkour/sim/snapshot.js' );
const { compare, describe } = await import( './compare.mjs' );
const { ENGINES } = await import( '../../src/engines.js' );

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : fallback;
const figure = option( '--figure', 'ybot' );
const engine = option( '--engine', ENGINES[ 0 ] );
if ( ! ENGINES.includes( engine ) ) throw new Error( `no physics engine '${engine}': ${ENGINES.join( ', ' )}` );
const folder = path.join( fileURLToPath( new URL( '../../', import.meta.url ) ), 'tests/golden/tapes' );
const filter = args.find( ( arg, i ) => ! arg.startsWith( '--' ) && ! args[ i - 1 ]?.startsWith( '--' ) );
const tapes = fs.readdirSync( folder ).filter( ( file ) => ! filter || file.includes( filter ) ).map( ( file ) => file.slice( 0, - 5 ) ).sort();

// The other input: forward, weaving left and right, a jump now and then, the mouse turning.
const wander = ( i ) => ( { dt: 1 / 60, keys: [ 'KeyW', ...( i % 40 < 20 ? [ 'KeyA' ] : [ 'KeyD' ] ), ...( i % 50 === 0 ? [ 'Space' ] : [] ) ], buttons: [], mouse: [ 3, 0, 0 ], edges: i % 50 === 0 ? [ [ 'Space', 'pressed' ] ] : [], pad: null, enabled: true, editing: false } );
const WANDER_FRAMES = 180;

let failed = 0;
for ( const name of tapes ) {

	const tape = JSON.parse( fs.readFileSync( path.join( folder, `${name}.json` ), 'utf8' ) );
	const half = Math.floor( tape.frames.length / 2 );
	const play = async ( interrupt ) => {

		const sim = await build( tape, { figure, engine } );
		const raw = new DeviceState( sim.input );
		const trace = new Trace( sim );
		sim.respawn( tape.start.spawn ?? tape.start );
		raw.play();
		let recording = false;
		sim.onStep = () => recording && trace.step();

		// Every simulation lets go of its physics worlds when done: box3d keeps only so many alive at once.
		try {

			for ( let f = 0; f < tape.frames.length; f ++ ) {

				if ( f === half ) {

					if ( interrupt ) {

						const snapshot = takeSnapshot( sim );
						if ( ! snapshot.restorable ) return null;
						for ( let i = 0; i < WANDER_FRAMES; i ++ ) sim.frame( 1 / 60, () => raw.apply( wander( i ) ) );
						restoreSnapshot( sim, snapshot );

					}

					recording = true;

				}

				sim.frame( tape.frames[ f ].dt, () => raw.apply( tape.frames[ f ] ) );
				if ( recording ) trace.frame();

			}

			return trace.toJSON();

		} finally {

			sim.dispose();

		}

	};

	const straight = await play( false ), restored = await play( true );
	if ( ! restored ) {

		console.log( `${name}: the ragdoll had the body at the snapshot (skipped)` );
		continue;

	}

	const result = compare( straight, restored );
	if ( result.exact ) console.log( `${name}: exact` );
	else {

		failed ++;
		console.log( describe( name, result ) );

	}

}

console.log( failed ? `${failed} tape(s) differ after a restore (${engine})` : `every restore exact (${engine})` );
process.exit( failed ? 1 : 0 );
