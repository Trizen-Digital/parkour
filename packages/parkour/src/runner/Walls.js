import { Vector3 } from 'three';
import { clamp, radians, wrapAngle } from '../math.js';
import { faceNormal, hasTag } from './Probes.js';
import { HANGING } from './states.js';

const UP = new Vector3( 0, 1, 0 );

// States in which the runner is busy with something else: no wall move starts.
const BUSY = new Set( [ 'hanging', 'climbingUp', 'catchingLedge', 'vaulting', 'leapingToLedge', 'onBar', 'onRope', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'onPole', 'airStunt', 'bailing' ] );

// How fast a wall run turns the runner to follow the wall (per second).
const RUN_TURN_RATE = 8;
// A wall run needs a fall no faster than this (m/s); the runner runs this far off the wall and this far up the hit (m).
const RUN_MAX_FALL = - 10;
const RUN_OFF_WALL = 0.185;
const RUN_UP_WALL = 0.25;
// The wall to run along is looked for with a ray to the side from this far below the body's centre (m)...
const RUN_WALL_PROBE_DOWN = 0.25;
// ...and a run needs nothing right in front of the body: a capsule this far ahead (m).
const RUN_FRONT_ROOM = { ahead: 0.1, radius: 0.12, halfHeight: 0.8 };
// A wall run counts as one for the jump off it (the air steering) for this long after it starts (s).
const FROM_WALL_RUN_TIME = 0.5;
// A jump that turns away from a wall run leaves at this speed (m/s).
const TURN_AWAY_SPEED = 4.25;
// A dive off a wall run pushes off sideways and rises at these speeds (m/s).
const DIVE_OFF_SIDE = 1.5;
const DIVE_OFF_UP = 5.85;
// After jumping off a wall run, another wall run waits this long (s).
const REATTACH = 0.2;
// How often the air looks ahead for a wall to plant on (s).
const FRONT_CHECK = 0.03;
// How far ahead it looks (m)...
const FRONT_REACH = 0.55;
// ...with a sphere this size (m)...
const FRONT_RADIUS = 0.08;
// ...from this far above the body's centre (m).
const FRONT_UP = 0.2555;
// A plant needs room for the body below the hands: a capsule this far below the point met and out from the wall (m).
const PLANT_ROOM = { down: 0.9, out: 0.2, radius: 0.15, halfHeight: 1.15 };
// Planted, the body's centre sits this far below the point met and out from the wall (m).
const PLANT_AT = { down: 0.5, out: 0.235 };
// A plant on a wall met head-on turns the body to it over this long (s).
const PLANT_TIME = 0.2;
// After a plant the runner counts the wall as ahead for this long (s).
const WALL_AHEAD_TIME = 0.25;
// A kick off a wall ahead: the wall within this reach (m, a sphere this size, m). A steer within KICK_STRAIGHT_BACK
// of the wall kicks straight back, else toward the steer. Another kick waits KICK_LOCK (s); the air steers like a kick
// for KICKED_TIME (s); a jump waits KICK_JUMP_LOCK (s).
const KICK_REACH = 0.35;
const KICK_RADIUS = 0.1;
const KICK_STRAIGHT_BACK = radians( 30 );
const KICK_LOCK = 0.1;
const KICKED_TIME = 0.25;
const KICK_JUMP_LOCK = 0.35;
// Two walls are the same while their normals are this close (compared squared).
const SAME_WALL = 0.0001;

// The walls' timers and holds on the runner's clock (the front check's beat runs on through a reset).
const TIMERS = [ 'wallRunEnd', 'wallRunReattach', 'fromWallRunClear', 'wallKickLock', 'kickedOffWallClear', 'wallAheadClear' ];

function forward( yaw ) {

	return new Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );

}

function right( yaw ) {

	return new Vector3( - Math.cos( yaw ), 0, Math.sin( yaw ) );

}

function yawOf( vector ) {

	return Math.atan2( vector.x, vector.z );

}

/**
 * Walls: the wall run (grab held in the air on the first jump, a wall to one side), jumping, turning or diving off it,
 * planting against a wall met head-on in the air, and kicking off a wall ahead. The wall states (states.js
 * WALL_STATES) are run by `update()`; the runner's step starts a wall run with `tryWallRun()` and a kick with
 * `tryKick()`.
 */
class Walls {

	constructor( runner ) {

		this.runner = runner;

		// The normal of the wall last kicked off: the same wall cannot be kicked off again until the ground.
		this.kickNormal = new Vector3();

		this.reset();

	}

	reset() {

		const c = this.runner;

		// What holds the runner to a wall: a run ({ kind: 'run', side, sideSign, yaw, elapsed, clip }), a plant
		// ({ kind: 'plant', from, target, fromYaw, yaw, elapsed }) or a kick ({ kind: 'kick', elapsed, yaw, steerYaw });
		// null when free.
		this.attachment = null;
		this.rearm();
		c.clock.cancel( ...TIMERS );
		c.fromWallRun = false;

	}

	/** The wall moves may start again (on the ground, once a ledge catch settles). */
	rearm() {

		this.runReady = true;
		this.kickNormal.set( 0, 0, 0 );
		// A wall ahead has been planted against; not again until the front check loses it.
		this.planted = false;
		this.runner.wallAhead = false;

	}

	// The side of the wall being run along: 'left', 'right' or null.
	get side() {

		return this.attachment?.kind === 'run' ? this.attachment.side : null;

	}

	everyStep( input ) {

		const c = this.runner;

		if ( c.grounded ) {

			this.rearm();
			c.fromWallRun = false;

		}

		if ( c.clock.every( 'frontWallCheck', FRONT_CHECK ) ) this.checkFront( input );

	}

	update( dt, input, viewYaw = this.runner.yaw ) {

		const c = this.runner;
		const a = this.attachment;

		if ( ! a ) return;

		if ( a.kind === 'run' ) {

			if ( this.tryKick( input, viewYaw ) ) return;

			a.elapsed += dt;

			// Grab held keeps to the wall, turning along it; with the wall gone or something in front the run ends. Let
			// go, the run carries on by its move until its time is up.
			if ( input.held( 'grab' ) ) {

				const hit = this.frontBlocked() ? null : this.findWall( a.sideSign );

				if ( ! hit ) {

					this.offWall();

					return;

				}

				a.yaw = yawOf( new Vector3().crossVectors( faceNormal( hit ), UP ).multiplyScalar( a.sideSign ) );
				if ( c.firstPerson ) this.camera( 'faceView', { yaw: a.yaw } );
				c.yaw += wrapAngle( a.yaw - c.yaw ) * clamp( dt * RUN_TURN_RATE, 0, 1 );

			}

			c.applyRootMotion( dt, 'guided' );

			return;

		}

		a.elapsed += dt;

		if ( a.kind === 'plant' ) {

			const alpha = clamp( a.elapsed / PLANT_TIME, 0, 1 );

			c.position.copy( a.from ).lerp( a.target, alpha );
			c.yaw = a.fromYaw + wrapAngle( a.yaw - a.fromYaw ) * alpha;
			if ( this.tryKick( input, viewYaw ) ) return;

			if ( alpha === 1 ) {

				c.velocity.set( 0, 0, 0 );
				c.clock.after( WALL_AHEAD_TIME, 'wallAheadClear', () => {

					c.wallAhead = false;

				} );
				this.attachment = null;
				c.setState( 'falling' );

			}

			return;

		}

		if ( a.kind === 'kick' && a.elapsed >= c.tuning.values.wallKickDelay ) this.kickOff( a );

	}

	// ---- Wall runs

	/** Grab held in the air on the first jump, a wall to one side (the right first): a wall run. True if one started. */
	tryWallRun( input = this.runner.input ) {

		const c = this.runner;

		if (
			! input.held( 'grab' ) ||
			this.blocked() ||
			c.wallAhead ||
			c.jumps !== 1 ||
			c.velocity.y <= RUN_MAX_FALL ||
			! this.runReady ||
			c.clock.pending( 'wallRunReattach' ) ||
			this.frontBlocked()
		) {

			return false;

		}

		for ( const side of [ 1, - 1 ] ) {

			const hit = this.findWall( side );

			if ( ! hit ) continue;

			this.beginWallRun( hit, side );

			return true;

		}

		return false;

	}

	beginWallRun( hit, side ) {

		const c = this.runner;
		const tangent = new Vector3().crossVectors( faceNormal( hit ), UP ).multiplyScalar( side );

		this.attachment = {
			kind: 'run',
			side: side < 0 ? 'left' : 'right',
			sideSign: side,
			yaw: yawOf( tangent ),
			elapsed: 0,
			clip: side < 0 ? 'wallRunLeft' : 'wallRunRight'
		};

		c.position.copy( hit.point ).addScaledVector( c.right(), side * - RUN_OFF_WALL ).addScaledVector( UP, RUN_UP_WALL );
		c.wallAhead = false;
		c.jumps = 1;
		c.fromWallRun = true;

		// The jump off it steers like one for a while, unless the run is still going.
		c.clock.after( FROM_WALL_RUN_TIME, 'fromWallRunClear', () => {

			if ( c.state !== 'wallRunning' ) c.fromWallRun = false;

		} );
		// The run's time runs out: off the wall if still on it, and it counts as a feat. A later run's time replaces it.
		c.clock.after( c.tuning.values.wallRunTime, 'wallRunEnd', () => {

			this.offWall();

		} );

		c.stunt = null;
		c.grounded = false;
		c.setState( 'wallRunning' );
		c.motion.moves.play( this.attachment.clip );
		if ( ! c.firstPerson ) this.camera( side < 0 ? 'wallRunLeft' : 'wallRunRight' );

	}

	offWall() {

		const c = this.runner;

		if ( this.attachment?.kind !== 'run' ) return false;

		this.attachment = null;
		this.runReady = false;
		c.setState( 'falling' );
		c.motion.moves.stop( 'wallRunLeft' );
		c.motion.moves.stop( 'wallRunRight' );

		return true;

	}

	// A tic-tac: the jump adds speed away from the wall; a flip released turns away from it instead.
	jumpOff( turnAway ) {

		const c = this.runner;
		const p = c.tuning.values;
		const side = this.attachment.sideSign;
		const clip = side < 0 ? 'ticTacLeft' : 'ticTacRight';

		if ( turnAway ) {

			// A quarter turn away from the wall.
			c.velocity.set( 0, 0, 0 );
			c.yaw += ( side * Math.PI ) / 2;
			c.velocity.copy( c.forward() ).multiplyScalar( TURN_AWAY_SPEED );

		} else {

			c.velocity.addScaledVector( c.right(), - side * p.wallJumpSideSpeed );

		}

		c.velocity.y = p.wallJumpUpSpeed;
		c.jumps = 1;
		c.airComboOpen = true;
		this.offWall();
		c.clock.after( REATTACH, 'wallRunReattach', () => {

			this.runReady = true;

		} );
		c.motion.moves.play( clip );
		c.setState( 'rising' );
		this.camera( 'jump' );
		this.camera( 'landing', { epicenter: c.position.clone() } );

		return true;

	}

	diveOff() {

		const c = this.runner;

		if ( c.stunt?.name === 'diveOut' ) return false;

		c.velocity.addScaledVector( c.right(), - this.attachment.sideSign * DIVE_OFF_SIDE );
		c.velocity.y = DIVE_OFF_UP;
		c.jumps ++;
		c.diving = true;
		this.offWall();
		c.airComboOpen = false;

		const rate = c.tricks.animationRate( false );

		c.startStunt( 'diveOut', { air: true, rate } );
		this.camera( 'trick' );
		this.camera( 'landing', { epicenter: c.position.clone() } );

		return true;

	}

	// The wall to one side (+1 right, −1 left) within the tuning's reach, if it is not out of bounds.
	findWall( side ) {

		const c = this.runner;
		const origin = c.position.clone().addScaledVector( UP, - RUN_WALL_PROBE_DOWN );
		const hit = c.queries.ray( origin, c.right().multiplyScalar( side ), c.tuning.values.wallRunReach, 'probe' );

		return hit && ! hasTag( hit, 'outOfBounds' ) ? hit : null;

	}

	// Something right in front of the body.
	frontBlocked() {

		const c = this.runner;
		const point = c.position.clone().addScaledVector( c.forward(), RUN_FRONT_ROOM.ahead );

		return Boolean( this.overlapCapsule( point, RUN_FRONT_ROOM.radius, RUN_FRONT_ROOM.halfHeight ) );

	}

	// ---- Plants and kicks

	// Every FRONT_CHECK: a wall met head-on in the air, with room below the hands, is planted against.
	checkFront( input ) {

		const c = this.runner;

		if ( this.blocked() || input.held( 'precision' ) || c.state === 'wallRunning' || c.state === 'wallKicking' ) return false;

		const origin = c.position.clone().addScaledVector( UP, FRONT_UP );
		const hit = this.sphereCast( origin, origin.clone().addScaledVector( c.forward(), FRONT_REACH ), FRONT_RADIUS );

		if ( ! hit ) {

			c.wallAhead = false;
			this.planted = false;

			return false;

		}

		const room = hit.point.clone().addScaledVector( UP, - PLANT_ROOM.down ).addScaledVector( faceNormal( hit ), PLANT_ROOM.out );

		if ( this.overlapCapsule( room, PLANT_ROOM.radius, PLANT_ROOM.halfHeight ) || hasTag( hit, 'noClimb' ) || hasTag( hit, 'pole' ) || this.planted ) return false;

		this.planted = true;
		if ( c.kickedOffWall ) return false;

		c.wallAhead = true;
		c.airComboOpen = true;
		c.motion.moves.stop( 'powerJumpOffLeft' );
		c.motion.moves.stop( 'walkOffHop' );

		this.attachment = {
			kind: 'plant',
			from: c.position.clone(),
			target: hit.point.clone().addScaledVector( UP, - PLANT_AT.down ).addScaledVector( faceNormal( hit ), PLANT_AT.out ),
			fromYaw: c.yaw,
			yaw: yawOf( faceNormal( hit ).clone().negate() ),
			elapsed: 0
		};
		c.stunt = null;
		c.grounded = false;
		c.setState( 'wallPlanted' );

		return true;

	}

	// A wall ahead to kick off (not the one just kicked off), unless something else is going on.
	canKick() {

		const c = this.runner;

		if ( this.blocked() || c.clock.held( 'wallKickLock' ) || c.state === 'wallKicking' ) return false;

		const hit = this.sphereCast( c.position, c.position.clone().addScaledVector( c.forward(), KICK_REACH ), KICK_RADIUS );

		return Boolean( hit && ! hasTag( hit, 'outOfBounds' ) && faceNormal( hit ).distanceToSquared( this.kickNormal ) > SAME_WALL * SAME_WALL );

	}

	/**
	 * Leaving a wall run (jump, flip released, or dive), or a flip released at a wall ahead: a kick off it, which turns
	 * the runner to the wall and leaves after the tuning's kick delay. True if it did either.
	 */
	tryKick( input = this.runner.input, viewYaw = this.runner.yaw ) {

		const c = this.runner;

		if ( c.state === 'wallRunning' ) {

			if ( c.jumps !== 1 ) return false;
			if ( input.pressed( 'jump' ) ) return this.jumpOff( false );
			if ( input.released( 'flip' ) ) return this.jumpOff( true );
			if ( input.pressed( 'dive' ) ) return this.diveOff();

			return false;

		}

		if ( ! input.released( 'flip' ) || ! this.canKick() ) return false;

		const hit = this.sphereCast( c.position, c.position.clone().addScaledVector( c.forward(), KICK_REACH ), KICK_RADIUS );

		if ( ! hit ) return false;

		this.kickNormal.copy( faceNormal( hit ) );
		c.yaw = yawOf( faceNormal( hit ).clone().negate() );
		c.kickedOffWall = true;
		c.wallAhead = false;
		c.airComboOpen = true;
		c.canMove = false;
		c.stunt = null;
		c.velocity.set( 0, 0, 0 );

		const desired = this.steerYaw( input, viewYaw );
		const left = right( desired ).dot( c.forward() ) < 0;

		c.motion.moves.play( left ? 'wallKickLeft' : 'wallKickRight' );
		this.attachment = { kind: 'kick', elapsed: 0, yaw: c.yaw, steerYaw: desired };
		c.setState( 'wallKicking' );
		c.holdJump( KICK_JUMP_LOCK );

		return true;

	}

	// The kick leaves toward the steer, or straight back, still facing the wall, when the steer points at it. The view
	// stays as it was in either person: the body never turns round to leave.
	kickOff( kick ) {

		const c = this.runner;
		const p = c.tuning.values;
		let yaw = kick.yaw;
		let speed = p.wallKickSpeed;

		if ( Math.abs( wrapAngle( kick.steerYaw - kick.yaw ) ) < KICK_STRAIGHT_BACK ) {

			speed *= - 1;

		} else {

			yaw = kick.steerYaw;

		}

		c.velocity.copy( forward( yaw ) ).multiplyScalar( speed );
		c.velocity.y = p.wallKickUpSpeed;
		c.jumps = 1;
		c.canMove = true;
		c.clock.hold( 'wallKickLock', KICK_LOCK );
		c.clock.after( KICKED_TIME, 'kickedOffWallClear', () => {

			c.kickedOffWall = false;

		} );
		this.attachment = null;
		c.setState( 'rising' );

	}

	// ---- Shared

	// Busy with something else: no wall move.
	blocked() {

		const c = this.runner;

		return (
			c.grounded ||
			c.stunt?.target ||
			HANGING.has( c.state ) ||
			c.vaulting ||
			c.climbingLedge ||
			c.climbing ||
			c.tricking ||
			c.diving ||
			BUSY.has( c.state )
		);

	}

	// The heading the stick asks for, relative to the view; the runner's own without a steer.
	steerYaw( input, viewYaw ) {

		const x = input.move.x;
		const y = input.move.y;

		return x || y ? yawOf( forward( viewYaw ).multiplyScalar( y ).addScaledVector( right( viewYaw ), x ) ) : this.runner.yaw;

	}

	sphereCast( from, to, radius ) {

		return this.runner.queries.sphereCast( from, to, radius, { group: 'probe' } );

	}

	overlapCapsule( at, radius, halfHeight ) {

		return this.runner.queries.overlapCapsule( at, radius, halfHeight, { group: 'probe' } );

	}

	event( type, name, options = {} ) {

		this.runner.events.push( { type, name, ...options } );

	}

	camera( name, options ) {

		this.event( 'camera', name, options );

	}

}

export { Walls };
