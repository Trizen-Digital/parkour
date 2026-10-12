// The simulation reads no pose: every golden tape run with the stub figure (no skeleton, no clips) must give the
// Y Bot's golden trace on the same physics engine. Only the ragdoll (which takes the body) and the first-person camera
// (which rides the head) may differ.
//
//   node tools/headless/purity.mjs [filter] [--engine rapier|box3d]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, describe } from './compare.mjs';

const { run } = await import( './run.mjs' );
const { ENGINES } = await import( '../../src/engines.js' );
const PROJECT = fileURLToPath( new URL( '../../', import.meta.url ) );
const args = process.argv.slice( 2 );
const engine = args.includes( '--engine' ) ? args[ args.indexOf( '--engine' ) + 1 ] : ENGINES[ 0 ];
const filter = args.find( ( arg, i ) => ! arg.startsWith( '--' ) && args[ i - 1 ] !== '--engine' );
if ( ! ENGINES.includes( engine ) ) throw new Error( `no physics engine '${engine}': ${ENGINES.join( ', ' )}` );
const folder = path.join( PROJECT, 'tests/golden' );
const tapes = fs.readdirSync( path.join( folder, 'tapes' ) ).filter( ( file ) => file.endsWith( '.json' ) && ( ! filter || file.includes( filter ) ) ).sort();
const CAMERA = new Set( [ 'camX', 'camY', 'camZ', 'camQx', 'camQy', 'camQz', 'camQw' ] );
const MODE = 8;

let pure = 0, throughRagdoll = 0, throughHead = 0, impure = 0;
for ( const file of tapes ) {

	const name = file.slice( 0, - 5 );
	const tape = JSON.parse( fs.readFileSync( path.join( folder, 'tapes', file ), 'utf8' ) );
	const withBody = JSON.parse( fs.readFileSync( path.join( folder, engine, file ), 'utf8' ) );
	const result = compare( withBody, await run( tape, { figure: 'stub', engine } ) );

	// Differences from the step the ragdoll takes the body (and the frame it happens in) are the ragdoll's.
	const ragdollAt = withBody.steps.findIndex( ( step ) => step[ MODE ] === 'ragdoll' );
	const fromRagdoll = ragdollAt >= 0 && ( ! result.step || result.step.index >= ragdollAt ) && ( ! result.frame || result.frame.index >= withBody.steps[ ragdollAt ][ 0 ] );
	if ( result.exact ) {

		pure ++;
		console.log( `${name}: pure` );

	} else if ( ! result.step && result.frame.columns.every( ( column ) => CAMERA.has( column ) ) ) {

		throughHead ++;
		console.log( `${name}: the camera differs where it rides the head (first person)` );

	} else if ( fromRagdoll ) {

		throughRagdoll ++;
		console.log( `${name}: differs once the ragdoll takes the body` );

	} else {

		impure ++;
		console.log( describe( name, result ) );

	}

}

console.log( `${pure} pure, ${throughRagdoll} differ only through the ragdoll, ${throughHead} only in the first-person camera, ${impure} impure (${engine})` );
process.exit( impure ? 1 : 0 );
