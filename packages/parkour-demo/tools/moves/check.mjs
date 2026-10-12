// npm run moves:check
//
// The shipped motion data is what the specs build: the specs hold together (anchors, markers, spans, captures), the
// table equals the one they build, every take built from a capture rebuilds to its shipped clip exactly, every kept
// clip fits its take, and no clip is left over without a take. Exits 1 on any difference.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSpecs, validate, isBuilt } from './lib/specs.js';
import { buildTable, formatTable } from './lib/table.js';
import { cut, formatClip, readClip, captureLength, clipProblems, CLIPS } from './lib/clips.js';

const TABLE = new URL( '../../public/data/moves.json', import.meta.url );

/**
 * Every difference between the specs and the shipped files, as sentences.
 */
async function check() {

	const specs = await loadSpecs();
	const problems = validate( specs, captureLength );
	const table = buildTable( specs );

	if ( readFileSync( TABLE, 'utf8' ) !== formatTable( table ) ) problems.push( 'moves.json is not what the specs build (npm run moves:build)' );

	for ( const take of specs.takes.values() ) {

		const stored = readClip( take.name );

		if ( stored === null ) problems.push( `${ take.name }: no clip` );
		else if ( isBuilt( take ) ) {

			if ( stored !== formatClip( cut( take ) ) ) problems.push( `${ take.name }: its clip is not what its capture builds (npm run moves:build)` );

		} else {

			for ( const problem of clipProblems( stored, table.takes[ take.name ].length ) ) problems.push( `${ take.name }: its clip ${ problem }` );

		}

	}

	for ( const file of readdirSync( fileURLToPath( CLIPS ) ) ) {

		if ( ! specs.takes.has( file.replace( /\.json$/, '' ) ) ) problems.push( `${ file }: a clip no take has` );

	}

	return { specs, problems };

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const { specs, problems } = await check();
	const built = [ ...specs.takes.values() ].filter( isBuilt ).length;

	if ( problems.length ) {

		console.error( problems.join( '\n' ) );
		console.error( `${ problems.length } problem${ problems.length === 1 ? '' : 's' }` );
		process.exit( 1 );

	}

	console.log( `moves.json and ${ specs.takes.size } clips match the specs (${ built } rebuilt from captures, ${ specs.takes.size - built } kept), ${ specs.moves.size } moves` );

}

export { check };
