import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PipesAndZiplines } from '@trizendigital/parkour/runner/PipesAndZiplines.js';
import { createEngine } from '../src/engines.js';
import { catchVolumes, ziplineVolume } from '@trizendigital/parkour/world/catchVolumes.js';
import { Runner } from '@trizendigital/parkour/runner/Runner.js';
import { Motion } from '@trizendigital/parkour/motion/Motion.js';
import { Clock } from '@trizendigital/parkour/runner/Clock.js';
import { TUNING_DEFAULTS } from '@trizendigital/parkour/sim/tuning.js';

const engine = await createEngine( 'rapier' );

const near = ( a, b, epsilon = 1e-6 ) => assert.ok( Math.abs( a - b ) < epsilon, 'expected ' + a + ' = ' + b );

// A pipe 15 m tall or a 10 m zipline at the origin, and a runner beside it with the grab held. The runner's
// queries, mover and motion are stand-ins; the rays cast and the moves played are kept in calls.
function setup( kind = 'pipe' ) {

	const route = {
		id: kind,
		start: new Vector3(),
		end: kind === 'pipe' ? new Vector3( 0, 15, 0 ) : new Vector3( 10, 0, 0 ),
		forward: new Vector3( 1, 0, 0 )
	};
	const pipes = kind === 'pipe' ? [ route ] : [];
	const ziplines = kind === 'zipline' ? [ route ] : [];
	const volumes = catchVolumes( pipes, ziplines );
	const calls = [];
	const playing = [];
	const c = {
		tuning: { values: { ...TUNING_DEFAULTS } },
		world: { pipes, ziplines, catchVolumes: volumes, catchWorld: engine.createQueryWorld( volumes ) },
		position: kind === 'pipe' ? new Vector3( - 0.6, 3, 0 ) : new Vector3( 2, - 1, 0 ),
		velocity: new Vector3(),
		clock: new Clock(),
		get time() {

			return this.clock.time;

		},
		set time( seconds ) {

			this.clock.time = seconds;

		},
		yaw: Math.PI / 2,
		state: 'falling',
		grounded: false,
		events: [],
		slides: { rotation: null },
		forward() {

			return new Vector3( Math.sin( this.yaw ), 0, Math.cos( this.yaw ) );

		},
		setState( state ) {

			this.state = state;

		},
		applyRootMotion: Runner.prototype.applyRootMotion,
		standOnFloor() {

			this.stoodOnFloor = true;
			this.state = 'standing';
			this.grounded = true;

		},
		motion: {
			moves: {
				play( name, options ) {

					calls.push( { name, options } );

				},
				stop() {},
				playing: () => playing.at( - 1 ) || null,
				busy: () => playing.length > 0
			},
			// The move playing carries the root 2 m/s up and 1 m/s forward: it is a second long and has risen at 0.5 s
			// (as far as these stand-ins say).
			rootMotion( dt ) {

				return { translation: new Vector3( 0, 2 * dt, dt ) };

			},
			moveDelta: ( name, from, to ) => new Vector3( 0, 2 * ( to - from ), to - from ),
			length: () => 1,
			riseTime: () => 0.5,
			rootShare: Motion.prototype.rootShare
		},
		queries: {
			ray( origin, direction, distance, group ) {

				calls.push( { origin: origin.clone(), direction: direction.clone(), distance, group } );
				return { point: origin.clone(), normal: new Vector3(), distance, solid: { tags: [] } };

			}
		},
		mover: {
			glide( position, velocity, dt, limits, halfHeight, displacement ) {

				position.add( displacement );

				return { grounded: false };

			}
		},
		capsule: { halfHeight: 0.9 },
		tricks: { resetAir() {} },
		walls: { kickNormal: new Vector3() }
	};
	const held = new Set( [ 'grab' ] );
	const input = {
		held: ( action ) => held.has( action ),
		pressed: ( action ) => action === 'grab',
		released: () => false,
		value: () => 0,
		move: { x: 0, y: 0 }
	};
	const pipesAndZiplines = new PipesAndZiplines( c );
	// A step of the runner's: the clock runs (the timers fire), then the volumes look.
	const step = ( dt ) => {

		c.clock.run( c.time + dt, input );
		pipesAndZiplines.everyStep();

	};

	const attach = () => {

		pipesAndZiplines.everyStep();
		step( 0.05 );
		return pipesAndZiplines.tryAttach( input );

	};

	return { c, input, held, route, playing, pipesAndZiplines, step, attach, calls };

}

test( 'a runner inside a pipe\'s volume finds the pipe 50 ms later, and loses it outside the volume', () => {

	const { c, pipesAndZiplines, input, step } = setup();
	pipesAndZiplines.everyStep();
	assert.equal( pipesAndZiplines.tryAttach( input ), false );
	step( 0.049 );
	assert.equal( pipesAndZiplines.tryAttach( input ), false );
	step( 0.001 );
	assert.equal( pipesAndZiplines.tryAttach( input ), true );
	near( pipesAndZiplines.attachment.target.x, - 0.3 );
	near( pipesAndZiplines.attachment.target.y, Math.hypot( 0.6, 3 ) );

	c.position.set( 0.36, 3, 0 );
	pipesAndZiplines.reset();
	pipesAndZiplines.everyStep();
	step( 0.05 );
	assert.equal( pipesAndZiplines.volumes.current.pipe, null );

	c.position.set( - 0.6, 3, 0 );
	pipesAndZiplines.everyStep();
	step( 0.05 );
	assert.ok( pipesAndZiplines.volumes.current.pipe );

} );

test( 'at the runner\'s 120 steps a second, a volume looks on its own hold on the runner\'s clock: 50 ms after the runner is found in it, then every 50 ms', () => {

	const { c, pipesAndZiplines, step } = setup();
	const volumes = pipesAndZiplines.volumes, [ pipe ] = volumes.volumes;
	const steps = ( count ) => {

		for ( let i = 0; i < count; i ++ ) step( 1 / 120 );

	};

	pipesAndZiplines.everyStep();
	assert.equal( c.clock.held( pipe.hold ), true );
	steps( 5 );
	assert.equal( volumes.current.pipe, null );
	steps( 1 );
	assert.equal( volumes.current.pipe, pipe );
	near( pipe.detection.y, Math.hypot( 0.6, 3 ) );

	// Climbing on, the volume looks again six steps after its last look, not before.
	c.position.y = 4;
	steps( 5 );
	near( pipe.detection.y, Math.hypot( 0.6, 3 ) );
	steps( 1 );
	near( pipe.detection.y, Math.hypot( 0.6, 4 ) );

	// Out of the volume it is forgotten, its hold with it; back in, the wait starts again.
	c.position.set( 3, 4, 0 );
	steps( 1 );
	assert.equal( volumes.current.pipe, null );
	assert.equal( c.clock.held( pipe.hold ), false );
	c.position.set( - 0.6, 4, 0 );
	steps( 6 );
	assert.equal( volumes.current.pipe, null );
	steps( 1 );
	assert.equal( volumes.current.pipe, pipe );

} );

test( 'a runner grabs a pipe only when no move is playing, climbs and slides on its line, and stays put with the jump held', () => {

	const { c, pipesAndZiplines, input, held, playing, attach, calls } = setup();
	playing.push( { name: 'landingRoll' } );
	assert.equal( attach(), false );
	playing.length = 0;
	assert.equal( pipesAndZiplines.tryAttach( input ), true );
	const target = pipesAndZiplines.attachment.target.clone();
	pipesAndZiplines.update( 0.2, input, 0 );
	near( c.position.distanceTo( target ), 0 );

	// Up at the tuning's climb speed, 2 m/s.
	const y = c.position.y;
	held.add( 'forward' );
	pipesAndZiplines.update( 0.1, input, 0 );
	near( c.position.y, y + 0.2 );
	const above = calls.find( ( call ) => call.distance === 0.55 );
	near( above.origin.y, y + 1.15 );
	assert.equal( above.group, 'probe' );

	held.add( 'jump' );
	pipesAndZiplines.update( 0.1, input, 0 );
	near( c.position.y, y + 0.2 );

	held.delete( 'forward' );
	held.delete( 'jump' );
	held.add( 'back' );
	c.queries.ray = () => null;
	pipesAndZiplines.update( 0.1, input, 0 );
	near( c.position.y, y - 0.2 );
	assert.equal( pipesAndZiplines.going, 'down' );

	// Letting go of the grab does not drop the runner off a pipe.
	input.released = ( action ) => action === 'grab';
	pipesAndZiplines.update( 0.1, input, 0 );
	assert.equal( c.state, 'onPipe' );

} );

test( 'a jump off a pipe leaves the way the stick points and gives back the jump on the next step', () => {

	const { c, pipesAndZiplines, input, attach, step } = setup();
	attach();
	pipesAndZiplines.update( 0.2, input, 0 );
	input.move = { x: 0, y: 1 };
	input.released = ( action ) => action === 'jump';
	pipesAndZiplines.update( 0.01, input, 0 );
	near( c.velocity.z, 4.5 );
	near( c.velocity.y, 4.6 );
	assert.equal( c.state, 'rising' );
	assert.equal( c.jumps, 0 );

	step( 1 / 120 );
	assert.equal( c.jumps, 1 );
	assert.ok( c.clock.held( 'pipeLock' ) );

} );

test( 'climbing off the top of a pipe goes up and on along the take\'s root onto the floor there, and stands on it once the move ends on its own and the body is up', () => {

	const { c, pipesAndZiplines, input, held, attach, calls, step } = setup();
	attach();
	pipesAndZiplines.update( 0.2, input, 0 );
	// Nothing ahead of the hands; the floor at the top 4 m up.
	c.queries.ray = ( origin, direction ) => direction.y < 0 ? { point: origin.clone().setY( 4 ), distance: 0.5 } : null;
	held.add( 'forward' );
	pipesAndZiplines.update( 0.01, input, 0 );
	assert.equal( c.state, 'toppingOut' );

	// Half the rise in: half way up onto the floor, and half way on to as far as the root goes (a metre, along +x).
	const play = calls.find( ( call ) => call.name === 'pipeTopOut' );
	const from = c.position.clone();
	pipesAndZiplines.update( 0.25, input, 0 );
	near( c.position.y, from.y + ( 4 + 0.9 + 0.0215 - from.y ) * 0.5 );
	near( c.position.x - from.x, 0.5 );

	// The move done before the body is up: it waits for the rise.
	play.options.onBlendOut( { interrupted: false } );
	step( 0.01 );
	assert.equal( c.stoodOnFloor, undefined );
	pipesAndZiplines.update( 0.3, input, 0 );
	near( c.position.y, 4 + 0.9 + 0.0215 );
	step( 0.01 );
	assert.equal( c.stoodOnFloor, true );
	assert.equal( c.canMove, true );

} );

test( 'with no floor found at the top, climbing off a pipe follows the take\'s root motion, and stands only when the move ends on its own', () => {

	const { c, pipesAndZiplines, input, held, attach, calls, step } = setup();
	attach();
	pipesAndZiplines.update( 0.2, input, 0 );
	c.queries.ray = () => null;
	held.add( 'forward' );
	pipesAndZiplines.update( 0.01, input, 0 );
	assert.equal( c.state, 'toppingOut' );
	assert.equal( c.canMove, false );

	const play = calls.find( ( call ) => call.name === 'pipeTopOut' );
	const position = c.position.clone();
	pipesAndZiplines.update( 0.1, input, 0 );
	near( c.position.y - position.y, 0.2 );
	near( c.position.x - position.x, 0.1 );

	play.options.onBlendOut( { interrupted: true } );
	step( 0.01 );
	assert.equal( c.stoodOnFloor, undefined );
	pipesAndZiplines.update( 0.4, input, 0 );
	play.options.onBlendOut( { interrupted: false } );
	pipesAndZiplines.update( 0.01, input, 0 );
	step( 0.01 );
	assert.equal( c.stoodOnFloor, true );
	assert.equal( c.canMove, true );

} );

test( 'a zipline\'s volume runs past both ends, and the runner hangs below the cable at the nearest point along it', () => {

	const { c, route, pipesAndZiplines, attach } = setup( 'zipline' );
	const vertices = ziplineVolume( route );
	near( vertices[ 0 ], - 0.55 );
	near( vertices[ 1 ], - 0.62 );
	near( vertices[ 2 ], - 0.62 );
	near( vertices[ 9 ], - 0.55 );
	near( vertices[ 10 ], 0.63 );
	near( vertices[ 11 ], 0.63 );
	near( vertices[ 12 ], 10.55 );
	near( vertices[ 22 ], 0.58 );
	near( vertices[ 23 ], 0.58 );

	// Just past the start, the runner takes the cable at its start; along it, at its place across the ground.
	c.position.set( - 0.5, - 1, 0 );
	assert.equal( attach(), true );
	near( pipesAndZiplines.attachment.caughtAt.x, 0 );
	near( pipesAndZiplines.attachment.target.y, - 1.02 );

} );

test( 'a zipline carries the runner onto the cable, rides it gathering speed toward its own, and throws them off the end', () => {

	const { c, pipesAndZiplines, input, attach } = setup( 'zipline' );
	assert.equal( attach(), true );
	const from = c.position.clone(), target = pipesAndZiplines.attachment.target.clone();
	pipesAndZiplines.update( 0.075, input, 0 );
	near( c.position.y, from.y + ( target.y - from.y ) * 0.5 );
	pipesAndZiplines.update( 0.075, input, 0 );
	near( c.position.distanceTo( target ), 0 );

	// From standing still on the cable, 8 m to its end at a speed closing on 8.5 m/s: about 1.27 s.
	let time = 0;
	while ( c.state === 'onZipline' && time < 3 ) {

		pipesAndZiplines.update( 1 / 120, input, 0 );
		time += 1 / 120;

	}

	assert.ok( Math.abs( time - 1.27 ) < 0.02, time );
	assert.equal( c.state, 'rising' );
	near( c.velocity.x, 8 );
	near( c.velocity.y, 1.25 );
	assert.equal( c.clock.readyAt( 'ziplineLock' ), Infinity );

} );

test( 'a zipline caught on the run keeps going the way it was: never back up the cable, never stopped', () => {

	const { c, pipesAndZiplines, input, attach } = setup( 'zipline' );
	c.velocity.set( 5, 1, 0 );
	assert.equal( attach(), true );
	const caught = pipesAndZiplines.attachment.caughtAt.x;
	let x = c.position.x;

	for ( let i = 0; i < 40; i ++ ) {

		pipesAndZiplines.update( 1 / 120, input, 0 );
		assert.ok( c.position.x > x, `step ${i}` );
		x = c.position.x;

	}

	assert.ok( x > caught + 1 );

} );

test( 'letting go of a zipline drops the runner on the next step, at the ride\'s exit speed', () => {

	const { c, pipesAndZiplines, input, attach, step } = setup( 'zipline' );
	attach();
	pipesAndZiplines.update( 0.15, input, 0 );
	pipesAndZiplines.update( 0.01, input, 0 );

	input.pressed = () => false;
	input.released = ( action ) => action === 'grab';
	pipesAndZiplines.update( 0.01, input, 0 );
	assert.equal( c.state, 'onZipline' );
	assert.ok( c.velocity.x > 0 );
	step( 1 / 120 );
	assert.equal( c.state, 'rising' );
	near( c.velocity.x, 8 );
	near( c.velocity.y, 1.25 );
	near( c.clock.readyAt( 'ziplineLock' ), c.time - 1 / 120 + 0.35 );

} );
