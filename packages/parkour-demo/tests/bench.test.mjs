// The benchmark: its course lays every station end to end with ids no two share; the autopilot plays stations through
// raw input alone and the run plays again exactly (from a keyframe, and on a second simulation, to the same
// fingerprint); and a comment finds its place again by its stations on another view's run. The whole benchmark on both
// engines and in both views is `node tools/bench/run.mjs --engine all --view all`.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { Course } = await import( '../src/course/Course.js' );
const { metrics } = await import( '../src/course/metrics.js' );
const { World } = await import( '@trizendigital/parkour/world/World.js' );
const { fromCourse } = await import( '../src/world/fromCourse.js' );
const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { backendOf } = await import( '../src/engines.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { STATIONS } = await import( '../src/bench/stations.js' );
const { benchCourse } = await import( '../src/bench/course.js' );
const { BenchRun } = await import( '../src/bench/BenchRun.js' );
const { DT } = await import( '../src/bench/Autopilot.js' );
const { makeComment, placeComment } = await import( '../src/bench/comments.js' );

// A few stations of different kinds: a vault, a wall run, a catch and climb, a precision jump, a trick off a drop.
const SOME = [ 'warm-up', 'vault-kong-0.9', 'wallrun-left-3', 'catch-1.7', 'precision-3', 'air-frontFlip-2' ];

async function runOf( ids, { view = 'third', engine = 'rapier' } = {} ) {

	const { def, placed } = benchCourse( STATIONS.filter( ( station ) => ids.includes( station.id ) ) );
	const sim = new Simulation( { world: new World( fromCourse( new Course( def, { metrics } ) ) ), figure: new Figure(), engine: backendOf( engine ), page: { storage: null, eventWindow: null, eventDocument: null, navigator: null } } );
	await sim.load();
	return new BenchRun( sim, placed, { view } ).start();

}

test( 'the benchmark course lays every station end to end, each with an id of its own and a way through', () => {

	const { def, placed } = benchCourse();
	assert.equal( placed.length, STATIONS.length );
	assert.equal( new Set( STATIONS.map( ( station ) => station.id ) ).size, STATIONS.length );
	placed.forEach( ( place, i ) => {

		assert.equal( place.z0, i ? placed[ i - 1 ].z1 : 0 );
		assert.ok( place.station.length > 0 && place.station.steps?.length, place.station.id );

	} );
	assert.ok( def.prims.every( ( prim ) => prim.id ) );

} );

test( 'the autopilot plays stations through raw input alone, and the run plays again exactly from its keyframes', async () => {

	const run = await runOf( SOME );
	run.runToEnd();
	const order = STATIONS.filter( ( station ) => SOME.includes( station.id ) ).map( ( station ) => station.id );
	assert.deepEqual( run.log.map( ( record ) => [ record.id, record.result ] ), order.map( ( id ) => [ id, 'pass' ] ) );
	assert.ok( run.keyframes.length >= SOME.length );

	// Back to the middle of the run, then on to its end: every frame comes out as it was worked out.
	for ( const f of [ Math.round( run.frames / 2 ), 7, run.frames - 300 ] ) {

		run.seek( f );
		assert.equal( run.f, f );

	}

	run.seek( 200 );
	while ( run.step() );
	assert.equal( run.mismatch, null );
	assert.equal( run.f, run.frames );

	// A run on a simulation of its own comes out the same.
	const again = await runOf( SOME );
	again.runToEnd();
	assert.equal( again.frames, run.frames );
	assert.equal( again.fingerprint(), run.fingerprint() );
	assert.deepEqual( again.hashes, run.hashes );
	run.sim.dispose();
	again.sim.dispose();

} );

test( 'a comment finds its place again by its stations: exactly on its own run, at the same time into them on another view\'s', async () => {

	const ids = [ 'warm-up', 'hurdle-0.5', 'vault-speed-0.9' ];
	const third = await runOf( ids ), first = await runOf( ids, { view: 'first' } );
	third.runToEnd();
	first.runToEnd();

	// Across the end of the hurdle and into the vault.
	const f0 = third.log[ 1 ].end - 120, f1 = third.log[ 2 ].start + 240;
	const comment = makeComment( { id: 'c1', text: 'the vault lands late', view: 'both', engine: 'rapier', run: third, made: { engine: 'rapier', view: 'third' }, f0, f1 } );
	assert.equal( comment.station, 'hurdle-0.5' );
	assert.equal( comment.endStation, 'vault-speed-0.9' );
	assert.deepEqual( comment.stations, [ 'hurdle-0.5', 'vault-speed-0.9' ] );
	assert.deepEqual( placeComment( comment, third, { engine: 'rapier', view: 'third' } ), { f0, f1, exact: true } );

	const there = placeComment( comment, first, { engine: 'rapier', view: 'first' } );
	assert.equal( there.exact, false );
	assert.equal( there.f0 - first.log[ 1 ].start, f0 - third.log[ 1 ].start );
	assert.equal( there.f1 - first.log[ 2 ].start, f1 - third.log[ 2 ].start );
	assert.ok( Math.abs( comment.offset1 - ( f1 - third.log[ 2 ].start ) * DT ) < 1e-3 );
	third.sim.dispose();
	first.sim.dispose();

} );
