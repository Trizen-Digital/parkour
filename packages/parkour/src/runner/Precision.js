import { Quaternion, Vector3 } from 'three';
import { Probes } from './Probes.js';
import { GRAVITY } from '../sim/tuning.js';

const UP = new Vector3( 0, 1, 0 );

// Precision held keeps the precision-landing window open this long (s); tuck held in the air, the roll window.
const PRECISION_WINDOW = 0.35;
const ROLL_WINDOW = 0.35;

// The crouch starts only nearly still (m/s). It charges by CHARGE_STEP every CHARGE_EVERY (s), and lasts at most
// AIM_TIME (s) before the runner stands up.
const CROUCH_MAX_SPEED = 2.5;
const CHARGE_STEP = 0.012;
const CHARGE_EVERY = 0.01;
const AIM_TIME = 1;
// The precision jump launches LAUNCH_DELAY (s) after the press (as precision_jump's push off ends) with at least
// MIN_CHARGE of charge, forward at FORWARD_SPEED (m/s) per unit of charge.
const LAUNCH_DELAY = 0.25;
const MIN_CHARGE = 0.45;
const FORWARD_SPEED = 6.5;
// Standing up out of the crouch blends its move out over this long (s).
const STAND_UP_BLEND = 0.25;

// A precision landing balances on the perch: the perch landing plays at PERCH_RATE, the balance lasts BALANCE_TIME (s),
// the precision window closes WINDOW_CLOSE (s) in (held or not), the feet are checked for support SUPPORT_CHECK (s) in,
// and the next jump waits PERCH_JUMP_LOCK (s).
const PERCH_RATE = 0.9;
const BALANCE_TIME = 0.45;
const WINDOW_CLOSE = 0.1;
const SUPPORT_CHECK = 0.15;
const PERCH_JUMP_LOCK = 0.7;
// The feet the perch stands on (m, from the body's centre, sideways, down and ahead), each needing a floor under it
// within a small capsule (FOOT_FLOOR, m) FOOT_REACH further ahead.
const PERCH_FEET = [ { out: 0.083, down: 0.809, ahead: - 0.027 }, { out: - 0.033, down: 0.81, ahead: 0.135 } ];
const FOOT_REACH = 0.055;
const FOOT_FLOOR = { radius: 0.13, halfHeight: 0.25 };
// From a perch: a wall this close ahead (m) keeps the runner on it. A jump on flies the arc to the next target, at
// ARC_BOOST times the plain-gravity speed, if there is room at the target; without one it leaps (forward, up, m/s).
// The camera shakes as for a style jump, at JUMP_ON_SHAKE of its strength. Stepping off hops up and forward (m/s) a
// moment in (s).
const FRONT_CLEAR = 0.85;
const ARC_BOOST = 1.45;
const JUMP_ON_SHAKE = 0.55;
const LEAP = [ 5.5, 5.85 ];
const STEP_OFF_UP = 3.6;
const STEP_OFF_FORWARD = 3;
const STEP_OFF_DELAY = 0.05;
// A target needs room for the body, a capsule this far short of it (m, radius and half height).
const TARGET_ROOM = { back: 0.35, radius: 0.18, halfHeight: 0.35 };

// The back flip out of the crouch: it needs a capsule of room (m) and flies back per unit of charge and up (m/s); with
// a floor behind to land on (a box BACKFLIP_SUPPORT back and down) it is the standing back flip, whose landing the
// pose shows for BACKFLIP_LANDING_TIME (s).
const BACKFLIP_ROOM = { radius: 0.45, halfHeight: 0.85 };
const BACKFLIP_BACK = - 1.25;
const BACKFLIP_UP = 5.85;
const BACKFLIP_SUPPORT = { back: 1.35, down: 1.1, halfSize: new Vector3( 0.15, 0.3, 0.55 ) };
const BACKFLIP_LANDING_TIME = 1;
// The standing back flip launches this long after the press (s), the running one (no floor behind) sooner. The
// running one's move is timed to the flight of a flip leaving RUNNING_BACKFLIP_TIMED_BACK (m/s) back and BACKFLIP_UP
// up, before its charge is known.
const STANDING_BACKFLIP_DELAY = 0.15;
const RUNNING_BACKFLIP_DELAY = 0.1;
const RUNNING_BACKFLIP_TIMED_BACK = 2;

// A stride needs an edge right ahead (no floor in a small capsule just past the feet), nothing in the way for
// STRIDE_CLEAR (m) nor in a box swept STRIDE_SWEEP ahead, and a target. It is placed on the target over STRIDE_TIME (s)
// and ends at STRIDE_LENGTH (s).
const EDGE = { ahead: 0.55, down: 0.9, radius: 0.035, halfHeight: 0.25 };
const STRIDE_CLEAR = 3.5;
const STRIDE_SWEEP = { from: 0.01, length: 3, halfSize: new Vector3( 0.25, 0.25, 0.25 ) };
const STRIDE_TIME = 0.5;
const STRIDE_LENGTH = 0.51;
// A stride's take runs on past its landing, over the foot it came down on and then the other (its root carrying the
// runner along the top), and a stride straight after it picks up the step that one has got to, so the legs keep going
// forward. The two sides' takes are one capture, mirrored. Until `until` (s into the last one's take) the foot it landed
// on is down, and the next stride takes off from it, so it is the other side's, its take `other` (s) behind the last
// one's; after, the other foot is down, and the next stride is the same side's, `same` behind. The lags are where the
// takes' poses match best, and the switch where the two match as well (tests/stride-chain.test.mjs).
const STRIDES = new Set( [ 'strideLeft', 'strideRight' ] );
const STRIDE_HAND_OVER = { until: 0.872, other: 0.589, same: 0.935 };
// The body's centre stands this far above the floor it is placed on (m).
const STAND_HEIGHT = 0.92;

// How far the jump on from a perch leans from straight up toward its target (0 up, 1 straight at it).
const ARC_LEAN = 0.45;

/**
 * The launch velocity that carries a projectile from start to end on an arc: the direction leans `arc` of the way from
 * straight up toward the target; gravity is plain (m/s², negative). Null when no speed reaches it.
 */
function arcVelocity( start, end, gravity = - GRAVITY, arc = ARC_LEAN ) {

	const difference = end.clone().sub( start );
	const direction = UP.clone().lerp( difference.clone().normalize(), arc ).normalize();
	const horizontal = Math.hypot( difference.x, difference.z );
	const cosine = Math.hypot( direction.x, direction.z );
	const denominator = 2 * cosine * cosine * ( difference.y - ( horizontal * direction.y ) / cosine );
	const speedSquared = ( gravity * horizontal * horizontal ) / denominator;

	return Number.isFinite( speedSquared ) && speedSquared >= 0 ? direction.multiplyScalar( Math.sqrt( speedSquared ) ) : null;

}

// Precision's timers and beat on the runner's clock.
const TIMERS = [ 'precisionCharge', 'perchWindowClose', 'perchFootCheck', 'balanceEnd', 'backflipLandingEnd' ];

/**
 * Precision: the crouch that charges a precision jump (or a standing back flip), the precision landing that balances
 * on a perch (and slips off one without support), the jump on from a perch, and the stride onto a target past an edge.
 */
class Precision {

	constructor( runner ) {

		this.runner = runner;

		this.probes = new Probes( runner );

		this.reset();

	}

	reset() {

		const c = this.runner;

		c.clock.cancel( ...TIMERS );
		// The last stride's side: one that does not follow straight on from it takes off from the other foot.
		this.strideLeft = false;
		c.backflipLanding = false;

	}

	// Precision held keeps the precision window open, tuck held in the air the roll window: each stays open a while after.
	everyStep( input ) {

		const c = this.runner;

		if ( input.held( 'precision' ) && ! c.diving ) c.clock.hold( 'precisionWindow', PRECISION_WINDOW );
		if ( input.held( 'tuck' ) && ! c.grounded && ! c.diving && c.state !== 'hanging' && ! c.wallAhead && ! c.clock.held( 'getUpSettle' ) ) c.clock.hold( 'rollWindow', ROLL_WINDOW );
		// Off the top it landed on, a stride's take stops running on.
		if ( ! c.grounded && ! c.stunt ) for ( const name of STRIDES ) c.motion.moves.stop( name );

	}

	/** The perch, the crouch and the stride: true when one of them has the runner this step. */
	update( input ) {

		const c = this.runner;

		if ( c.balancing ) {

			this.leavePerch( input );

			return true;

		}

		if ( c.state === 'aiming' ) {

			this.aim( input );

			return true;

		}

		if ( input.pressed( 'precision' ) && c.precisionAllowed && c.grounded && c.speed <= CROUCH_MAX_SPEED ) {

			c.setState( 'aiming' );
			c.precisionCharge = 0;
			// The charge's beat begins with the crouch.
			c.clock.cancel( 'precisionCharge' );
			c.velocity.set( 0, 0, 0 );
			c.motion.moves.play( 'precisionCrouch' );
			this.camera( 'aimZoomIn' );

			return true;

		}

		return input.held( 'grab' ) && c.grounded && ! c.stunt && this.tryStride();

	}

	/** From a perch the runner may jump on to the next target, or step off forward: true if it did. */
	leavePerch( input ) {

		const c = this.runner;

		if ( input.held( 'jump' ) && c.jumps < 1 && ! this.frontBlocked() ) {

			this.jumpOn();

			return true;

		}

		if ( input.held( 'grab' ) && c.jumps < 1 && ! this.frontBlocked() ) {

			this.stepOff();

			return true;

		}

		return false;

	}

	/** A precision landing: balance on the perch. */
	landed() {

		const c = this.runner;

		c.balancing = true;
		c.clock.release( 'rollWindow' );
		c.holdJump( PERCH_JUMP_LOCK );
		c.clock.after( WINDOW_CLOSE, 'perchWindowClose', () => c.clock.release( 'precisionWindow' ) );
		c.clock.after( SUPPORT_CHECK, 'perchFootCheck', () => this.checkSupport() );
		c.clock.after( BALANCE_TIME, 'balanceEnd', () => {

			c.balancing = false;
			if ( ! c.stunt ) c.setState( 'standing' );

		} );
		c.startStunt( 'perchLand', {
			rate: PERCH_RATE,
			onDone: () => c.setState( 'standing' )
		} );

	}

	// Crouched: charge, and jump, back flip or stand up.
	aim( input ) {

		const c = this.runner;

		for ( let charges = c.clock.every( 'precisionCharge', CHARGE_EVERY ); charges > 0; charges -- ) {

			if ( c.precisionCharge < 1 ) c.precisionCharge += CHARGE_STEP;

		}

		if ( input.held( 'flip' ) && this.standingBackflip() ) return;

		if ( input.held( 'jump' ) ) {

			this.jump();

		} else if ( ! input.held( 'precision' ) || c.stateTime >= AIM_TIME ) {

			this.standUp();

		}

	}

	standUp() {

		const c = this.runner;

		c.motion.moves.stop( undefined, STAND_UP_BLEND );
		this.camera( 'aimZoomOut' );
		c.setState( 'standing' );

	}

	jump() {

		const c = this.runner;
		const charge = Math.max( c.precisionCharge, MIN_CHARGE );

		this.camera( 'aimZoomOut' );
		c.startStunt( 'precisionJump', {
			air: true,
			launchDelay: LAUNCH_DELAY,
			onLaunch: () => {

				c.launch( FORWARD_SPEED * charge, c.tuning.values.precisionJumpSpeed );
				c.setState( 'precisionJump' );

			}
		} );

	}

	jumpOn() {

		const c = this.runner;

		this.endBalance();
		this.camera( 'styleJump', { scale: JUMP_ON_SHAKE } );
		c.startStunt( 'precisionJump', {
			air: true,
			launchDelay: LAUNCH_DELAY,
			onLaunch: () => {

				const target = this.probes.precisionTarget();
				const velocity = target && this.roomAt( target ) ? arcVelocity( c.position, target.point )?.multiplyScalar( ARC_BOOST ) : null;

				if ( velocity ) {

					c.velocity.copy( velocity );
					c.grounded = false;
					c.jumps ++;

				} else {

					c.launch( ...LEAP );

				}

				c.clock.release( 'precisionWindow' );
				c.setState( 'precisionJump' );

			}
		} );

	}

	stepOff() {

		const c = this.runner;

		this.endBalance();
		c.velocity.y = STEP_OFF_UP;
		c.grounded = false;
		c.startStunt( 'perchStepUp', {
			air: true,
			launchDelay: STEP_OFF_DELAY,
			onLaunch: () => {

				c.velocity.addScaledVector( c.forward(), STEP_OFF_FORWARD );
				c.jumps ++;
				c.clock.release( 'precisionWindow' );

			}
		} );

	}

	standingBackflip() {

		const c = this.runner;

		if ( c.queries.overlapCapsule( c.position, BACKFLIP_ROOM.radius, BACKFLIP_ROOM.halfHeight ) ) return false;

		const behind = c.position.clone().addScaledVector( UP, - BACKFLIP_SUPPORT.down ).addScaledVector( c.forward(), - BACKFLIP_SUPPORT.back );
		const rotation = new Quaternion().setFromAxisAngle( UP, c.yaw );
		const supported = c.queries.overlapBox( behind, BACKFLIP_SUPPORT.halfSize, rotation );
		const charge = c.precisionCharge;

		// Without a floor behind, the running back flip, timed to the arc it will fly.
		c.startStunt( supported ? 'standingBackflip' : 'runningBackflip', {
			air: true,
			launchDelay: supported ? STANDING_BACKFLIP_DELAY : RUNNING_BACKFLIP_DELAY,
			rate: supported ? 1 : c.tricks.animationRate( false, c.forward().multiplyScalar( - RUNNING_BACKFLIP_TIMED_BACK ).setY( BACKFLIP_UP ) ),
			onLaunch: () => {

				c.launch( BACKFLIP_BACK * charge, BACKFLIP_UP );
				c.backflipLanding = !! supported;
				c.clock.after( BACKFLIP_LANDING_TIME, 'backflipLandingEnd', () => {

					c.backflipLanding = false;

				} );

			}
		} );
		this.camera( 'aimZoomOut' );

		return true;

	}

	tryStride() {

		const c = this.runner;
		const edge = c.position.clone().addScaledVector( c.forward(), EDGE.ahead ).addScaledVector( UP, - EDGE.down );

		if ( c.queries.overlapCapsule( edge, EDGE.radius, EDGE.halfHeight ) ) return false;
		if ( c.queries.ray( c.position, c.forward(), STRIDE_CLEAR ) ) return false;

		const target = this.probes.precisionTarget( true );

		if ( ! target ) return false;

		const from = c.position.clone().addScaledVector( c.forward(), STRIDE_SWEEP.from );
		const rotation = new Quaternion().setFromAxisAngle( UP, c.yaw );

		if ( c.queries.boxCast( from, from.clone().addScaledVector( c.forward(), STRIDE_SWEEP.length ), STRIDE_SWEEP.halfSize, rotation ) ) return false;
		if ( ! this.roomAt( target ) ) return false;

		const next = this.nextStride();
		const name = next.left ? 'strideLeft' : 'strideRight';
		// How far into its take a stride from the take's start has got as it ends, landing: one picking up a step
		// further on plays the rest of the way there in the same time, so it lands as it reaches its target too.
		const reach = STRIDE_LENGTH * c.motion.takes.moves.get( name ).rate;

		this.strideLeft = next.left;
		c.startStunt( name, {
			target: target.point.clone().addScaledVector( UP, STAND_HEIGHT ),
			placeTime: STRIDE_TIME,
			length: STRIDE_LENGTH,
			rate: ( reach - next.from ) / reach,
			ghost: true,
			onDone: () => {

				// The stride lands on its target. Going on (the stick held), its take runs on at its own speed, its root
				// carrying the runner along the top; let go, it skids to a stop, or stands. In first person, where no move
				// carries the runner after one (as no skid does), it is the runner's own at once.
				const goingOn = c.input?.move.x || c.input?.move.y;
				c.grounded = true;
				c.velocity.set( 0, 0, 0 );
				c.motion.moves.retime( name, { rate: 1 } );
				if ( ! goingOn ) c.skidStops.strideCompleted();
				if ( ! goingOn || c.firstPerson ) c.motion.moves.stop( name );
				// Carried on by the take, the runner is on its feet and going: its own movement, which would say so, waits
				// for the take to end.
				else c.setState( c.input.held( 'sprint' ) ? 'sprinting' : 'walking' );

			}
		} );
		c.motion.moves.retime( name, { time: next.from } );

		return true;

	}

	// The next stride's side, and where in its take it starts. Straight after a stride whose take still runs on (the
	// last move played) it takes off from the foot that one has down, picking up that foot's step where it has got to;
	// else it starts at its take's start, off the other foot from the last stride's.
	nextStride() {

		const last = this.runner.motion.moves.instances.at( - 1 );

		if ( ! STRIDES.has( last?.move.name ) ) return { left: ! this.strideLeft, from: 0 };

		const left = last.move.name === 'strideLeft';

		return last.time < STRIDE_HAND_OVER.until ?
			{ left: ! left, from: Math.max( 0, last.time - STRIDE_HAND_OVER.other ) } :
			{ left, from: Math.max( 0, last.time - STRIDE_HAND_OVER.same ) };

	}

	// Room for the body just short of a target.
	roomAt( target ) {

		const c = this.runner;
		const at = target.point.clone().addScaledVector( c.forward(), - TARGET_ROOM.back );

		return ! c.queries.overlapCapsule( at, TARGET_ROOM.radius, TARGET_ROOM.halfHeight );

	}

	frontBlocked() {

		const c = this.runner;

		return !! c.queries.ray( c.position, c.forward(), FRONT_CLEAR );

	}

	// Both feet of the perch need a floor under them, else it slips off.
	checkSupport() {

		const c = this.runner;

		for ( const foot of PERCH_FEET ) {

			const point = c.position.clone().addScaledVector( c.right(), foot.out ).addScaledVector( UP, - foot.down ).addScaledVector( c.forward(), foot.ahead + FOOT_REACH );

			if ( c.queries.overlapCapsule( point, FOOT_FLOOR.radius, FOOT_FLOOR.halfHeight ) ) continue;

			this.endBalance();
			c.startStunt( 'perchSlip', { air: true } );
			c.grounded = false;

			return;

		}

	}

	// Off the perch before the balance is over: its end is called off.
	endBalance() {

		this.runner.balancing = false;
		this.runner.clock.cancel( 'balanceEnd' );

	}

	camera( name, options = {} ) {

		this.runner.events.push( { type: 'camera', name, ...options } );

	}

}

export { arcVelocity, Precision, STRIDE_HAND_OVER };
