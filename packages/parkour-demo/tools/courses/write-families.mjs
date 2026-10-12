// Writes the family test courses (src/course/families.js) to public/courses/test_<family>.json.
//   node tools/courses/write-families.mjs [family …]
// One prim, lane, node or link per line, so a change to a course reads as a change to those lines in a diff.
import { writeFileSync } from 'node:fs';
import { FAMILIES } from '../../src/course/families.js';
import { format } from './format.js';

const names = process.argv.slice( 2 );
for ( const [ name, make ] of Object.entries( FAMILIES ) ) {

	if ( names.length && ! names.includes( name ) ) continue;
	const def = make();
	const text = format( def );
	JSON.parse( text );
	writeFileSync( new URL( `../../public/courses/${def.name}.json`, import.meta.url ), text );
	console.log( `${def.name}: ${def.lanes.length} lanes (${def.lanes.filter( ( l ) => l.expect === 'fail' ).length} expected to fail), ${def.prims.length} prims, ${def.route.links.length} links` );

}
