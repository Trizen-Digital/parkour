// Ropes, run on test_basic's (hung from 4.5 m up at x = 15, z = 20, 3.5 m long, between two posts) and test_ropes'
// (from 7 m up over a 5 m gap, 5.5 m long).

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { worldFor } = await import( '../tools/headless/courses.mjs' );
const { Simulation } = await import( '@trizen/parkour/sim/Simulation.js' );
const { backendOf } = await import( '../src/engines.js' );

const NO_PAGE = { storage: null, eventWindow: null, eventDocument: null, navigator: null };
const STANDING = 0.9215;
const near = ( a, b, epsilon = 1e-6 ) => assert.ok( Math.abs( a - b ) < epsilon, `expected ${a} = ${b}` );

async function at( course, x, z ) {

	const sim = new Simulation( { world: worldFor( course ), page: NO_PAGE, engine: backendOf( 'rapier' ) } );
	await sim.load();
	sim.respawn( { position: [ x, STANDING, z ], yaw: 0 } );
	return sim;

}

// Frames at 60 a second: `plan( runner )` gives the keys held and whether the grab is.
function play( sim, frames, plan, until = () => false ) {

	for ( let f = 0; f < frames && ! until( sim.runner ); f ++ ) {

		const { keys = [], grab = false } = plan( sim.runner ) ?? {};
		for ( const key of keys ) if ( ! sim.input.keys.has( key ) ) sim.input.queueKey( key, 'pressed' );
		for ( const key of sim.input.keys ) if ( ! keys.includes( key ) ) sim.input.queueKey( key, 'released' );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( keys );
			input.mouseButtons = new Set( grab ? [ 0 ] : [] );
			input.enabled = true;

		} );

	}

}

// A sprint at the rope, jump tapped `before` (m) short of it, grab held once in the air; then the grab held, and the
// stick as given.
async function swingOn( course, x, start, rope, before, keys = [] ) {

	const sim = await at( course, x, start );
	let tapped = 0;
	play( sim, 600, ( r ) => {

		if ( tapped || r.position.z > rope - before ) tapped ++;
		return { keys: [ 'KeyW', 'ShiftLeft', ...( tapped > 0 && tapped <= 3 ? [ 'Space' ] : [] ) ], grab: ! r.grounded };

	}, ( r ) => r.state === 'onRope' );
	assert.equal( sim.runner.state, 'onRope' );
	return { sim, hold: ( frames, until ) => play( sim, frames, () => ( { keys, grab: true } ), until ) };

}

test( 'a rope is caught in the air with the grab held, and the body swings from its anchor as far out as it was caught', async () => {

	const { sim, hold } = await swingOn( 'test_basic', 15, 12, 20, 2.5 );
	const runner = sim.runner, anchor = sim.world.ropes[ 0 ].anchor;
	const radius = runner.polesAndBars.attachment.radius;

	near( runner.position.distanceTo( anchor ), radius );
	for ( let i = 0; i < 30; i ++ ) {

		hold( 4 );
		near( runner.position.distanceTo( anchor ), radius );
		// Across the rope only: nothing along it.
		near( runner.velocity.dot( runner.position.clone().sub( anchor ).normalize() ), 0, 1e-9 );

	}

	assert.equal( sim.motion.graph.machines.rope.current.name, 'swing' );

} );

test( 'left alone the swing goes back and forth under the anchor, losing a little each time', async () => {

	const { sim, hold } = await swingOn( 'test_basic', 15, 12, 20, 2.5 );
	const runner = sim.runner;
	const ends = [];
	let last = runner.velocity.z;

	hold( 60 * 8, ( r ) => {

		if ( Math.sign( r.velocity.z ) !== Math.sign( last ) && last !== 0 ) ends.push( r.position.z );
		last = r.velocity.z;
		return ends.length >= 4;

	} );

	assert.equal( runner.state, 'onRope', `ends ${ends.join( ', ' )}` );
	assert.equal( ends.length, 4, `ends ${ends.join( ', ' )}` );
	// Forward of the anchor, back behind it, forward again, a little less far each time.
	assert.ok( ends[ 0 ] > 20 && ends[ 1 ] < 20 && ends[ 2 ] > 20 && ends[ 3 ] < 20 );
	assert.ok( ends[ 2 ] < ends[ 0 ] && ends[ 3 ] > ends[ 1 ] );

} );

test( 'the stick pushes the swing the way it points: sideways, it carries the body round', async () => {

	const { sim, hold } = await swingOn( 'test_basic', 15, 12, 20, 2.5, [ 'KeyA' ] );
	const runner = sim.runner;

	hold( 60 );
	// The view faces +z, so left is +x; the body has swung that way and turned with it.
	assert.ok( runner.position.x > 15.3, `x ${runner.position.x}` );

} );

test( 'the body hangs along the rope: its tilt turns its up toward the anchor', async () => {

	const { sim, hold } = await swingOn( 'test_basic', 15, 12, 20, 2.5 );
	const runner = sim.runner, anchor = sim.world.ropes[ 0 ].anchor;

	hold( 20 );
	const up = anchor.clone().sub( runner.position ).normalize();
	const tilt = sim.poseInputs.tilt;
	near( tilt.pitch, Math.atan2( up.dot( runner.forward() ), up.y ), 1e-9 );
	near( tilt.roll, Math.asin( up.dot( runner.right() ) ), 1e-9 );
	assert.ok( Math.abs( tilt.pitch ) > 0.1 );

} );

test( 'jump released leaps off with the swing\'s speed and a kick up and on; the grab let go drops off as it swings', async () => {

	{

		const { sim, hold } = await swingOn( 'test_ropes', 0, 1, 15.5, 2.5 );
		const runner = sim.runner;

		hold( 20 );
		const swing = runner.velocity.clone();
		play( sim, 3, () => ( { keys: [ 'Space' ], grab: true } ) );
		const before = runner.velocity.clone();
		play( sim, 1, () => ( { keys: [], grab: true } ) );
		assert.equal( runner.state, 'rising' );
		assert.ok( runner.velocity.y > before.y + 2.5 );
		assert.ok( runner.velocity.z > swing.z * 0.5 );
		assert.ok( runner.clock.held( 'ropeLock' ) );

	}

	{

		const { sim, hold } = await swingOn( 'test_ropes', 0, 1, 15.5, 2.5 );
		const runner = sim.runner;

		hold( 20 );
		play( sim, 1, () => ( { keys: [], grab: false } ) );
		assert.notEqual( runner.state, 'onRope' );
		assert.equal( runner.polesAndBars.attachment, null );

	}

} );

test( 'swung on over a gap and let go of at the far end of the swing, the runner lands across it', async () => {

	const { sim, hold } = await swingOn( 'test_ropes', 0, 1, 15.5, 2.5 );
	const runner = sim.runner;

	hold( 120, ( r ) => r.velocity.z <= 0 );
	play( sim, 3, () => ( { keys: [ 'Space' ], grab: true } ) );
	play( sim, 240, () => ( {} ), ( r ) => r.grounded );
	assert.ok( runner.grounded );
	// The far roof starts at z = 19, level with the near one.
	assert.ok( runner.position.z > 19 );
	near( runner.position.y, STANDING, 0.01 );

} );
