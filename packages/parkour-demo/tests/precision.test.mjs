import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { TUNING_DEFAULTS } from '@trizen/parkour/sim/tuning.js';
import { createEngine } from '../src/engines.js';
import { Queries } from '@trizen/parkour/physics/Queries.js';
import { boxSolid } from '@trizen/parkour/world/solids.js';
import { Mover } from '@trizen/parkour/physics/Mover.js';
import { Runner } from '@trizen/parkour/runner/Runner.js';
import { arcVelocity } from '@trizen/parkour/runner/Precision.js';

const DT = 1 / 120;

const engine = await createEngine( 'rapier' );

// One step's actions, all on the keyboard: a read of the pad alone sees nothing.
function input( held = [], pressed = [], released = [] ) {

	return {
		held: ( action, device ) => device !== 'pad' && held.includes( action ),
		pressed: ( action ) => pressed.includes( action ),
		released: ( action ) => released.includes( action ),
		value: () => 0,
		move: { x: 0, y: 0 },
		moveDirection: { x: 0, y: 0 },
		moveAmount: 0,
		look: { mouse: { x: 0, y: 0 }, stick: { x: 0, y: 0 } },
		usingPad: false
	};

}

// Motion with nothing of its own to say: no root motion, every move a second long, markers only when a test adds them.
function stillMotion() {

	return {
		markers: [],
		moves: { play() {}, stop() {}, playing: () => null, busy: () => false },
		playTake() {},
		playStunt() {},
		hasRootMotion: () => false,
		length: () => 1,
		rootMotion: () => null,
		moveDelta: () => new Vector3(),
		takeMarkers() {

			return this.markers.splice( 0 );

		}
	};

}

// A runner standing on a wide floor, with a step of the given height 2 m ahead when asked for.
function setup( stepHeight = 0 ) {

	const solids = [ boxSolid( { id: 'ground', position: [ 0, - 0.5, 0 ], halfExtents: [ 15, 0.5, 15 ] } ) ];

	if ( stepHeight ) solids.push( boxSolid( { id: 'step', position: [ 0, stepHeight / 2, 3.5 ], halfExtents: [ 1.5, stepHeight / 2, 2.5 ] } ) );

	const queries = new Queries( engine.createQueryWorld( solids ) );

	const mover = new Mover( queries );
	const motion = stillMotion();
	const world = {
		spawn: () => ( { position: new Vector3( 0, 0.9215, 0 ), yaw: 0 } ),
		solids: [],
		poles: [],
		pipes: [],
		ziplines: [],
		catchVolumes: []
	};
	const runner = new Runner( { values: { ...TUNING_DEFAULTS } }, queries, mover, motion, world );

	runner.grounded = true;
	runner.setState( 'standing' );

	return { runner, mover, motion };

}

test( 'a precision crouch charges every 0.01 s and the jump leaves the ground 0.25 s after it is pressed', () => {

	const { runner } = setup();

	runner.step( DT, input( [ 'precision' ], [ 'precision' ] ), 0 );
	assert.equal( runner.state, 'aiming' );
	for ( let i = 0; i < 60; i ++ ) runner.step( DT, input( [ 'precision' ] ), 0 );
	assert.ok( Math.abs( runner.precisionCharge - 0.6 ) < 1e-10 );

	runner.step( DT, input( [ 'precision', 'jump' ], [ 'jump' ] ), 0 );
	for ( let i = 0; i < 30; i ++ ) runner.step( DT, input( [ 'precision' ] ), 0 );
	assert.equal( runner.grounded, true );

	runner.step( DT, input( [ 'precision' ] ), 0 );
	assert.equal( runner.grounded, false );
	assert.equal( runner.state, 'precisionJump' );
	assert.ok( Math.abs( runner.velocity.y - ( 6.25 - 9.8 * 1.75 * DT ) ) < 1e-8 );
	assert.ok( runner.velocity.z > 3.9 && runner.velocity.z < 4.1 );

} );

test( 'a precision jump waiting to launch is committed: letting go of precision, then of jump, does not make it a plain jump', () => {

	const { runner } = setup();

	runner.step( DT, input( [ 'precision' ], [ 'precision' ] ), 0 );
	for ( let i = 0; i < 60; i ++ ) runner.step( DT, input( [ 'precision' ] ), 0 );
	runner.step( DT, input( [ 'precision', 'jump' ], [ 'jump' ] ), 0 );
	runner.step( DT, input( [ 'jump' ] ), 0 );
	runner.step( DT, input( [], [], [ 'jump' ] ), 0 );
	assert.equal( runner.stunt?.name, 'precisionJump' );
	assert.equal( runner.grounded, true );

	for ( let i = 0; i < 29; i ++ ) runner.step( DT, input(), 0 );
	assert.equal( runner.state, 'precisionJump' );
	assert.ok( Math.abs( runner.velocity.y - ( 6.25 - 9.8 * 1.75 * DT ) ) < 1e-8 );
	assert.ok( runner.velocity.z > 3.9 && runner.velocity.z < 4.1 );

} );

test( 'a shrink marker tucks the capsule to 0.36 half height and a restore marker grows it back over 0.1 s', () => {

	const { runner } = setup();

	runner.markerResponses.handle( 'capsuleShrink' );
	assert.equal( runner.capsule.halfHeight, 0.36 );

	runner.markerResponses.handle( 'capsuleRestore' );
	runner.capsule.update( DT );
	const t = DT / 0.1;
	const eased = 0.36 + ( 0.9 - 0.36 ) * t * t * ( 3 - 2 * t );
	assert.ok( Math.abs( runner.capsule.halfHeight - eased ) < 1e-10 );

	for ( let i = 0; i < 12; i ++ ) runner.capsule.update( DT );
	assert.equal( runner.capsule.halfHeight, 0.9 );

} );

test( 'the air combo opens 0.055 s after its marker', () => {

	const { runner } = setup();

	runner.markerResponses.handle( 'airComboOpen' );
	for ( let i = 0; i < 6; i ++ ) runner.step( DT, input(), 0 );
	assert.equal( runner.airComboOpen, false );
	runner.step( DT, input(), 0 );
	assert.equal( runner.airComboOpen, true );

} );

test( 'a walk steps up a 0.29 m rise and stops at a 0.35 m one', () => {

	for ( const [ height, climbable ] of [ [ 0.29, true ], [ 0.35, false ] ] ) {

		const { runner, mover } = setup( height );

		for ( let i = 0; i < 180; i ++ ) {

			runner.velocity.set( 0, 0, 2 );
			const result = mover.walk( runner.position, runner.velocity, DT, TUNING_DEFAULTS, true );
			assert.equal( result.grounded, true );

		}

		assert.equal( runner.position.z > 1.5, climbable, `step ${ height }: ${ runner.position.toArray() }` );

	}

} );

test( 'a glide keeps its height where a walk would settle onto the floor', () => {

	const { mover } = setup();
	const position = new Vector3( 0, 0.95, 0 );

	mover.glide( position, new Vector3( 0, 0, 2 ), DT, TUNING_DEFAULTS );
	assert.equal( position.y, 0.95 );

} );

test( 'a precision arc reaches its target under plain gravity', () => {

	const start = new Vector3( 0, 1, 0 );
	const target = new Vector3( 0, 0, 4 );
	const velocity = arcVelocity( start, target );
	const time = ( target.z - start.z ) / velocity.z;
	const end = start.clone().addScaledVector( velocity, time ).add( new Vector3( 0, - 4.9 * time * time, 0 ) );

	assert.ok( end.distanceTo( target ) < 1e-9 );

} );

test( 'the crouch zooms the view in while it charges, and standing up from it zooms the view back out', () => {

	const { runner } = setup();

	runner.step( DT, input( [ 'precision' ], [ 'precision' ] ), 0 );
	assert.equal( runner.state, 'aiming' );
	assert.ok( runner.events.some( ( event ) => event.type === 'camera' && event.name === 'aimZoomIn' ) );

	runner.events.length = 0;
	runner.step( DT, input(), 0 );
	assert.equal( runner.state, 'standing' );
	assert.ok( runner.events.some( ( event ) => event.type === 'camera' && event.name === 'aimZoomOut' ) );

} );

test( 'after a jump on from a perch, walking off an edge hops again', () => {

	const { runner } = setup();

	runner.precision.landed();
	assert.equal( runner.balancing, true );

	// Jump held on the perch: the jump on launches 0.25 s later, leaps (no target here) and lands on the floor.
	runner.step( DT, input( [ 'jump' ], [ 'jump' ] ), 0 );
	assert.equal( runner.stunt?.name, 'precisionJump' );
	for ( let i = 0; i < 31; i ++ ) runner.step( DT, input(), 0 );
	assert.equal( runner.grounded, false );
	for ( let i = 0; i < 240 && ! runner.grounded; i ++ ) runner.step( DT, input(), 0 );
	assert.equal( runner.grounded, true );
	for ( let i = 0; i < 120; i ++ ) runner.step( DT, input(), 0 );

	runner.velocity.set( 0, - 0.5, 3 );
	runner.grounded = false;
	runner.walkOff();
	assert.equal( runner.velocity.y, 1.55 );
	assert.equal( runner.jumps, 1 );

} );
