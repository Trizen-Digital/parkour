// A course definition as the course files are written: one prim, lane, spawn, node or link per line, so a change to a
// course reads as a change to those lines in a diff.

// A value as JSON on one line, spaced as the repo's code is; undefined fields are left out.
function line( v ) {

	if ( Array.isArray( v ) ) return v.length ? `[ ${v.map( line ).join( ', ' )} ]` : '[]';
	if ( v && typeof v === 'object' ) {

		const kv = Object.entries( v ).filter( ( [ , x ] ) => x !== undefined ).map( ( [ k, x ] ) => `${JSON.stringify( k )}: ${line( x )}` );
		return kv.length ? `{ ${kv.join( ', ' )} }` : '{}';

	}

	return JSON.stringify( v );

}

const list = ( items, indent ) => `[\n${items.map( ( x ) => indent + '\t' + line( x ) ).join( ',\n' )}\n${indent}]`;

/**
 * @param {object} def a course definition
 * @returns {string} the course file's text
 */
function format( def ) {

	const out = [];
	for ( const [ k, v ] of Object.entries( def ) ) {

		if ( v === undefined ) continue;
		if ( k === 'prims' || k === 'lanes' || k === 'spawns' ) out.push( `\t"${k}": ${list( v, '\t' )}` );
		else if ( k === 'route' ) out.push( `\t"route": {\n\t\t"nodes": ${list( v.nodes, '\t\t' )},\n\t\t"links": ${list( v.links, '\t\t' )}\n\t}` );
		else out.push( `\t${JSON.stringify( k )}: ${line( v )}` );

	}

	return `{\n${out.join( ',\n' )}\n}\n`;

}

export { format };
