import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { horizontalVelocity } from './velocity.js';
import { DEG, clamp, radians, approach, wrapAngle } from '../math.js';
import { GRAVITY, TERMINAL_FALL_SPEED } from '../sim/tuning.js';

const UP = new Vector3( 0, 1, 0 );
const DOWN = new Vector3( 0, - 1, 0 );

// The floor under the feet is found by a ray from just above them: the feet are this far below the body's centre
// standing, and sliding (m), a little ahead of it (m); the ray starts PROBE_ABOVE_FEET above them and reaches
// PROBE_REACH down (m).
const FEET_DROP = - 0.92;
const FEET_DROP_SLIDING = - 0.32;
const FEET_AHEAD = 0.022;
const PROBE_ABOVE_FEET = 0.05;
const PROBE_REACH = 0.6;

// A slide needs this much speed forward (m/s), and no wall within ROOM_AHEAD (m, swept with a ROOM_RADIUS sphere) or
// low obstacle within LOW_AHEAD ahead (m, at LOW_HEIGHT below the centre).
const MIN_SPEED = 4;
const ROOM_AHEAD = 0.8;
const ROOM_RADIUS = 0.2;
const LOW_HEIGHT = - 0.75;
const LOW_AHEAD = 1;
// A slide starts with a kick along the velocity: ENTRY_BOOST m/s per m/s of speed, at most ENTRY_BOOST_MAX (m/s).
const ENTRY_BOOST = 1.5;
const ENTRY_BOOST_MAX = 6.5;
// A slide drops the capsule's centre this far (m) and lowers it to this half height (m).
const DROP = 0.6;
const HALF_HEIGHT = 0.3;
// After a slide another waits this long (s); a cartwheel may follow it this long after it ends (s).
const COOLDOWN = 1.8;
const CARTWHEEL_AFTER = 0.15;
// A slide leaves this braking (m/s²) on the ground until the stick moves.
const END_BRAKING = 10;
// The slide steers at STEER_RATE (rad/s at a full steer) and pushes sideways as it turns: the steer times STEER_PUSH
// times the step's time is the share of the tuning's acceleration it pushes with, at most all of it (1.5 at 120 steps a
// second, so a steer of two thirds or more pushes fully). The flip held spins it on the spot at SPIN_RATE (rad/s).
const STEER_RATE = radians( 80 );
const STEER_PUSH = 180;
const SPIN_RATE = radians( 350 );
// Wheel held on a floor steeper than this (rad) sits the slide upright.
const UPRIGHT_SLOPE = radians( 5 );
// The slide's tilt follows the floor at this rate (per second).
const TILT_RATE = 11.5;
// Below this speed (m/s) a slope pushes the slide down it, by SLOPE_PUSH (0.85 m/s² for each degree of slope, per
// radian here as the slope is measured), and turns its heading toward downhill at DOWNHILL_TURN_RATE (per second). A
// floor within FLAT of level is no slope: the slide keeps its heading on it.
const SLOPE_PUSH_MAX_SPEED = 11.5;
const SLOPE_PUSH = 0.85 / DEG;
const DOWNHILL_TURN_RATE = 1.85;
const FLAT = radians( 1 );
// A slide ends at or below this speed (m/s) on a floor no steeper than END_SLOPE (rad).
const END_SPEED = 5.9;
const END_SLOPE = radians( 20 );
// A jump out of a slide rises at this speed (m/s), the whole launch held to at most this speed (m/s).
const JUMP_UP = 4.5;
const JUMP_MAX_SPEED = 8.5;

/**
 * The floor under the runner's feet: how steep it is (rad, whichever way the runner faces; 0 when there is no floor),
 * its normal and the ray's hit.
 */
function floorSlope( runner ) {

	const sliding = runner.state === 'sliding';
	const origin = runner.position.clone().addScaledVector( runner.forward(), FEET_AHEAD ).addScaledVector( UP, ( sliding ? FEET_DROP_SLIDING : FEET_DROP ) + PROBE_ABOVE_FEET );
	const hit = runner.queries.ray( origin, DOWN, PROBE_REACH );
	const normal = hit?.faceNormal || hit?.normal;

	if ( ! normal ) return { angle: 0, normal: UP.clone(), hit: null };

	return { angle: Math.acos( clamp( normal.y, - 1, 1 ) ), normal, hit };

}

/**
 * The ground slide: low and fast, steered by the stick, pushed down slopes, tilted to the floor (the capsule turns with
 * it, `rotation`, and the figure leans by `tilt`). It ends when it runs slow on a gentle floor, leaves the floor, or
 * jumps.
 */
class Slides {

	constructor( runner ) {

		this.runner = runner;
		this.reset();

	}

	reset() {

		// The slide's tilt to the floor under it, and the capsule's rotation with it.
		this.tilt = { pitch: 0, roll: 0 };
		this.rotation = new Quaternion();
		// Tucked (grab or flip held: no steering) and upright (wheel held on a slope): the pose reads them.
		this.tucked = this.upright = false;

	}

	/** Slide held at speed on the ground, with room ahead: a slide. */
	tryBegin( input ) {

		const c = this.runner;

		if ( ! c.grounded || ! input.held( 'slide' ) || c.stunt || c.motion.moves.busy() || c.diving || c.velocity.dot( c.forward() ) <= MIN_SPEED || c.clock.held( 'slideCooldown' ) ) return false;
		if ( c.queries.sphereCast( c.position, c.position.clone().addScaledVector( c.forward(), ROOM_AHEAD ), ROOM_RADIUS ) ) return false;

		return this.begin();

	}

	/** Starts a slide (also from a landing on a slope or with slide held). */
	begin() {

		const c = this.runner;

		if ( c.clock.held( 'slideCooldown' ) || c.state === 'sliding' || c.state === 'bailing' || c.bail.pending ) return false;
		if ( c.queries.ray( c.position.clone().addScaledVector( UP, LOW_HEIGHT ), c.forward(), LOW_AHEAD ) ) return false;

		// The capsule drops to slide, the body staying where it is: the place the runner is drawn from moves with it, so
		// the figure (drawn between the last two steps) does not pop up by the drop for a frame.
		c.position.y -= DROP;
		c.previousPosition.y -= DROP;
		c.velocity.addScaledVector( c.velocity.clone().normalize(), Math.min( c.velocity.length() * ENTRY_BOOST, ENTRY_BOOST_MAX ) );

		c.stunt = null;
		c.landHard = false;
		c.clock.hold( 'cartwheelCooldown', Infinity );
		c.capsule.lower( HALF_HEIGHT );
		c.clock.cancel( 'airComboOpen' );
		c.setState( 'sliding' );
		c.clock.hold( 'slideCooldown', COOLDOWN );
		c.events.push( { type: 'camera', name: 'recenterView' } );

		return true;

	}

	// Ends a slide (nothing to end when the runner is not sliding: the capsule stands back up only from one).
	end() {

		const c = this.runner;

		if ( c.state !== 'sliding' ) return false;

		c.position.y += DROP;
		c.previousPosition.y += DROP;
		this.tucked = this.upright = false;
		c.capsule.stand();
		this.tilt.pitch = this.tilt.roll = 0;
		this.rotation.identity();
		c.slideBraking = END_BRAKING;
		c.clock.hold( 'cartwheelCooldown', CARTWHEEL_AFTER );
		c.setState( c.grounded ? 'standing' : 'falling' );

		return true;

	}

	update( dt, input ) {

		const c = this.runner;
		const p = c.tuning.values;
		const floor = floorSlope( c );

		this.tucked = input.held( 'grab' ) || input.held( 'flip' );
		if ( input.held( 'wheel' ) && floor.angle > UPRIGHT_SLOPE ) this.upright = true;
		if ( input.released( 'wheel' ) ) this.upright = false;
		const acceleration = this.steer( dt, input );

		if ( c.velocity.length() <= END_SPEED && floor.angle <= END_SLOPE ) {

			this.end();

			return;

		}

		this.updateTilt( dt, c.mover.floor?.faceNormal || c.mover.floor?.normal || floor.normal );

		if ( c.velocity.length() < SLOPE_PUSH_MAX_SPEED ) {

			const downhill = new Vector3().crossVectors( floor.normal, new Vector3().crossVectors( floor.normal, UP ) ).normalize();

			c.velocity.addScaledVector( downhill, SLOPE_PUSH * floor.angle * dt );

			if ( ! c.firstPerson && ! this.tucked && floor.angle > FLAT ) {

				const difference = wrapAngle( Math.atan2( downhill.x, downhill.z ) - c.yaw );

				c.yaw += difference * Math.min( 1, dt * DOWNHILL_TURN_RATE );

			}

		}

		const horizontal = horizontalVelocity( c.velocity, acceleration, c.topSpeed, p.slideFriction, p.slideBraking, dt );

		c.velocity.x = horizontal.x;
		c.velocity.z = horizontal.z;
		const oldVertical = c.velocity.y;

		if ( ! c.grounded ) c.velocity.y = Math.max( TERMINAL_FALL_SPEED, c.velocity.y - GRAVITY * p.gravityScale * dt );
		const delta = c.velocity.clone().multiplyScalar( dt );

		// In the air the step covers the average of the vertical speeds at its two ends.
		if ( ! c.grounded ) delta.y = ( oldVertical + c.velocity.y ) * 0.5 * dt;
		this.rotation.setFromEuler( new Euler( this.tilt.pitch, c.yaw, this.tilt.roll, 'YXZ' ) );
		const hit = c.mover.walk( c.position, c.velocity, dt, p, c.grounded, HALF_HEIGHT, delta, this.rotation );
		const leftFloor = c.grounded && ! hit.grounded;

		c.grounded = hit.grounded;

		if ( leftFloor ) {

			this.end();
			c.walkOff();

			return;

		}

		if ( input.released( 'jump' ) ) {

			this.end();
			const launch = c.velocity.clone().setY( JUMP_UP ).clampLength( 0, JUMP_MAX_SPEED );

			c.velocity.copy( launch ).setY( JUMP_UP );
			c.grounded = false;
			c.jumps ++;
			c.plainJump = false;
			c.openAirComboSoon();
			c.setState( 'rising' );

		}

	}

	// Turns the slide and returns the sideways acceleration that goes with the turn. Tucked, only the flip's spin turns
	// it.
	steer( dt, input ) {

		const c = this.runner;
		const turning = input.value( 'slideSteer' );
		const acceleration = new Vector3();

		if ( ! this.tucked ) {

			c.yaw -= turning * STEER_RATE * dt;
			acceleration.addScaledVector( c.right(), turning * STEER_PUSH * dt );

		}

		if ( ! c.firstPerson && input.held( 'flip' ) && ! input.held( 'wheel' ) ) c.yaw -= turning * SPIN_RATE * dt;

		return acceleration.clampLength( 0, 1 ).multiplyScalar( c.tuning.values.acceleration );

	}

	// Tilts the slide toward the floor's own pitch and roll along the heading.
	updateTilt( dt, normal ) {

		const c = this.runner;
		const forward = c.forward().addScaledVector( normal, - c.forward().dot( normal ) ).normalize();
		const right = new Vector3().crossVectors( normal, forward ).normalize();
		const target = new Euler().setFromRotationMatrix( new Matrix4().makeBasis( right, normal, forward ), 'YXZ' );

		this.tilt.pitch = approach( this.tilt.pitch, target.x, TILT_RATE, dt );
		this.tilt.roll = approach( this.tilt.roll, target.z, TILT_RATE, dt );
		this.rotation.setFromEuler( new Euler( this.tilt.pitch, c.yaw, this.tilt.roll, 'YXZ' ) );

	}

}

export { floorSlope, Slides };
