// Comments on the benchmark: what one keeps, and where it falls on a run. A comment covers a stretch of the timeline
// and says which view and engine it is about. It keeps the frames it was made at, on the run it was made on, and, for
// each end, the station that end fell in and the time into that station, so it finds its place again on another run
// (the other view or engine) or after the code changes, where the stations before it take more or less time.
//
// They live in qa/bench/comments.json (`qa-bench-comments/1`, through the QA store); the page (Bench.js) makes and
// shows them, and tools/bench/run.mjs --comment and the QA console's bench helpers find them again.

import { DT } from './Autopilot.js';

const FORMAT = 'qa-bench-comments/1';

/**
 * A new comment on a stretch of a run.
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.text
 * @param {string} options.view what it is about: 'third', 'first' or 'both'
 * @param {string} options.engine what it is about: an engine's name, or 'both'
 * @param {BenchRun} options.run the run it is made on (its engine is `options.made.engine`)
 * @param {object} options.made `{ engine, view }`: that run's
 * @param {number} options.f0 the stretch's first frame
 * @param {number} options.f1 its last
 * @param {object|null} [options.build] the code it was made on (the QA store's build)
 * @param {Date} [options.now]
 * @returns {object}
 */
function makeComment( { id, text, view, engine, run, made, f0, f1, build = null, now = new Date() } ) {

	const at = ( f ) => {

		const index = run.stationOf[ Math.max( 0, f - 1 ) ] ?? 0, station = run.placed[ index ].station;
		return { station, offset: + ( ( f - ( run.stationStart( index ) ?? 0 ) ) * DT ).toFixed( 4 ) };

	};

	const from = at( f0 ), to = at( f1 );
	return {
		id, created: now.toISOString(), updated: now.toISOString(), text, view, engine, made: { ...made },
		f0, f1, t0: + ( f0 * DT ).toFixed( 3 ), t1: + ( f1 * DT ).toFixed( 3 ),
		station: from.station.id, stationName: from.station.name, offset0: from.offset,
		endStation: to.station.id, offset1: to.offset,
		stations: [ ...new Set( run.stationOf.slice( Math.max( 0, f0 - 1 ), f1 ) ) ].map( ( index ) => run.placed[ index ].station.id ),
		build, still: null, done: false,
	};

}

/**
 * Where a comment falls on a run: each end at the same time into the same station as where it was made; exactly
 * where it was made when this is that run and both ends come out on the frames it kept.
 * @param {object} comment
 * @param {BenchRun} run
 * @param {object} on `{ engine, view }`: the run's
 * @returns {{f0: number, f1: number, exact: boolean}|null} null before the run reaches the stations
 */
function placeComment( comment, run, on ) {

	const startOf = ( id ) => {

		const index = run.placed.findIndex( ( place ) => place.station.id === id );
		return index < 0 ? null : run.stationStart( index );

	};

	const start = startOf( comment.station ), end = startOf( comment.endStation ?? comment.station );
	if ( start === null || end === null ) return null;
	const f0 = start + Math.round( comment.offset0 / DT ), f1 = Math.max( f0, end + Math.round( comment.offset1 / DT ) );
	const exact = comment.made?.engine === on.engine && comment.made?.view === on.view && f0 === comment.f0 && f1 === comment.f1;
	return { f0, f1, exact };

}

export { FORMAT, makeComment, placeComment };
