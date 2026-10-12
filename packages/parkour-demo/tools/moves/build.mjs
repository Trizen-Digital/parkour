// npm run moves:build
//
// Builds the game's take and move table (`public/data/moves.json`) from the family specs, and the clip of every take
// built from a capture (`public/data/takes/<take>.json`). Kept takes and placeholders keep their stored clips: the
// build only checks they are there. Writes a file only when it changes.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadSpecs, validate, isBuilt } from './lib/specs.js';
import { buildTable, formatTable } from './lib/table.js';
import { cut, formatClip, readClip, captureLength, clipUrl } from './lib/clips.js';

const TABLE = new URL( '../../public/data/moves.json', import.meta.url );

const specs = await loadSpecs();
const problems = validate( specs, captureLength );

if ( problems.length ) {

	console.error( problems.join( '\n' ) );
	process.exit( 1 );

}

let written = 0;

function write( url, text ) {

	let current = null;
	try {

		current = readFileSync( url, 'utf8' );

	} catch {}

	if ( current === text ) return;
	writeFileSync( url, text );
	written ++;
	console.log( 'wrote', url.pathname.split( '/public/' )[ 1 ] );

}

write( TABLE, formatTable( buildTable( specs ) ) );

let built = 0, kept = 0;

for ( const take of specs.takes.values() ) {

	if ( isBuilt( take ) ) {

		write( clipUrl( take.name ), formatClip( cut( take ) ) );
		built ++;

	} else if ( readClip( take.name ) === null ) {

		console.error( `${ take.name }: no stored clip to keep` );
		process.exitCode = 1;

	} else {

		kept ++;

	}

}

console.log( `${ specs.takes.size } takes (${ built } built from captures, ${ kept } kept), ${ specs.moves.size } moves; ${ written } file${ written === 1 ? '' : 's' } changed` );
