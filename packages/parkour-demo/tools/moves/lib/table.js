// The take and move table the game loads (`public/data/moves.json`), made from the specs.
//
// A take's entry: its `length` in seconds; its `pace` when not 1 (how many times its capture's speed it plays at, by
// which the pose graph judges its time left on the capture's clock); its `stride`, how far one cycle of it carries the
// runner (m); the `markers` the game reads, `[ name, time ]`; the `sounds` the demo's sound plays, the same; `root`, the travel of a take with root motion (positions
// in metres, +Z forward, keyed by time); `additive`, the take whose first pose it is added over; `pinned` and `pinAt`,
// how the root bone is held. A move's entry: the `take` it
// plays and the `span` of it, its `length` and `rate`, its blend-in (and `blendInCurve` when not straight) and
// blend-out, `holdAtEnd` (it waits at its last pose instead of blending out), the `layer` it plays into, and `mask` when
// it shows only on part of the body (`upper`: from the spine up, the legs going on beneath it).
//
// Every time is divided by the take's pace here, and nowhere else: the shipped take plays at rate 1.

import { specLength, takePace } from './specs.js';

function takeEntry( take ) {

	const pace = takePace( take );
	const entry = { length: specLength( take ) / pace };

	if ( pace !== 1 ) entry.pace = pace;
	if ( take.stride !== undefined ) entry.stride = take.stride;

	if ( take.markers?.length ) entry.markers = take.markers.map( ( [ name, time ] ) => [ name, time / pace ] );
	if ( take.sounds?.length ) entry.sounds = take.sounds.map( ( [ name, time ] ) => [ name, time / pace ] );
	if ( take.root ) entry.root = { times: take.root.times.map( ( time ) => time / pace ), positions: take.root.positions };
	if ( take.additive ) entry.additive = take.additive;
	if ( take.pinned ) entry.pinned = true;
	if ( take.pinAt ) entry.pinAt = take.pinAt;

	return entry;

}

function moveEntry( move, take ) {

	const pace = takePace( take );
	const span = ( move.span ?? [ 0, specLength( take ) ] ).map( ( time ) => time / pace );
	const entry = {
		take: move.take,
		span,
		// Without a length of its own a move lasts its span; an authored length (rounded where it was measured) wins.
		length: move.length ?? span[ 1 ] - span[ 0 ],
		rate: move.rate ?? 1,
		blendIn: move.blendIn
	};

	if ( move.blendInCurve ) entry.blendInCurve = move.blendInCurve;
	entry.blendOut = move.blendOut;
	if ( move.holdAtEnd ) entry.holdAtEnd = true;
	entry.layer = move.layer ?? 'body';
	if ( move.mask ) entry.mask = move.mask;

	return entry;

}

/**
 * The table, in family order.
 * @returns {{ takes: object, moves: object }}
 */
function buildTable( { takes, moves } ) {

	const table = { takes: {}, moves: {} };

	for ( const take of takes.values() ) table.takes[ take.name ] = takeEntry( take );
	for ( const move of moves.values() ) table.moves[ move.name ] = moveEntry( move, takes.get( move.take ) );

	return table;

}

// One take or move per line, so a change to one shows as one line.
function formatTable( table ) {

	const lines = ( entries ) => Object.entries( entries ).map( ( [ name, entry ] ) => `\t\t${ JSON.stringify( name ) }: ${ JSON.stringify( entry ) }` ).join( ',\n' );

	return `{\n\t"takes": {\n${ lines( table.takes ) }\n\t},\n\t"moves": {\n${ lines( table.moves ) }\n\t}\n}\n`;

}

export { buildTable, formatTable, takeEntry, moveEntry };
