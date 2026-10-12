import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { Ledges, ledgeLeapMove } from '@trizendigital/parkour/runner/Ledges.js';
import { Walls } from '@trizendigital/parkour/runner/Walls.js';
import { PipesAndZiplines } from '@trizendigital/parkour/runner/PipesAndZiplines.js';
import { Runner } from '@trizendigital/parkour/runner/Runner.js';
import { Clock } from '@trizendigital/parkour/runner/Clock.js';
import { Motion } from '@trizendigital/parkour/motion/Motion.js';
import { TUNING_DEFAULTS } from '@trizendigital/parkour/sim/tuning.js';

const near = ( a, b, epsilon = 1e-7 ) => assert.ok( Math.abs( a - b ) < epsilon, 'expected ' + a + ' = ' + b );

// A probe's hit on a wall that leans back a little at the contact, though its face stands upright.
const hit = ( point = new Vector3( 0, 2, 1 ), tags = {} ) => ( {
	point,
	centre: point.clone(),
	normal: new Vector3( 0, 0.3, - 0.95 ).normalize(),
	faceNormal: new Vector3( 0, 0, - 1 ),
	distance: 0,
	fraction: 0,
	startedInside: false,
	solid: { id: 'wall', owner: 'wall', tags: [], ...tags }
} );

// A ledge 1 m above and 1 m ahead of the runner: the wall and its top.
const ledge = () => ( { wall: hit(), top: hit( new Vector3( 0, 2, 1 ) ) } );

// A ledge right at a hanging runner's hands, so a catch on it leaves the runner where it is.
const handhold = () => ( { wall: hit( new Vector3( 0, 1.9, 0.185 ) ), top: hit( new Vector3( 0, 1.9, 0.185 ) ) } );

// A runner falling forward at 3 m/s with grab held on the keyboard, in a course whose probes find nothing.
function setup() {

	const calls = [];
	const c = {
		tuning: { values: { ...TUNING_DEFAULTS } },
		position: new Vector3( 0, 1, 0 ),
		velocity: new Vector3( 0, 0, 3 ),
		clock: new Clock(),
		get time() {

			return this.clock.time;

		},
		yaw: 0,
		jumps: 0,
		grounded: false,
		state: 'falling',
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
		applyRootMotion: Runner.prototype.applyRootMotion,
		// A floor is always found under a runner placed on top of something.
		standOnFloor() {

			this.grounded = true;
			this.state = 'standing';

		},
		bail: {
			request( byPlayer = false ) {

				c.bailed = true;
				c.bailedByPlayer = byPlayer;

			}
		},
		motion: {
			moves: {
				play: ( name, options ) => calls.push( { play: name, options } ),
				stop: ( name ) => calls.push( { stop: name } ),
				playing: () => null
			},
			// No move here carries the root by root motion; a climb's root rises 1 m/s and moves on 0.5 m/s, and has
			// risen at 0.3 s.
			rootMotion: () => null,
			moveDelta: ( name, from, to ) => new Vector3( 0, to - from, 0.5 * ( to - from ) ),
			riseTime: () => 0.3,
			rootShare: Motion.prototype.rootShare
		},
		queries: {
			sphereCast( from, to, radius, options ) {

				calls.push( { shape: 'sphere', from: from.clone(), to: to.clone(), radius, options } );

				return null;

			},
			capsuleCast( from, to, radius, halfHeight, options ) {

				calls.push( { shape: 'capsule', from: from.clone(), to: to.clone(), radius, halfHeight, options } );

				return null;

			},
			overlapSphere( at, radius, options ) {

				calls.push( { shape: 'overlapSphere', at: at.clone(), radius, options } );

				return null;

			},
			overlapCapsule( at, radius, halfHeight, options ) {

				calls.push( { shape: 'overlapCapsule', at: at.clone(), radius, halfHeight, options } );

				return null;

			},
			overlapBox( at, halfSize, rotation, options ) {

				calls.push( { shape: 'box', at: at.clone(), halfSize: halfSize.clone(), rotation: rotation.clone(), options } );

				return null;

			},
			ray( origin, direction, distance, group ) {

				calls.push( { shape: 'ray', origin: origin.clone(), direction: direction.clone(), distance, group } );

				return null;

			}
		},
		mover: {
			glide( position, velocity, dt, limits, halfHeight, displacement ) {

				calls.push( { move: 'glide', halfHeight } );
				position.add( displacement );

				return { grounded: false };

			},
			walk( position, velocity, dt, limits, wasGrounded, halfHeight, displacement ) {

				position.add( displacement );

				return { grounded: wasGrounded };

			}
		},
		slides: { rotation: new Quaternion(), end() {} },
		tricks: { resetAir() {}, cartwheelReady: true },
		walls: { kickNormal: new Vector3(), rearm() {} },
		capsule: { halfHeight: 0.9 }
	};

	// Everything is held on the keyboard: a read of the pad alone sees nothing.
	const held = new Set( [ 'grab' ] );
	const pressed = new Set();
	const input = {
		held: ( action, device ) => device !== 'pad' && held.has( action ),
		pressed: ( action ) => pressed.has( action ),
		released: () => false,
		value: () => ( { x: 0, y: 0 } ),
		move: { x: 0, y: 0 }
	};

	const ledges = new Ledges( c );
	const probes = ledges.probes;

	// Time passes and the ledge timers run.
	const wait = ( seconds ) => {

		c.clock.run( c.time + seconds, input );
		ledges.everyStep( seconds, input );

	};

	// Catches the ledge at the runner's hands from the fall and hangs there, settled: the catch's own timers have run
	// and the probes it made are forgotten.
	const hang = () => {

		probes.scan = () => handhold();
		probes.wideEnough = () => true;
		assert.equal( ledges.tryAirCatch( input ), true );
		ledges.update( 0.2, input );
		wait( 0.25 );
		delete probes.scan;
		delete probes.wideEnough;
		assert.equal( c.state, 'hanging' );
		calls.length = 0;

	};

	return { c, ledges, probes, input, held, pressed, calls, wait, hang };

}

test( 'a ledge scan stops at the first wall it meets and judges the wall upright by its face, not the contact normal; a low obstacle\'s goes on up past a top out of its sight', () => {

	const { c, probes, calls } = setup();
	let count = 0;

	c.queries.sphereCast = ( from, to, radius, options ) => {

		calls.push( { from: from.clone(), to: to.clone(), radius, options } );
		count ++;

		return count === 1 ? hit() : null;

	};

	// The wall is found on the first sweep, but nothing is found on top of it: a mid obstacle's scan stops there.
	assert.equal( probes.scan( 'midObstacle' ), null );
	assert.equal( count, 2 );

	// A low obstacle's goes on up its column (spheres 7 to 9), which meet nothing more.
	count = 0;
	calls.length = 0;
	assert.equal( probes.scan( 'lowObstacle' ), null );
	assert.equal( count, 5 );
	near( calls[ 0 ].from.y, 1 - 1.15 + 6 * 0.1555 );
	near( calls[ 0 ].to.z - calls[ 0 ].from.z, 2 );
	assert.equal( calls[ 0 ].options.group, 'probe' );
	near( calls[ 2 ].from.y, 1 - 1.15 + 7 * 0.1555 );

	count = 0;
	c.queries.sphereCast = () => ( ++ count === 1 ? hit() : hit( new Vector3( 0, 2, 1 ) ) );
	assert.ok( probes.scan( 'lowObstacle' ) );

} );

test( 'a jump from a hang leaps up through the fan of probes, checks the body\'s room, and hangs again at the new ledge', () => {

	const { c, ledges, probes, input, calls, hang } = setup();

	hang();

	let count = 0;

	c.queries.sphereCast = ( from, to, radius, options ) => {

		calls.push( { shape: 'sphere', from: from.clone(), to: to.clone(), radius, options } );
		count ++;

		// The fan meets a wall on its third sweep; the small sphere coming down finds the top of it, and the hands'
		// spheres find it either side.
		if ( radius === 0.3 ) return count < 3 ? null : hit( new Vector3( 0, 2.5, 1 ) );
		if ( radius === 0.05 && to.y < from.y ) return hit( new Vector3( 0, 2.75, 1 ) );
		if ( radius === 0.04 && to.y < from.y ) return hit( new Vector3( to.x, 2.75, 1 ) );

		return null;

	};

	const result = probes.leapFan( 1, 0 );
	assert.ok( result );
	near( calls[ 0 ].from.y, 1 + 0.9 + 0.75 );
	near( calls[ 2 ].from.y, 1 + 0.9 + 1.25 );
	near( calls[ 0 ].from.z, - 0.3 );
	near( calls[ 0 ].to.z, 0.25 );

	const body = calls.find( ( call ) => call.shape === 'overlapCapsule' );
	near( body.at.y, 2.75 - 0.55 );
	near( body.at.z, 0.5 );
	near( body.halfHeight, 0.65 );

	input.move.y = 1;
	probes.leapFan = () => result;
	assert.equal( ledges.leap( input ), true );
	assert.equal( c.state, 'leapingToLedge' );
	assert.ok( calls.some( ( call ) => call.play === 'ledgeLeapUpLeftHand' ) );

	ledges.update( 0.25, input );
	near( c.position.y, 1 + ( 2.75 - 0.9 - 1 ) * 0.5 );
	ledges.update( 0.25, input );
	assert.equal( c.state, 'hanging' );
	near( c.position.y, 2.75 - 0.9 );
	near( c.position.z, 1 - 0.185 );

} );

test( 'a ledge leap picks its move by the steer\'s sector, with the sector edges leaning the way they were authored', () => {

	// The sectors' edges: 15, 55, 115 and 165 degrees from straight up.
	const at = ( degrees ) => ( degrees * Math.PI ) / 180;

	assert.equal( ledgeLeapMove( Math.PI / 12, 1, false, false ), 'ledgeLeapUpLeftHand' );
	assert.equal( ledgeLeapMove( - Math.PI / 12, 1, false, false ), 'ledgeLeapUpLeft' );
	assert.equal( ledgeLeapMove( ( 11 * Math.PI ) / 36, 1, false, false ), 'ledgeLeapUpRight' );
	assert.equal( ledgeLeapMove( - ( 11 * Math.PI ) / 36, 0, false, false ), 'ledgeLeapSideLeft' );
	assert.equal( ledgeLeapMove( at( 90 ), 0, true, false ), null );
	assert.equal( ledgeLeapMove( - ( 23 * Math.PI ) / 36, - 1, false, false ), 'ledgeLeapDownLeft' );
	assert.equal( ledgeLeapMove( ( 11 * Math.PI ) / 12, - 1, false, false ), 'ledgeLeapDownRight' );
	assert.equal( ledgeLeapMove( - Math.PI, - 1, false, false ), null );

} );

test( 'a corner leap needs room in all three boxes, each turned its own way and of its own size', () => {

	const { probes, calls } = setup();

	assert.equal( probes.cornerClear( ledge(), 1 ), true );

	const boxes = calls.filter( ( call ) => call.shape === 'box' );
	assert.equal( boxes.length, 3 );
	assert.deepEqual( boxes.map( ( call ) => call.halfSize.toArray() ), [ [ 0.4, 0.55, 0.185 ], [ 0.15, 0.55, 0.35 ], [ 0.3, 0.6, 0.15 ] ] );
	near( boxes[ 1 ].at.x, - 0.35 );
	near( boxes[ 2 ].at.y, 1.4 );
	assert.equal( boxes.every( ( call ) => call.options.group === 'probe' ), true );

} );

test( 'a ledge caught from a fast fall hangs after 0.2 s and can be let go of from 0.25 s, but past the impact speed the catch bails', () => {

	const { c, ledges, probes, input, held, pressed, wait } = setup();

	probes.scan = ( name ) => {

		assert.equal( name, 'airLedge' );

		return ledge();

	};
	probes.wideEnough = () => true;
	c.velocity.y = - 10;
	assert.equal( ledges.tryAirCatch( input ), true );
	assert.equal( c.state, 'catchingLedge' );

	ledges.update( 0.2, input );
	assert.equal( c.state, 'hanging' );
	wait( 0.1 );

	// A flip to let go, grab released, does nothing until 0.25 s after the catch.
	held.delete( 'grab' );
	pressed.add( 'flip' );
	ledges.update( 1 / 120, input );
	assert.equal( c.state, 'hanging' );
	wait( 0.15 );
	ledges.update( 1 / 120, input );
	assert.equal( c.state, 'falling' );

	const fast = setup();

	fast.probes.scan = () => ledge();
	fast.probes.wideEnough = () => true;
	fast.c.velocity.y = - 15.56;
	assert.equal( fast.ledges.tryAirCatch( fast.input ), true );
	assert.equal( fast.c.bailed, true );
	assert.equal( fast.c.bailedByPlayer, false, 'the game bails the runner, sooner than the player\'s own bail' );
	assert.equal( fast.c.state, 'falling' );

} );

test( 'too close to vault, the runner stumbles into the obstacle and the game bails it 0.15 s later', () => {

	const { c, ledges, probes, input, held, calls, wait } = setup();

	c.grounded = true;
	c.state = 'standing';
	held.add( 'flip' );
	probes.scan = () => ledge();
	probes.vaultBlocked = () => false;
	probes.tooCloseToVault = () => true;
	assert.equal( ledges.tryVault( input ), true );
	assert.equal( c.state, 'falling' );
	assert.equal( c.velocity.y, 2 );
	assert.ok( calls.some( ( call ) => call.play === 'diveOut' ) );

	wait( 0.149 );
	assert.equal( c.bailed, undefined );
	wait( 0.001 );
	assert.equal( c.bailed, true );
	assert.equal( c.bailedByPlayer, false );

} );

test( 'a shimmy steps every step from the press, reaching for the wall with a small sphere and easing sideways, without playing a move', () => {

	const { c, input, held, wait, calls, hang } = setup();

	hang();

	let index = 0;

	c.queries.sphereCast = ( from, to, radius, options ) => {

		calls.push( { from: from.clone(), to: to.clone(), radius, options } );

		return ++ index === 1 ? hit( new Vector3( - 0.2, 1.8345, 0.2 ) ) : hit( new Vector3( - 0.2, 2, 0.2 ) );

	};

	// Pressing right steps at once.
	held.add( 'right' );
	wait( 1 / 120 );

	const arrow = calls.find( ( call ) => call.radius === 0.065 );
	assert.ok( arrow );
	near( arrow.from.x, - 0.16 );
	near( arrow.from.y, 1.8345 );
	near( arrow.from.z, 0.022 );
	near( c.position.x, ( - 0.2 * 5.5 ) / 120 );
	assert.equal( calls.some( ( call ) => call.play ), false );

	// Letting go of right stops the steps.
	const x = c.position.x;
	held.delete( 'right' );
	wait( 1 / 120 );
	wait( 1 / 120 );
	assert.equal( c.position.x, x );

} );

test( 'a flip lets go of a ledge only with grab released, drops without a launch, and a new catch waits 0.35 s', () => {

	const { c, ledges, probes, input, held, pressed, wait, hang } = setup();

	hang();
	pressed.add( 'flip' );
	ledges.update( 1 / 120, input );
	assert.equal( c.state, 'hanging' );

	held.delete( 'grab' );
	ledges.update( 1 / 120, input );
	assert.equal( c.state, 'falling' );
	near( c.velocity.y, 0 );
	pressed.clear();

	probes.scan = () => ledge();
	probes.wideEnough = () => true;
	wait( 0.349 );
	assert.equal( ledges.tryAirCatch( input ), false );
	wait( 0.001 );
	assert.equal( ledges.tryAirCatch( input ), true );

} );

test( 'a vault lets go into a fall 0.225 s after it is placed, without waiting for its move to end', () => {

	const { c, ledges, probes, input, held, calls, wait } = setup();

	c.grounded = true;
	c.state = 'standing';
	held.add( 'flip' );
	probes.scan = () => ledge();
	probes.vaultBlocked = () => false;
	probes.tooCloseToVault = () => false;
	assert.equal( ledges.tryVault( input ), true );
	assert.equal( c.state, 'vaulting' );
	assert.ok( calls.some( ( call ) => call.play === 'speedVault' ) );
	assert.equal( c.clock.readyAt( 'noCollision' ), Infinity );

	ledges.update( 0.25, input );
	wait( 0.224 );
	assert.equal( c.state, 'vaulting' );
	wait( 0.001 );
	assert.equal( c.state, 'falling' );
	assert.equal( c.clock.held( 'noCollision' ), false );
	assert.equal( c.stunt, null );

} );

test( 'a climb up is carried along its root, stands on the floor once it has risen and frees movement 0.15 s later', () => {

	const { c, ledges, probes, input, held, wait, hang } = setup();

	hang();
	held.add( 'forward' );
	probes.roomToClimb = probes.roomAbove = () => true;
	assert.equal( ledges.climbUp( input ), true );
	assert.equal( c.state, 'climbingUp' );

	ledges.update( 0.15, input );
	near( c.position.y, 1 + 1.95 * 0.5 );
	near( c.position.z, 0.35 * 0.5 );
	ledges.update( 0.15, input );
	near( c.position.y, 1 + 1.95 );
	near( c.position.z, 0.35 );
	assert.equal( c.grounded, true );
	assert.equal( c.canMove, false );
	wait( 0.149 );
	assert.equal( c.canMove, false );
	wait( 0.001 );
	assert.equal( c.canMove, true );
	assert.equal( c.climbingLedge, false );
	assert.equal( c.state, 'standing' );

} );

test( 'a power jump leaps onto the top along its root, drives over the foot, checks two clearances, flies under gravity with collisions off for 0.2 s, then falls with the air combo open', () => {

	const { c, ledges, probes, input, held, calls, wait } = setup();

	c.grounded = true;
	c.state = 'standing';
	held.add( 'jump' );
	held.delete( 'grab' );
	probes.scan = () => ledge();
	assert.equal( ledges.tryPowerJumpApproach( input ), true );

	// Onto the top (its root has risen at 0.3 s here): the jump off's move drives on over the foot before it leaps.
	ledges.update( 0.3, input );
	assert.equal( c.state, 'climbingUp' );
	assert.ok( calls.some( ( call ) => call.play === 'powerJumpOffLeft' ) );
	ledges.update( 0.12, input );
	assert.equal( c.state, 'vaulting' );
	near( c.velocity.y, 8.25 );
	near( c.clock.readyAt( 'noCollision' ), 0.2 );

	const clearances = calls.filter( ( call ) => call.shape === 'sphere' && call.radius === 0.2 );
	assert.equal( clearances.length, 2 );
	near( clearances[ 0 ].to.z - clearances[ 0 ].from.z, 1 );
	near( clearances[ 1 ].to.z - clearances[ 1 ].from.z, 0.3 );

	// The jump's move carries the root in the air, where gravity takes it.
	c.motion.rootMotion = () => ( { translation: new Vector3() } );
	ledges.update( 0.1, input );
	near( c.velocity.y, 8.25 - 9.8 * 1.75 * 0.1 );

	wait( 0.2 );
	assert.equal( c.state, 'falling' );
	assert.equal( c.airComboOpen, true );

} );

test( 'after the power jump\'s approach the next hop may start 0.35 s after it stood on top, whether it jumped from there or not', () => {

	// Let go of jump on top; jump held on top; jump held with the power jump's way blocked.
	for ( const [ jumpHeld, blocked ] of [ [ false, false ], [ true, false ], [ true, true ] ] ) {

		const { c, ledges, probes, input, held, calls, wait } = setup();

		c.grounded = true;
		c.state = 'standing';
		held.add( 'jump' );
		held.delete( 'grab' );
		probes.scan = () => ledge();
		assert.equal( ledges.tryPowerJumpApproach( input ), true );
		assert.equal( ledges.hopAgainReady, false );

		if ( ! jumpHeld ) held.delete( 'jump' );
		if ( blocked ) c.queries.sphereCast = () => hit();
		ledges.update( 0.3, input );
		ledges.update( 0.12, input );
		assert.equal( c.state === 'vaulting', jumpHeld && ! blocked );

		wait( 0.349 );
		assert.equal( ledges.hopAgainReady, false );
		wait( 0.001 );
		assert.equal( ledges.hopAgainReady, true, `jump held: ${ jumpHeld }, blocked: ${ blocked }` );

	}

} );

test( 'wall runs and pipe top-outs with no floor found move by the runner\'s root motion, guided; a ledge climb along its root', () => {

	const { c, ledges, input, held, hang } = setup();
	const modes = [];

	c.world = { pipes: [], ziplines: [], catchVolumes: [] };
	c.applyRootMotion = ( dt, mode ) => {

		modes.push( mode );

		return {};

	};

	// A wall run with grab let go carries on by its move.
	const walls = new Walls( c );
	walls.attachment = { kind: 'run', side: 'left', sideSign: - 1, elapsed: 0, clip: 'wallRunLeft' };
	walls.update( 0.1, { ...input, held: () => false } );

	const pipesAndZiplines = new PipesAndZiplines( c );
	pipesAndZiplines.attachment = { kind: 'topOut', clip: 'pipeTopOut', elapsed: 0 };
	pipesAndZiplines.update( 0.1, input );

	hang();
	held.add( 'forward' );
	ledges.probes.roomToClimb = ledges.probes.roomAbove = () => true;
	const from = c.position.clone();
	ledges.climbUp( input );
	ledges.update( 0.1, input );

	assert.deepEqual( modes, [ 'guided', 'guided' ] );
	near( c.position.y - from.y, 1.95 / 3 );

} );
