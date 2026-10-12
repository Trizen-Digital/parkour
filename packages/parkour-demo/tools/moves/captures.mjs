// npm run moves:captures
//
// The capture list: every placeholder take (made without a capture of ours) with what it is for and the moves that
// wait on it, by family, the families that hold up the most moves first. A capture replaces a placeholder by name:
// its spec gets `from` and anchors instead of `fill`, and the build cuts it.

import { fileURLToPath } from 'node:url';
import { loadSpecs } from './lib/specs.js';

/**
 * The placeholders by family, each `{ take, kind, reason, moves }`, families ordered by the moves they hold up.
 */
function captureList( { takes, moves } ) {

	const families = new Map();

	for ( const take of takes.values() ) {

		if ( ! take.fill ) continue;
		const waiting = [ ...moves.values() ].filter( ( move ) => move.take === take.name ).map( ( move ) => move.name );
		if ( ! families.has( take.family ) ) families.set( take.family, [] );
		families.get( take.family ).push( { take: take.name, kind: take.fill.kind, reason: take.fill.reason, moves: waiting } );

	}

	const blocked = ( entries ) => entries.reduce( ( sum, entry ) => sum + entry.moves.length, 0 );

	return [ ...families ]
		.map( ( [ family, entries ] ) => ( { family, entries } ) )
		.sort( ( a, b ) => blocked( b.entries ) - blocked( a.entries ) || b.entries.length - a.entries.length || a.family.localeCompare( b.family ) );

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const list = captureList( await loadSpecs() );
	const entries = list.flatMap( ( family ) => family.entries );
	const kinds = new Map();
	for ( const entry of entries ) kinds.set( entry.kind, ( kinds.get( entry.kind ) ?? 0 ) + 1 );

	console.log( `${ entries.length } takes wait for a capture (${ [ ...kinds ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).map( ( [ kind, count ] ) => `${ kind } ${ count }` ).join( ', ' ) }).` );

	for ( const { family, entries: takes } of list ) {

		const moves = takes.reduce( ( sum, entry ) => sum + entry.moves.length, 0 );
		console.log( `\n${ family }: ${ takes.length } take${ takes.length === 1 ? '' : 's' }, ${ moves } move${ moves === 1 ? '' : 's' } waiting` );
		const width = Math.max( ...takes.map( ( entry ) => entry.take.length ) );
		for ( const entry of takes ) {

			const use = entry.moves.length ? entry.moves.join( ', ' ) : 'the pose graph';
			console.log( `  ${ entry.take.padEnd( width ) }  ${ entry.kind.padEnd( 10 ) }  ${ entry.reason } (${ use })` );

		}

	}

}

export { captureList };
