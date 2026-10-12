// Ladders, run on test_basic's (4.5 m up the tower's face at x = 7, its rungs on z = 17.85, facing back down the
// course) and on a ladder that stops short of its wall's top.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { worldFor } = await import( '../tools/headless/courses.mjs' );
const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { backendOf } = await import( '../src/engines.js' );
const { Course } = await import( '../src/course/Course.js' );
const { metrics } = await import( '../src/course/metrics.js' );
const { World } = await import( '@trizendigital/parkour/world/World.js' );
const { fromCourse } = await import( '../src/world/fromCourse.js' );

const NO_PAGE = { storage: null, eventWindow: null, eventDocument: null, navigator: null };
const STANDING = 0.9215;
const near = ( a, b, epsilon = 1e-6 ) => assert.ok( Math.abs( a - b ) < epsilon, `expected ${a} = ${b}` );

async function at( world, x, z ) {

	const sim = new Simulation( { world, page: NO_PAGE, engine: backendOf( 'rapier' ) } );
	await sim.load();
	sim.respawn( { position: [ x, STANDING, z ], yaw: 0 } );
	return sim;

}

// Frames at 60 a second with these keys held and the grab held or not.
function play( sim, frames, keys = [], grab = true, until = () => false ) {

	for ( let f = 0; f < frames && ! until( sim.runner ); f ++ ) {

		for ( const key of keys ) if ( ! sim.input.keys.has( key ) ) sim.input.queueKey( key, 'pressed' );
		for ( const key of sim.input.keys ) if ( ! keys.includes( key ) ) sim.input.queueKey( key, 'released' );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( keys );
			input.mouseButtons = new Set( grab ? [ 0 ] : [] );
			input.enabled = true;

		} );

	}

}

const onLadder = ( r ) => r.state === 'onLadder';

test( 'grab held at a ladder\'s foot takes hold of it, a quarter of a metre out from the rungs, facing them', async () => {

	const sim = await at( worldFor( 'test_basic' ), 7, 15.5 );
	const runner = sim.runner;

	play( sim, 120, [ 'KeyW' ], true, onLadder );
	assert.equal( runner.state, 'onLadder' );
	play( sim, 30 );
	near( runner.position.x, 7 );
	near( runner.position.z, 17.85 - 0.25 );
	near( runner.yaw, 0 );
	assert.equal( sim.motion.graph.machines.ladder.current.name, 'hold' );

} );

test( 'on a ladder the stick climbs at 1.2 m/s and slides down at 4 m/s; sliding near the floor lets go', async () => {

	const sim = await at( worldFor( 'test_basic' ), 7, 15.5 );
	const runner = sim.runner;

	play( sim, 120, [ 'KeyW' ], true, onLadder );
	play( sim, 30 );
	let y = runner.position.y;
	play( sim, 30, [ 'KeyW' ] );
	near( runner.position.y - y, 1.2 * 0.5, 0.02 );
	assert.equal( sim.motion.graph.machines.ladder.current.name, 'climb' );

	y = runner.position.y;
	play( sim, 6, [ 'KeyS' ] );
	near( y - runner.position.y, 4 * 0.1, 0.04 );
	assert.equal( sim.motion.graph.machines.ladder.current.name, 'slideDown' );

	play( sim, 60, [ 'KeyS' ], true, ( r ) => r.state !== 'onLadder' );
	assert.equal( runner.state, 'falling' );
	assert.ok( runner.position.y < 1.4 + STANDING );

} );

test( 'at the top the runner climbs out between the rails and stands on the roof', async () => {

	const sim = await at( worldFor( 'test_basic' ), 7, 15.5 );
	const runner = sim.runner;

	play( sim, 120, [ 'KeyW' ], true, onLadder );
	play( sim, 300, [ 'KeyW' ], true, ( r ) => r.state === 'toppingOut' );
	assert.equal( sim.motion.moves.playing()?.name, 'pipeTopOut' );
	play( sim, 120, [ 'KeyW' ], false, ( r ) => r.grounded );
	assert.ok( runner.grounded );
	near( runner.position.y, 4.5 + STANDING, 0.01 );
	assert.ok( runner.position.z > 18 );
	assert.equal( runner.clock.held( 'noCollision' ), false );

} );

test( 'jump released leaps off a ladder, which then waits a moment before it is taken again', async () => {

	const sim = await at( worldFor( 'test_basic' ), 7, 15.5 );
	const runner = sim.runner;

	play( sim, 120, [ 'KeyW' ], true, onLadder );
	play( sim, 60, [ 'KeyW' ] );
	play( sim, 4, [ 'Space' ] );
	play( sim, 1, [] );
	assert.equal( runner.state, 'rising' );
	assert.ok( runner.clock.held( 'ladderLock' ) );

} );

test( 'a ladder with no floor at its top holds the runner at its top rung', async () => {

	const course = new Course( {
		name: 'capped_ladder',
		spawn: { p: [ 0, 0, 0 ], yaw: 0 },
		prims: [
			{ type: 'box', id: 'floor', min: [ - 5, - 1, - 5 ], max: [ 5, 0, 10 ] },
			{ type: 'box', id: 'wall', min: [ - 2, 0, 5 ], max: [ 2, 6, 6 ] },
			{ type: 'ladder', id: 'ladder', p: [ 0, 0, 4.85 ], h: 3, yaw: 180 }
		]
	}, { metrics } );
	const sim = await at( new World( fromCourse( course ) ), 0, 3 );
	const runner = sim.runner;

	play( sim, 120, [ 'KeyW' ], true, onLadder );
	play( sim, 400, [ 'KeyW' ] );
	assert.equal( runner.state, 'onLadder' );
	const top = runner.pipesAndZiplines.ladderTop( sim.world.ladders[ 0 ] );
	near( runner.position.y, top );
	assert.equal( runner.pipesAndZiplines.going, null );

} );
