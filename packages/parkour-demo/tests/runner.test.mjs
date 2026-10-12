import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { TUNING_DEFAULTS, validateTuning } from '@trizen/parkour/sim/tuning.js';
import { createEngine } from '../src/engines.js';
import { Queries } from '@trizen/parkour/physics/Queries.js';
import { boxSolid } from '@trizen/parkour/world/solids.js';
import { Mover } from '@trizen/parkour/physics/Mover.js';
import { Motion } from '@trizen/parkour/motion/Motion.js';
import { Runner } from '@trizen/parkour/runner/Runner.js';
import { Slides } from '@trizen/parkour/runner/Slides.js';
import { PoseInputs } from '@trizen/parkour/runner/PoseInputs.js';
import { ViewControl } from '@trizen/parkour/camera/ViewControl.js';
import { FollowCamera } from '@trizen/parkour/camera/FollowCamera.js';

const DT = 1 / 120;

const engine = await createEngine( 'rapier' );

// The game's motion data, served from the files the browser loads.
const served = ( name ) => 'data:application/json;base64,' + readFileSync( new URL( `../public/data/${ name }.json`, import.meta.url ) ).toString( 'base64' );

// The input as the runner reads it: the move stick, actions held, pressed or released this step, and the look over a
// frame at 60 frames a second.
function input( move = { x: 0, y: 0 }, held = [], pressed = [], released = [] ) {

	return {
		dt: 1 / 60,
		move,
		moveDirection: { x: move.x, y: move.y },
		moveAmount: Math.min( 1, Math.hypot( move.x, move.y ) ),
		look: { mouse: { x: 0, y: 0 }, stick: { x: 0, y: 0 } },
		usingPad: false,
		held: ( action, device ) => ! device && held.includes( action ),
		pressed: ( action ) => pressed.includes( action ),
		released: ( action ) => released.includes( action ),
		value: () => 0
	};

}

const forward = { x: 0, y: 1 };
const right = { x: 1, y: 0 };

// A runner settled on a wide floor, facing +z, stepped the way the game steps it: the runner (steered by the view's
// yaw), then the pose inputs and the motion that reads them.
async function setup() {

	const tuning = { values: { ...TUNING_DEFAULTS } };
	const queries = new Queries( engine.createQueryWorld( [ boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 100, 0.5, 100 ] } ) ] ) );

	const motion = await new Motion( { moves: served( 'moves' ) } ).load();
	const world = { spawn: () => ( { position: new Vector3( 0, 0.901, 0 ), yaw: 0 } ), poles: [], solids: [], pipes: [], ziplines: [], catchVolumes: [] };
	const runner = new Runner( tuning, queries, new Mover( queries ), motion, world );
	const poseInputs = new PoseInputs( runner, motion );

	poseInputs.update( DT, input() );

	function step( controls = input(), viewYaw = 0 ) {

		runner.step( DT, controls, viewYaw );
		poseInputs.update( DT, controls );
		motion.update( DT, poseInputs );

	}

	for ( let i = 0; i < 10; i ++ ) step();

	return { runner, motion, queries, tuning, step };

}

test( 'pushing right moves the runner to the right of a camera looking along +z', async () => {

	const { runner, step } = await setup();
	const camera = new PerspectiveCamera( 75, 16 / 9, 0.01, 100 );

	camera.position.set( 0, 2, - 5 );
	camera.lookAt( 0, 1, 0 );
	camera.updateMatrixWorld();
	const before = runner.position.clone().project( camera ).x;

	for ( let i = 0; i < 30; i ++ ) step( input( right ) );
	assert.ok( runner.position.clone().project( camera ).x > before );
	assert.ok( runner.position.x < 0 );

} );

test( 'sprinting reaches 5.85 m/s and no more, and the runner comes to rest after its skid stop', async () => {

	const { runner, motion, step } = await setup();
	let top = 0;

	for ( let i = 0; i < 240; i ++ ) {

		step( input( forward, [ 'sprint' ] ) );
		top = Math.max( top, runner.speed );

	}

	assert.ok( Math.abs( runner.speed - 5.85 ) < 0.001 );
	assert.ok( top < 5.85 + 1e-9 );

	step();
	assert.equal( motion.moves.playing().name, 'skidStop' );

	const length = Math.ceil( motion.length( 'skidStop' ) / DT );

	for ( let i = 0; i < length; i ++ ) step();
	assert.ok( runner.speed < 0.001 );

} );

test( 'in first person, pushing right strafes and the runner faces where the view does', async () => {

	const { runner, step } = await setup();

	runner.firstPerson = true;
	for ( let i = 0; i < 30; i ++ ) step( input( right ) );
	assert.ok( runner.position.x < 0 );
	assert.equal( runner.yaw, 0 );
	step( input(), 0.4 );
	assert.equal( runner.yaw, 0.4 );

} );

test( 'a sprinting jump charges for half a second and leaves the ground on the release', async () => {

	const { runner, step } = await setup();

	for ( let i = 0; i < 120; i ++ ) step( input( forward, [ 'sprint' ] ) );
	step( input( forward, [ 'jump', 'sprint' ], [ 'jump' ] ) );
	for ( let i = 0; i < 60; i ++ ) step( input( forward, [ 'jump', 'sprint' ] ) );
	assert.equal( runner.grounded, true );
	assert.equal( runner.jumpCharge, 1 );

	// Fully charged, the jump leaves at 7.25 m/s, less one step of falling at 17.15 m/s² (9.8 scaled by 1.75).
	const base = runner.position.y;

	step( input( forward, [ 'sprint' ], [], [ 'jump' ] ) );
	assert.equal( runner.grounded, false );
	assert.ok( Math.abs( runner.velocity.y - ( 7.25 - 17.15 * DT ) ) < 1e-6 );

	let apex = runner.position.y;

	for ( let i = 0; i < 70; i ++ ) {

		step();
		apex = Math.max( apex, runner.position.y );

	}

	assert.ok( Math.abs( apex - base - 7.25 ** 2 / ( 2 * 17.15 ) ) < 0.04 );

} );

test( 'a standing jump leaves the ground at 5 m/s', async () => {

	const { runner, step } = await setup();

	step( input( undefined, [ 'jump' ], [ 'jump' ] ) );
	step( input( undefined, [], [], [ 'jump' ] ) );
	assert.ok( Math.abs( runner.velocity.y - ( 5 - 17.15 * DT ) ) < 1e-6 );

} );

test( 'a style jump is a charged jump at speed across the ground: a standing jump held long stays plain', async () => {

	// A second to get going (or stand), the jump held for half a second, charging it fully, then let go.
	const charged = async ( move, held ) => {

		const { runner, step } = await setup();
		for ( let i = 0; i < 120; i ++ ) step( input( move, held ) );
		step( input( move, [ ...held, 'jump' ], [ 'jump' ] ) );
		for ( let i = 0; i < 60; i ++ ) step( input( move, [ ...held, 'jump' ] ) );
		runner.events.length = 0;
		step( input( move, held, [], [ 'jump' ] ) );
		return { runner, styled: runner.events.some( ( event ) => event.name === 'styleJump' ) };

	};

	// Standing, the jump rises at 5 m/s, over the style speed, but nothing of it is across the ground.
	const standing = await charged( undefined, [] );
	assert.equal( standing.runner.jumpCharge, 1 );
	assert.equal( standing.runner.state, 'rising' );
	assert.equal( standing.styled, false );
	assert.equal( standing.runner.plainJump, true );

	const sprinting = await charged( forward, [ 'sprint' ] );
	assert.ok( sprinting.runner.speed > 4.5 );
	assert.equal( sprinting.styled, true );
	assert.equal( sprinting.runner.plainJump, false );

} );

test( 'moving the mouse right turns the view right, and the horizontal field of view is fitted to the screen', async () => {

	const { runner, queries, tuning } = await setup();
	const view = new ViewControl( tuning );
	const controls = input();

	view.reset( runner.yaw );
	controls.look.mouse.x = 0.01;
	view.look( controls, runner );
	assert.ok( runner.right().dot( new Vector3( - 1, 0, 0 ) ) > 0.999 );
	assert.ok( new Vector3( Math.sin( view.yaw ), 0, Math.cos( view.yaw ) ).dot( runner.right() ) > 0 );

	// Not at speed, the 115 degree view is 10 degrees narrower: across 16:9 that is 72.49 degrees high.
	const camera = new PerspectiveCamera( 75, 16 / 9, 0.01, 100 );
	const followCamera = new FollowCamera( camera, tuning, queries, controls );

	followCamera.reset( runner.position, runner.yaw );
	view.update( DT, runner );
	followCamera.update( DT, view, runner, runner.position, null );
	assert.ok( Math.abs( followCamera.fov - 105 * Math.PI / 180 ) < 1e-12 );
	assert.ok( Math.abs( camera.fov - 72.487623 ) < 1e-5 );

} );

test( 'a capsule swept 10 m in one step stops against a thin panel', () => {

	const queries = new Queries( engine.createQueryWorld( [ boxSolid( { id: 'panel', position: [ 0, 2, 2 ], halfExtents: [ 5, 2.5, 0.05 ] } ) ] ) );

	const position = new Vector3( 0, 1, 0 );
	const velocity = new Vector3( 0, 0, 100 );

	new Mover( queries ).walk( position, velocity, 0.1, TUNING_DEFAULTS, false );
	assert.ok( position.z <= 1.766 && position.z > 1.6 );
	assert.ok( Math.abs( velocity.z ) < 1e-6 );

} );

test( 'tuning refuses values that are not finite or out of range', () => {

	assert.throws( () => validateTuning( { sprintSpeed: Infinity } ), /sprintSpeed/ );
	assert.throws( () => validateTuning( { gravityScale: - 2 } ), /gravityScale/ );
	assert.equal( validateTuning( { sprintSpeed: 7 } ).sprintSpeed, 7 );

} );

test( 'the camera sphere stops short of a thin panel however far it reaches', () => {

	const queries = new Queries( engine.createQueryWorld( [ boxSolid( { id: 'panel', position: [ 0, 0, - 1 ], halfExtents: [ 5, 5, 0.01 ] } ) ] ) );

	const followCamera = new FollowCamera( new PerspectiveCamera(), { values: { ...TUNING_DEFAULTS } }, queries, null );

	for ( const reach of [ 2, 6, 50 ] ) {

		const place = followCamera.clear( new Vector3(), new Vector3( 0, 0, - reach ), 0.12, 'camera' );

		assert.ok( Math.abs( place.z + 0.87 ) < 0.001, reach + ': ' + place.z );

	}

} );

test( 'the movement mode follows the state: held is guided, a ledge move moves as its placement does, else ground or air', async () => {

	const { runner } = await setup();
	const { movementMode } = await import( '@trizen/parkour/runner/states.js' );
	const as = ( state, grounded = false, placement = null ) => {

		runner.state = state;
		runner.grounded = grounded;
		runner.ledges.placement = placement;

		return movementMode( runner );

	};

	assert.equal( as( 'standing', true ), 'ground' );
	assert.equal( as( 'falling' ), 'air' );
	assert.equal( as( 'bailing', true ), 'guided' );
	assert.equal( as( 'hanging' ), 'guided' );
	assert.equal( as( 'onZipline' ), 'guided' );
	// A hop onto a wall walks once it is on top; a vault flies over.
	assert.equal( as( 'climbingUp', true, { mode: 'ground' } ), 'ground' );
	assert.equal( as( 'vaulting', false, { mode: 'guided', kind: 'vault' } ), 'guided' );
	assert.equal( runner.vaulting, true );
	// The power jump off an obstacle uses the vaulting state too, but it is no vault.
	assert.equal( as( 'vaulting', false, { mode: 'air', kind: 'powerJump' } ), 'air' );
	assert.equal( runner.vaulting, false );

} );

test( 'a teleport starts the run again: falling at the spawn, the capsule standing, nothing pending, grabs held off a moment', async () => {

	const { runner, step } = await setup();

	runner.capsule.shrink();
	runner.bail.request();
	runner.openAirComboSoon();
	runner.teleport( { position: new Vector3( 5, 3, 5 ), yaw: 1 } );

	assert.equal( runner.state, 'falling' );
	assert.deepEqual( runner.position.toArray(), [ 5, 3, 5 ] );
	assert.equal( runner.yaw, 1 );
	assert.equal( runner.capsule.halfHeight, 0.9 );
	assert.equal( runner.bail.pending, false );
	assert.equal( runner.clock.pending( 'airComboOpen' ), false );
	assert.equal( runner.clock.readyAt( 'grabLock' ), runner.time + 0.25 );
	for ( let i = 0; i < 29; i ++ ) step();
	assert.ok( runner.clock.held( 'grabLock' ) );
	step();
	assert.equal( runner.clock.held( 'grabLock' ), false );

} );

test( 'dropping into a slide and standing out of it move the body drawn between steps with the capsule, so it never pops up a frame', async () => {

	const { runner, step } = await setup();
	for ( let i = 0; i < 120; i ++ ) step( input( { x: 0, y: 1 }, [ 'sprint' ] ) );
	step( input( { x: 0, y: 1 }, [ 'sprint', 'slide' ], [ 'slide' ] ) );
	assert.equal( runner.state, 'sliding' );
	assert.ok( Math.abs( runner.previousPosition.y - runner.position.y ) < 0.02, 'drawn from where the capsule now is' );

	// Not sliding, ending a slide does nothing.
	for ( let i = 0; i < 240 && runner.state === 'sliding'; i ++ ) step( input( { x: 0, y: 1 } ) );
	assert.notEqual( runner.state, 'sliding' );
	const y = runner.position.y;
	assert.equal( runner.slides.end(), false );
	assert.equal( runner.position.y, y );

} );

test( 'a slide pushes sideways as it steers by the step, so the frame rate does not change it', () => {

	const tuning = { values: { ...TUNING_DEFAULTS } };
	const runner = { yaw: 0, firstPerson: false, tuning, right: () => new Vector3( - 1, 0, 0 ) };
	const slides = new Slides( runner );
	const steering = ( turning ) => ( { value: () => turning, held: () => false } );

	// Half a steer pushes with three quarters of the tuning's acceleration; two thirds or more with all of it.
	const half = slides.steer( DT, steering( 0.5 ) );
	assert.ok( Math.abs( half.length() - 0.75 * tuning.values.acceleration ) < 1e-9 );
	assert.ok( Math.abs( slides.steer( DT, steering( 0.7 ) ).length() - tuning.values.acceleration ) < 1e-9 );
	assert.ok( half.x < 0, 'toward the steer' );

} );
