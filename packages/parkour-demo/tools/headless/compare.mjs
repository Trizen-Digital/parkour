// Two traces compared value for value: exact, or the first step and the first frame that differ, with the columns
// and both rows. A trace read from JSON has lost the sign of zero, so −0 and 0 count as the same (and NaN as NaN).

import { STEP_COLUMNS, FRAME_COLUMNS } from './trace.mjs';

function firstDifference( a, b, columns, ignore ) {

	const rows = Math.max( a.length, b.length );
	for ( let i = 0; i < rows; i ++ ) {

		const rowA = a[ i ], rowB = b[ i ];
		if ( ! rowA || ! rowB ) return { index: i, columns: [ 'length' ], a: rowA, b: rowB };
		const differ = [];
		for ( let c = 0; c < columns.length; c ++ ) {

			if ( ignore.has( columns[ c ] ) ) continue;
			if ( rowA[ c ] !== rowB[ c ] && ! Object.is( rowA[ c ], rowB[ c ] ) ) differ.push( columns[ c ] );

		}

		if ( differ.length ) return { index: i, columns: differ, a: rowA, b: rowB };

	}

	return null;

}

/**
 * @param {object} a a trace
 * @param {object} b another
 * @param {object} [options]
 * @param {string[]} [options.ignore] columns left out
 * @returns {{ exact: boolean, steps: number, frames: number, step: object|null, frame: object|null,
 *   maxPositionError: number }}
 */
function compare( a, b, { ignore = [] } = {} ) {

	const skip = new Set( ignore );
	const step = firstDifference( a.steps, b.steps, STEP_COLUMNS, skip );
	const frame = firstDifference( a.frames, b.frames, FRAME_COLUMNS, skip );
	let maxPositionError = 0;
	const shared = Math.min( a.steps.length, b.steps.length );
	for ( let i = 0; i < shared; i ++ ) maxPositionError = Math.max( maxPositionError, Math.hypot( a.steps[ i ][ 1 ] - b.steps[ i ][ 1 ], a.steps[ i ][ 2 ] - b.steps[ i ][ 2 ], a.steps[ i ][ 3 ] - b.steps[ i ][ 3 ] ) );
	return { exact: ! step && ! frame, steps: a.steps.length, frames: a.frames.length, step, frame, maxPositionError };

}

/**
 * @param {string} name
 * @param {object} result from compare()
 * @returns {string} a line, or a few when it differs
 */
function describe( name, result ) {

	if ( result.exact ) return `${name}: exact (${result.steps} steps, ${result.frames} frames)`;
	const lines = [ `${name}: DIFFERS (max position error ${result.maxPositionError.toExponential( 2 )} m)` ];
	if ( result.step ) lines.push( `  first step ${result.step.index}: ${result.step.columns.join( ', ' )}\n    a ${JSON.stringify( result.step.a )}\n    b ${JSON.stringify( result.step.b )}` );
	if ( result.frame ) lines.push( `  first frame ${result.frame.index}: ${result.frame.columns.join( ', ' )}\n    a ${JSON.stringify( result.frame.a )}\n    b ${JSON.stringify( result.frame.b )}` );
	return lines.join( '\n' );

}

export { compare, describe };
