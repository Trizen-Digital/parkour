// The golden traces: every tape in tests/golden/tapes run headless with the Y Bot, its trace kept per physics
// engine in tests/golden/<engine>/ (the engines' traces differ: each finds contacts its own way). A change that keeps
// the game exact leaves every trace bit for bit the same.
//
//   node tools/headless/golden.mjs verify [filter] [--engine rapier|box3d] [--jobs n]
//   node tools/headless/golden.mjs bless [filter] [--engine rapier|box3d] [--jobs n]
//   node tools/headless/golden.mjs tapes [filter]     (writes the tapes again from scenarios.mjs)
//
// Bless only after a deliberate change, with the reason in the commit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare, describe } from './compare.mjs';
import { ENGINES } from '../../src/engines.js';

const PROJECT = fileURLToPath( new URL( '../../', import.meta.url ) );

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => ( args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : fallback );
const [ mode ] = args;
const filter = args.slice( 1 ).find( ( arg, i, rest ) => ! arg.startsWith( '--' ) && ! rest[ i - 1 ]?.startsWith( '--' ) );
const engine = option( '--engine', ENGINES[ 0 ] );
const jobs = Number( option( '--jobs', Math.max( 1, os.cpus().length - 2 ) ) );

if ( ! [ 'verify', 'bless', 'tapes' ].includes( mode ) || ! ENGINES.includes( engine ) ) {

	console.log( `usage: golden.mjs verify|bless|tapes [filter] [--engine ${ENGINES.join( '|' )}] [--jobs n]` );
	process.exit( 2 );

}

const tapes = path.join( PROJECT, 'tests/golden/tapes' );

if ( mode === 'tapes' ) {

	const { FEATURES, COURSES } = await import( './scenarios.mjs' );
	const { scriptTape } = await import( './tape.mjs' );
	const scenarios = [ ...FEATURES, ...COURSES ].filter( ( scenario ) => ! filter || scenario.name.includes( filter ) );
	for ( const scenario of scenarios ) fs.writeFileSync( path.join( tapes, `${scenario.name}.json` ), JSON.stringify( scriptTape( scenario ) ) );
	console.log( `${scenarios.length} tapes written into tests/golden/tapes` );
	process.exit( 0 );

}

const golden = path.join( PROJECT, 'tests/golden', engine );
const out = path.join( PROJECT, 'tools/headless/out/golden', engine );
fs.mkdirSync( golden, { recursive: true } );
fs.mkdirSync( out, { recursive: true } );

const files = fs.readdirSync( tapes ).filter( ( file ) => file.endsWith( '.json' ) && ( ! filter || file.includes( filter ) ) ).sort();
const runner = path.join( PROJECT, 'tools/headless/run.mjs' );
let next = 0, failed = 0;
const started = Date.now();

// Each tape runs in a process of its own, so no state is shared between runs.
await Promise.all( Array.from( { length: jobs }, async () => {

	while ( next < files.length ) {

		const file = files[ next ++ ];
		await new Promise( ( resolve ) => execFile( 'node', [ runner, path.join( tapes, file ), path.join( out, file ), 'ybot', engine ], { cwd: PROJECT, maxBuffer: 1 << 26 }, ( error, stdout, stderr ) => {

			if ( error ) {

				failed ++;
				console.log( `${file}: failed to run\n${( stderr || error.message ).split( '\n' ).slice( 0, 12 ).join( '\n' )}` );

			}

			resolve();

		} ) );

	}

} ) );

let differ = 0, missing = 0;

for ( const file of files ) {

	const name = file.slice( 0, - 5 );
	if ( ! fs.existsSync( path.join( out, file ) ) ) continue;
	const trace = JSON.parse( fs.readFileSync( path.join( out, file ), 'utf8' ) );

	if ( mode === 'bless' ) {

		fs.writeFileSync( path.join( golden, file ), JSON.stringify( trace ) );
		continue;

	}

	if ( ! fs.existsSync( path.join( golden, file ) ) ) {

		missing ++;
		console.log( `${name}: no golden trace (bless it)` );
		continue;

	}

	const result = compare( JSON.parse( fs.readFileSync( path.join( golden, file ), 'utf8' ) ), trace );
	if ( ! result.exact ) {

		differ ++;
		console.log( describe( name, result ) );

	}

}

const seconds = ( ( Date.now() - started ) / 1000 ).toFixed( 1 );
if ( mode === 'bless' ) console.log( `${files.length - failed} of ${files.length} traces blessed into tests/golden/${engine} (${seconds} s)` );
else console.log( `${files.length - failed - differ - missing} of ${files.length} exact on ${engine}${differ ? `, ${differ} differ` : ''}${missing ? `, ${missing} without a golden trace` : ''}${failed ? `, ${failed} failed to run` : ''} (${seconds} s)` );
process.exit( failed || differ || missing ? 1 : 0 );
