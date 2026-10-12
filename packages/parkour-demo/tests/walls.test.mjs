import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { Walls } from '@trizendigital/parkour/runner/Walls.js';
import { Runner } from '@trizendigital/parkour/runner/Runner.js';
import { Clock } from '@trizendigital/parkour/runner/Clock.js';
import { TUNING_DEFAULTS } from '@trizendigital/parkour/sim/tuning.js';

const near = ( a, b ) => assert.ok( Math.abs( a - b ) < 1e-8, `expected ${ a } = ${ b }` );

// A probe's hit on a wall carrying the given tags.
const hit = ( point, normal, tags = [] ) => ( {
	point,
	centre: point.clone(),
	normal,
	faceNormal: normal.clone(),
	distance: 0,
	fraction: 0,
	startedInside: false,
	solid: { id: 'wall', owner: 'wall', tags }
} );

// A runner in the air, rising and moving forward, with a wall 0.25 m to its right and none to its left or ahead.
function setup() {

	const calls = [];
	const c = {
		tuning: { values: { ...TUNING_DEFAULTS } },
		position: new Vector3( 0, 3, 0 ),
		velocity: new Vector3( 0, 1, 4 ),
		yaw: 0,
		state: 'rising',
		clock: new Clock(),
		get time() {

			return this.clock.time;

		},
		set time( seconds ) {

			this.clock.time = seconds;

		},
		grounded: false,
		jumps: 1,
		events: [],
		forward() {

			return new Vector3( Math.sin( this.yaw ), 0, Math.cos( this.yaw ) );

		},
		right() {

			return new Vector3( - Math.cos( this.yaw ), 0, Math.sin( this.yaw ) );

		},
		setState( state ) {

			this.state = state;

		},
		gainAdrenaline() {

			this.adrenaline = ( this.adrenaline || 0 ) + 1;

		},
		motion: {
			moves: {
				play: ( name ) => calls.push( { kind: 'play', name } ),
				stop: ( name ) => calls.push( { kind: 'stop', name } )
			},
			// A wall run carries the runner 4 m/s along the wall and 0.1 m/s up it.
			rootMotion: ( dt ) => ( { translation: new Vector3( 0, 0.1 * dt, 4 * dt ) } )
		},
		applyRootMotion: Runner.prototype.applyRootMotion,
		holdJump: Runner.prototype.holdJump,
		capsule: { halfHeight: 0.9 },
		queries: {
			ray: ( origin, direction, distance, group ) => {

				calls.push( { kind: 'ray', origin: origin.clone(), direction: direction.clone(), distance, group } );

				return direction.x < 0 ? hit( origin.clone().addScaledVector( direction, 0.25 ), new Vector3( 1, 0, 0 ) ) : null;

			},
			sphereCast: ( from, to, radius, options ) => {

				calls.push( { kind: 'sphere', from: from.clone(), to: to.clone(), radius, group: options.group } );

				return null;

			},
			overlapCapsule: ( at, radius, halfHeight, options ) => {

				calls.push( { kind: 'capsule', at: at.clone(), radius, halfHeight, group: options.group } );

				return null;

			}
		},
		mover: {
			glide: ( position, velocity, dt, limits, halfHeight, displacement ) => {

				calls.push( { kind: 'glide', displacement: displacement.clone() } );
				position.add( displacement );

				return { grounded: false };

			}
		},
		slides: { rotation: new Quaternion() }
	};
	const input = {
		held: ( action ) => action === 'grab',
		pressed: () => false,
		released: () => false,
		move: { x: 0, y: 0 }
	};

	const walls = new Walls( c );

	// The clock reaches a time, a step after the last, and the wall timers run.
	const at = ( time ) => {

		c.clock.run( time, input );
		walls.everyStep( input );

	};

	return { c, walls, input, calls, at };

}

test( 'a wall run checks the space ahead, then looks for a wall on the right before the left', () => {

	const { c, walls, input, calls } = setup();

	assert.equal( walls.tryWallRun( input ), true );

	const ahead = calls.find( ( call ) => call.kind === 'capsule' );
	near( ahead.radius, 0.12 );
	near( ahead.halfHeight, 0.8 );
	near( ahead.at.z, 0.1 );
	assert.equal( ahead.group, 'probe' );

	// The wall on the right is found first, so the left is never looked at.
	const rays = calls.filter( ( call ) => call.kind === 'ray' );
	assert.equal( rays.length, 1 );
	assert.ok( calls.indexOf( ahead ) < calls.indexOf( rays[ 0 ] ) );
	near( rays[ 0 ].origin.y, 2.75 );
	near( rays[ 0 ].direction.x, - 1 );
	near( rays[ 0 ].distance, 0.35 );
	assert.equal( rays[ 0 ].group, 'probe' );

	assert.equal( c.state, 'wallRunning' );
	near( c.position.x, - 0.065 );
	near( c.position.y, 3 );
	assert.ok( calls.some( ( call ) => call.kind === 'play' && call.name === 'wallRunRight' ) );

} );

test( 'a wall run let go of keeps moving by its root motion until the 0.7 s run time ends it', () => {

	const { c, walls, input, calls, at } = setup();

	walls.tryWallRun( input );
	input.held = () => false;
	at( 0.5 );
	walls.update( 0.5, input, 0 );
	assert.equal( c.state, 'wallRunning' );
	assert.equal( c.fromWallRun, true );
	near( c.position.z, 2 );
	assert.ok( calls.some( ( call ) => call.kind === 'glide' ) );

	at( 0.7 );
	assert.equal( c.state, 'falling' );
	assert.equal( walls.runReady, false );
	assert.equal( c.fromWallRun, true );

} );

test( 'a wall run left early does not cut the next one short: each run has its own 0.7 s', () => {

	const { c, walls, input, at } = setup();

	walls.tryWallRun( input );

	// Off the wall with a jump at 0.3 s, and along it again at 0.5 s, once the reattach wait is over.
	at( 0.3 );
	input.pressed = ( action ) => action === 'jump';
	assert.equal( walls.tryKick( input ), true );
	input.pressed = () => false;
	at( 0.5 );
	assert.equal( walls.tryWallRun( input ), true );

	at( 0.7 );
	assert.equal( c.state, 'wallRunning' );
	at( 1.19 );
	assert.equal( c.state, 'wallRunning' );
	at( 1.2 );
	assert.equal( c.state, 'falling' );

} );

test( 'a jump off a wall run adds sideways speed, while a flip release turns away and replaces it', () => {

	for ( const turn of [ false, true ] ) {

		const { c, walls, input, at } = setup();

		walls.tryWallRun( input );
		input.pressed = ( action ) => ! turn && action === 'jump';
		input.released = ( action ) => turn && action === 'flip';
		assert.equal( walls.tryKick( input ), true );
		near( c.velocity.x, turn ? 4.25 : 2.25 );
		near( c.velocity.z, turn ? 0 : 4 );
		near( c.velocity.y, 5.85 );
		assert.equal( c.jumps, 1 );

		// The same wall can be run again 0.2 s later.
		at( 0.2 );
		assert.equal( walls.runReady, true );

	}

} );

test( 'a wall ahead is looked for every 0.03 s behind a clearance check, planted against over 0.2 s, and remembered for 0.25 s', () => {

	const { c, walls, input, calls, at } = setup();

	input.held = () => false;
	c.queries.sphereCast = ( from, to, radius, options ) => {

		calls.push( { kind: 'sphere', from: from.clone(), to: to.clone(), radius, group: options.group } );

		return hit( new Vector3( 0, 3.2555, 0.4 ), new Vector3( 0, 0, - 1 ) );

	};

	at( 0.029 );
	assert.equal( c.state, 'rising' );
	at( 0.03 );
	assert.equal( c.state, 'wallPlanted' );
	assert.equal( c.wallAhead, true );

	const probe = calls.find( ( call ) => call.kind === 'sphere' );
	near( probe.from.y, 3.2555 );
	near( probe.to.z, 0.55 );
	near( probe.radius, 0.08 );
	const clearance = calls.find( ( call ) => call.kind === 'capsule' );
	near( clearance.at.y, 2.3555 );
	near( clearance.at.z, 0.2 );
	near( clearance.radius, 0.15 );
	near( clearance.halfHeight, 1.15 );

	c.time = 0.23;
	walls.update( 0.2, input, 0 );
	near( c.position.y, 2.7555 );
	near( c.position.z, 0.165 );
	assert.equal( c.state, 'falling' );
	near( c.velocity.length(), 0 );

	at( 0.48 );
	assert.equal( c.wallAhead, false );

} );

test( 'a flip released at a wall ahead kicks off it after 0.15 s, straight back or toward a steer more than 30 degrees away', () => {

	// No steer kicks straight back off the wall; a steer to the left (+x, at yaw 0) is 90 degrees away and wins.
	for ( const [ move, kick ] of [ [ { x: 0, y: 0 }, new Vector3( 0, 6.5, - 5.85 ) ], [ { x: - 1, y: 0 }, new Vector3( 5.85, 6.5, 0 ) ] ] ) {

		const { c, walls, input, at } = setup();

		input.move = move;
		input.released = ( action ) => action === 'flip';
		input.held = () => false;
		c.queries.sphereCast = () => hit( new Vector3( 0, 3, 0.35 ), new Vector3( 0, 0, - 1 ) );

		assert.equal( walls.tryKick( input, 0 ), true );
		near( c.velocity.length(), 0 );
		assert.equal( c.state, 'wallKicking' );
		walls.update( 0.149, input, 0 );
		near( c.velocity.length(), 0 );

		c.time = 0.15;
		walls.update( 0.001, input, 0 );
		near( c.velocity.x, kick.x );
		near( c.velocity.y, kick.y );
		near( c.velocity.z, kick.z );
		assert.equal( c.jumps, 1 );
		assert.equal( walls.canKick(), false );

		// Past the 0.1 s lock the same wall still cannot be kicked off again.
		at( 0.25 );
		assert.equal( walls.canKick(), false );

	}

} );

test( 'a wall run is refused on a part tagged outOfBounds, after a second jump, when falling fast or with a wall ahead', () => {

	{

		const { c, walls, input } = setup();

		c.queries.ray = () => hit( new Vector3(), new Vector3( 1, 0, 0 ), [ 'outOfBounds' ] );
		assert.equal( walls.tryWallRun( input ), false );

	}

	for ( const change of [
		( c ) => {

			c.jumps = 2;

		},
		( c ) => {

			c.velocity.y = - 10;

		},
		( c ) => {

			c.wallAhead = true;

		}
	] ) {

		const { c, walls, input } = setup();

		change( c );
		assert.equal( walls.tryWallRun( input ), false );

	}

} );

test( 'a wall run says which side it runs on, and nothing of it is left once the walls reset, as a bail does', () => {

	const { c, walls, input } = setup();

	assert.equal( walls.tryWallRun( input ), true );
	assert.equal( c.state, 'wallRunning' );
	assert.equal( walls.side, 'right' );

	walls.reset();
	c.setState( 'bailing' );
	assert.equal( walls.side, null );
	assert.equal( walls.attachment, null );
	assert.equal( c.fromWallRun, false );

} );
