// Writes the demo's levels, laid out in tools/courses/ (foundry.js, tutorial.js), to public/courses/<name>.json.
//   node tools/courses/write-levels.mjs [name …]
// One prim or spawn per line, so a change to a level reads as a change to those lines in a diff.
import { writeFileSync } from 'node:fs';
import { foundry } from './foundry.js';
import { tutorial } from './tutorial.js';
import { format } from './format.js';

const LEVELS = { foundry, tutorial };

const names = process.argv.slice( 2 );
for ( const [ name, make ] of Object.entries( LEVELS ) ) {

	if ( names.length && ! names.includes( name ) ) continue;
	const def = make();
	const text = format( def );
	JSON.parse( text );
	writeFileSync( new URL( `../../public/courses/${def.name}.json`, import.meta.url ), text );
	console.log( `${def.name}: ${def.prims.length} prims, ${def.spawns?.length ?? 0} named spawns` );

}
