import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { TUNING_DEFAULTS } from '@trizen/parkour/sim/tuning.js';
import { createEngine } from '../src/engines.js';
import { Queries } from '@trizen/parkour/physics/Queries.js';
import { boxSolid } from '@trizen/parkour/world/solids.js';
import { Mover } from '@trizen/parkour/physics/Mover.js';
import { Motion } from '@trizen/parkour/motion/Motion.js';
import { Runner } from '@trizen/parkour/runner/Runner.js';
import { PoseInputs } from '@trizen/parkour/runner/PoseInputs.js';
import { TrickGesture } from '@trizen/parkour/runner/TrickGesture.js';

const DT = 1 / 120;

// The game's motion data, served from the files the browser loads.
const served = ( name ) => 'data:application/json;base64,' + readFileSync( new URL( `../public/data/${ name }.json`, import.meta.url ) ).toString( 'base64' );

// The input as the runner reads it: the move stick, actions held on any device, held only on the keyboard and mouse
// ('keys') or only on the pad ('pad'), pressed or released this step, and analogue values.
function controls( { move = { x: 0, y: 0 }, held = [], keys = [], pad = [], pressed = [], released = [], values = {} } = {} ) {

	return {
		move,
		moveDirection: { x: move.x, y: move.y },
		moveAmount: Math.min( 1, Math.hypot( move.x, move.y ) ),
		look: { mouse: { x: 0, y: 0 }, stick: { x: 0, y: 0 } },
		usingPad: false,
		held: ( action, device ) =>
			device === 'keys' ? keys.includes( action ) :
			device === 'pad' ? pad.includes( action ) :
			held.includes( action ) || keys.includes( action ) || pad.includes( action ),
		pressed: ( action ) => pressed.includes( action ),
		released: ( action ) => released.includes( action ),
		value: ( action ) => values[ action ] ?? 0
	};

}

// A runner settled on a wide floor (level, or the floor given), facing +z, stepped the way the game steps it: the
// runner, then the pose inputs and the motion that reads them.
async function setup( floor = boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 50, 0.5, 50 ] } ) ) {

	const engine = await createEngine( 'rapier' );
	const queries = new Queries( engine.createQueryWorld( [ floor ] ) );

	const motion = await new Motion( { moves: served( 'moves' ) } ).load();
	const world = { spawn: () => ( { position: new Vector3( 0, 0.9215, 0 ), yaw: 0 } ), poles: [], solids: [], pipes: [], ziplines: [], catchVolumes: [] };
	const runner = new Runner( { values: { ...TUNING_DEFAULTS } }, queries, new Mover( queries ), motion, world );
	const poseInputs = new PoseInputs( runner, motion );

	poseInputs.update( DT, controls() );

	function step( input = controls() ) {

		runner.step( DT, input, 0 );
		poseInputs.update( DT, input );
		motion.update( DT, poseInputs );

	}

	for ( let i = 0; i < 4; i ++ ) step();

	return { runner, motion, step };

}

const close = ( actual, expected, tolerance = 1e-9 ) => assert.ok( Math.abs( actual - expected ) < tolerance, actual + ' != ' + expected );

const degrees = Math.PI / 180;

test( 'a slide adds 1.5 m/s for each m/s of speed, 6.5 at most, and lowers the capsule 0.6 m until it ends', async () => {

	const { runner } = await setup();

	runner.velocity.z = 5.85;
	const y = runner.position.y;

	assert.equal( runner.slides.tryBegin( controls( { held: [ 'slide' ] } ) ), true );
	assert.equal( runner.state, 'sliding' );
	close( runner.velocity.length(), 12.35 );
	close( runner.position.y, y - 0.6 );
	assert.equal( runner.capsule.halfHeight, 0.3 );

	runner.slides.end();
	assert.equal( runner.state, 'standing' );
	assert.equal( runner.capsule.halfHeight, 0.9 );
	close( runner.position.y, y );

	// Slower, under the cap, the kick is in proportion to the speed.
	const slower = ( await setup() ).runner;
	slower.velocity.z = 4.2;
	assert.equal( slower.slides.tryBegin( controls( { held: [ 'slide' ] } ) ), true );
	close( slower.velocity.length(), 4.2 * 2.5 );

} );

test( 'slide steering turns at both of its rates together; tucked, only the flip spin turns the runner', async () => {

	const { runner } = await setup();

	runner.velocity.z = 12;
	runner.slides.begin();
	runner.yaw = 0;
	runner.slides.steer( 0.01, controls( { values: { slideSteer: 1 } } ) );
	close( runner.yaw, - 0.8 * degrees, 1e-10 );

	// Holding flip tucks the slide; the flip itself spins it 350 degrees a second.
	const tucked = controls( { held: [ 'flip' ], values: { slideSteer: 1 } } );

	runner.yaw = 0;
	runner.slides.update( 0.01, tucked );
	close( runner.yaw, - 3.5 * degrees, 1e-10 );
	assert.equal( runner.slides.steer( 0.01, tucked ).lengthSq(), 0 );

} );

test( 'a slide jumps on the jump release, 4.5 m/s up and under 8.5 m/s across', async () => {

	const { runner } = await setup();

	runner.velocity.z = 12;
	runner.slides.begin();
	runner.slides.update( DT, controls( { held: [ 'jump' ], pressed: [ 'jump' ] } ) );
	assert.equal( runner.state, 'sliding' );
	runner.slides.update( DT, controls( { released: [ 'jump' ] } ) );
	assert.equal( runner.state, 'rising' );
	assert.equal( runner.velocity.y, 4.5 );
	assert.equal( runner.plainJump, false );
	assert.ok( runner.speed < 8.5 );

} );

test( 'a slide under 11.5 m/s turns toward downhill on a slope, and keeps its heading on a level floor', async () => {

	// From 4.5 m/s the slide's kick takes it to 11 m/s; a quarter of a second later it still slides at about 9.
	const slide = async ( runner, step, yaw ) => {

		runner.yaw = yaw;
		runner.velocity.set( Math.sin( yaw ) * 4.5, 0, Math.cos( yaw ) * 4.5 );
		assert.equal( runner.slides.begin(), true );
		for ( let i = 0; i < 30; i ++ ) step();
		assert.equal( runner.state, 'sliding' );

	};

	// Level, sliding along +x: nothing turns it.
	const level = await setup();
	await slide( level.runner, level.step, Math.PI / 2 );
	assert.equal( level.runner.yaw, Math.PI / 2 );

	// A 15° slope (gentle enough to land and stand on) falling away toward +x, its top through the origin; sliding
	// straight across it, along +z, the slide comes round toward +x at 1.85 a second.
	const tilt = - 7.5 * degrees;
	const slope = await setup( boxSolid( {
		id: 'slope',
		position: [ - 0.5 * Math.sin( 15 * degrees ), - 0.5 * Math.cos( 15 * degrees ), 0 ],
		rotation: [ 0, 0, Math.sin( tilt ), Math.cos( tilt ) ],
		halfExtents: [ 50, 0.5, 50 ]
	} ) );
	slope.runner.position.y = 1;
	for ( let i = 0; i < 60; i ++ ) slope.step();
	assert.equal( slope.runner.state, 'standing' );
	await slide( slope.runner, slope.step, 0 );
	const eased = ( Math.PI / 2 ) * ( 1 - ( 1 - 1.85 / 120 ) ** 30 );
	close( slope.runner.yaw, eased, 0.02 );

} );

test( 'walking off a ledge keeps at most 6.5 m/s across and hops 1.55 m/s up', async () => {

	const { runner, motion } = await setup();

	runner.velocity.set( 0, - 0.5, 9 );
	runner.grounded = false;
	runner.walkOff();
	assert.equal( runner.speed, 6.5 );
	assert.equal( runner.velocity.y, 1.55 );
	assert.equal( motion.moves.playing().name, 'walkOffHop' );
	assert.equal( runner.jumps, 1 );

} );

test( 'in the roll window a 15 m/s landing rolls on the second step after, and the runner may jump and walk off ledges 0.6 s on', async () => {

	const { runner, step } = await setup();

	runner.clock.hold( 'rollWindow', 0.35 );
	runner.landings.land( - 15, controls() );
	assert.equal( runner.stunt, null );

	// The next step settles the landing; the roll starts on the one after.
	step();
	assert.equal( runner.stunt, null );
	step();
	assert.equal( runner.stunt.name, 'landingRoll' );
	assert.equal( runner.canWalkOff, false );
	close( runner.clock.readyAt( 'jumpLock' ), runner.time + 0.6, 1e-6 );

	// Steps on to the step nearest a time into the roll.
	const rolled = runner.time;
	const until = ( seconds ) => {

		while ( runner.time < rolled + seconds - DT / 2 ) step();

	};

	// The roll closes the window 0.2 s in, sooner than it would run out.
	until( 0.19 );
	assert.ok( runner.clock.held( 'rollWindow' ) );
	until( 0.21 );
	assert.equal( runner.clock.held( 'rollWindow' ), false );

	until( 0.59 );
	assert.equal( runner.canWalkOff, false );
	until( 0.61 );
	assert.equal( runner.canWalkOff, true );

} );

test( 'landing mid-trick bails 0.05 s later', async () => {

	const { runner } = await setup();

	runner.tricking = true;
	runner.landings.land( - 3, controls() );
	assert.equal( runner.bail.pending, true );
	runner.clock.run( runner.time + 0.049, controls() );
	assert.notEqual( runner.state, 'bailing' );
	runner.clock.run( runner.time + 0.001, controls() );
	assert.equal( runner.state, 'bailing' );
	assert.equal( runner.bail.pending, false );

} );

test( 'a manual bail hops 2 m/s and goes limp 0.205 s later; getting up waits 0.2 s, needs the runner nearly still and stands it on the floor', async () => {

	const { runner } = await setup();
	const standUp = controls( { held: [ 'standUp' ] } );

	assert.equal( runner.bail.request( true ), true );
	assert.equal( runner.velocity.y, 2 );
	runner.clock.run( runner.time + 0.204, standUp );
	assert.notEqual( runner.state, 'bailing' );
	runner.clock.run( runner.time + 0.001, standUp );
	assert.equal( runner.state, 'bailing' );

	// The ragdoll's steps move the time on without running the runner's clock.
	runner.velocity.set( 0, 0, 0 );
	runner.position.y = 1;
	runner.time += 0.19;
	assert.equal( runner.bail.getUp( standUp ), false );
	runner.time += 0.01;
	runner.velocity.set( 0, 0, 1.6 );
	assert.equal( runner.bail.getUp( standUp ), false );

	// Still enough now, the runner rises 0.05 s after asking.
	runner.velocity.set( 0, 0, 0 );
	assert.equal( runner.bail.getUp( standUp ), false );
	runner.time += 0.05;
	assert.equal( runner.bail.getUp( standUp ), true );
	close( runner.position.y, 0.9, 1e-6 );
	assert.equal( runner.state, 'falling' );

} );

test( 'mouse flicks set each direction on its own, inside strict limits, and a still mouse keeps the last flick', () => {

	// A runner in the air, as the gesture reads it.
	const trickGesture = new TrickGesture( { grounded: false, state: 'falling', tuning: { values: TUNING_DEFAULTS } } );
	const flick = ( x, y ) => controls( { values: { mouseFlick: { x, y } } } );

	trickGesture.update( flick( 2, 2 ) );
	assert.equal( trickGesture.has( 'right' ), true );
	assert.equal( trickGesture.has( 'up' ), true );
	trickGesture.update( controls() );
	assert.equal( trickGesture.has( 'right' ), true );

	// 25 is past the flick range and 1.5 is only the threshold: neither counts.
	trickGesture.update( flick( 25, 1.5 ) );
	assert.equal( trickGesture.has( 'right' ), false );
	assert.equal( trickGesture.has( 'up' ), false );

} );

test( 'a hard landing a trick asked for is that landing\'s: landed on a perch instead, the next landing is not hard', async () => {

	const { runner, step } = await setup();

	runner.landHard = true;
	runner.clock.hold( 'precisionWindow', 0.35 );
	runner.landings.land( - 3, controls() );
	step();
	assert.equal( runner.balancing, true );
	assert.notEqual( runner.stunt?.name, 'hardLanding' );
	assert.equal( runner.landHard, false );

	// Off the perch and down again, from a fall too slow to be hard by itself.
	for ( let i = 0; i < 120; i ++ ) step();
	assert.equal( runner.balancing, false );
	runner.landings.land( - 3, controls() );
	step();
	assert.notEqual( runner.stunt?.name, 'hardLanding' );

} );
