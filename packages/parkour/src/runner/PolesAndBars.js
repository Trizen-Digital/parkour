import { Vector3, Quaternion, Euler } from 'three';
import { clamp, radians, wrapAngle } from '../math.js';
import { CAPSULE, GRAVITY } from '../sim/tuning.js';

const UP = new Vector3( 0, 1, 0 );
const DOWN = new Vector3( 0, - 1, 0 );

// Held to something already: no swing starts.
const HELD = new Set( [ 'wallRunning', 'onBar', 'onRope', 'hanging', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'onPole' ] );

// A pole is caught in a box this far either side of it (m), from this far above its foot (m) to its top, once the
// runner has been in the box for DETECT_EVERY (s; it looks again on that beat while the runner stays).
const POLE_REACH = 0.54;
const POLE_CATCH_FROM = 3.5;
const DETECT_EVERY = 0.05;
// The grab carries the body this far behind and below the point caught (m) over POLE_GRAB_TIME (s).
const POLE_GRAB_BACK = 0.3;
const POLE_GRAB_DOWN = 1.25;
const POLE_GRAB_TIME = 0.2;
// On the pole the body hangs this far off it (m), slides down at SLIDE_SPEED (m/s) and turns round it at TURN_SPEED
// (m/s at a full push); a floor within FLOOR_REACH below (m) ends the slide.
const POLE_DISTANCE = 0.285;
const SLIDE_SPEED = 8;
const TURN_SPEED = 1.5;
const FLOOR_REACH = 1.35;
// Letting go: the next pole waits POLE_LOCK (s); the body drops pushing back at LET_GO_BACK (m/s), or in first person
// leaves forward and up (m/s); a kick off (jump released) leaves toward the steer, steers like it for FROM_POLE_TIME
// (s) and passes through solids for KICK_GHOST (s).
const POLE_LOCK = 0.35;
const LET_GO_BACK = - 1.5;
const LEAVE_FORWARD = 6.5;
const LEAVE_UP = 2.5;
const FROM_POLE_TIME = 0.2;
const KICK_GHOST = 0.1;

// A swing bar is caught falling no faster than this (m/s); the body hangs this far below the bar's top and off it (m).
const BAR_MAX_FALL = 15.5;
const HANG_BELOW_BAR = 0.9;
const HANG_OFF_BAR = 0.185;
// The swing: it settles on the bar over BAR_SETTLE (s), holds for BAR_HOLD (s; its steps summed to within
// BAR_HOLD_SLACK count as all of it), then launches forward and up (m/s), turning BAR_STEER toward a steer at least
// BAR_STEER_MIN away, through solids for BAR_GHOST (s); it lets go after BAR_FLIGHT (s) of flight.
const BAR_SETTLE = 0.15;
const BAR_HOLD = 0.38;
const BAR_HOLD_SLACK = 1e-8;
const BAR_LAUNCH_FORWARD = 5.85;
const BAR_LAUNCH_UP = 4.25;
const BAR_STEER = radians( 10 );
const BAR_STEER_MIN = radians( 25 );
const BAR_GHOST = 0.2;
const BAR_FLIGHT = 0.2;
// A bar is swung on only when met within this angle of head-on.
const BAR_MAX_ANGLE = radians( 50 );
// The bar is looked for with spheres swept ahead (from `from` to `reach`, m), stepped up the body from the waist: step
// `first` to `last`, `step` apart above `base` (m about the body's centre).
const BAR_SCAN = { first: 2, last: 12, step: 0.12, base: - 0.26, from: 0.1, reach: 1.25, radius: 0.1 };
// A bar stands free: nothing in a sphere this far behind the point met (m).
const BAR_BEHIND = { depth: 0.55, radius: 0.2 };
// Its top: a sphere dropped from this far above the point met (m).
const BAR_TOP = { above: 0.2, radius: 0.1 };
// Room to swing past it (a capsule this far ahead of the top, m) and under it (one this far below the top).
const BAR_PAST = { ahead: 0.55, radius: 0.1, halfHeight: 0.55 };
const BAR_UNDER = { down: 1, radius: 0.2, halfHeight: 0.75 };
// Both hands on it: each a small sphere this far along the bar from the middle (m) must touch it.
const BAR_HANDS = { along: 0.25, radius: 0.05 };
// A bar found without its own solid (caught by a post) is held as a line this far either side of where it was found,
// this thick (m; the hands' grip, for the pose alone).
const BAR_LINE = { half: 0.6, radius: 0.03 };

// A rope is caught with grab held in the air: the hands (ROPE_HANDS above the body's centre, m) within ROPE_REACH of
// it, at least ROPE_TOP_ROOM below its anchor and no more than ROPE_PAST_END below its end, falling no faster than
// ROPE_MAX_FALL (m/s).
const ROPE_HANDS = 1.14;
const ROPE_REACH = 0.6;
const ROPE_TOP_ROOM = 0.5;
const ROPE_PAST_END = 0.25;
const ROPE_MAX_FALL = 12;
// The body swings from the anchor as a pendulum, as far out as it was caught, keeping ROPE_CATCH_KEEP of its speed
// across the rope. It swings under ROPE_GRAVITY of the runner's gravity (near plain gravity), so a rope carries the
// runner well out. The stick pushes it ROPE_PUSH (m/s²) the way it points, relative to the view, so the runner pumps
// it back and forth or steers it round a corner, and it loses ROPE_DRAG of its speed a second.
const ROPE_CATCH_KEEP = 0.95;
const ROPE_GRAVITY = 0.6;
const ROPE_PUSH = 1.5;
const ROPE_DRAG = 0.04;
// The body turns to face the way it swings at ROPE_TURN_RATE (1/s) while it swings faster than ROPE_TURN_SPEED
// (m/s) across the ground, keeping its facing as it swings back; the pose throws the legs fully forward or back at
// ROPE_POSE_SPEED (m/s) along the heading.
const ROPE_TURN_RATE = 5;
const ROPE_TURN_SPEED = 0.5;
const ROPE_POSE_SPEED = 3;
// Jump released lets go with a kick: the swing's velocity, ROPE_JUMP_UP (m/s) more up and ROPE_JUMP_FORWARD more
// along the heading. Grab released or dive drops off as it swings; so does meeting a solid, or swinging up past level
// with the anchor (the rope goes slack: its end higher than ROPE_SLACK of its length below the anchor). The next rope
// waits ROPE_LOCK (s), or the ground.
const ROPE_JUMP_UP = 3;
const ROPE_JUMP_FORWARD = 1.5;
const ROPE_SLACK = 0.05;
const ROPE_LOCK = 0.4;
// Whatever move was playing blends out over this long (s) as the rope is caught.
const ROPE_MOVES_BLEND = 0.15;

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
 * Poles, bars and ropes: catching a vertical pole (grab held in its box), sliding down and turning round it, letting
 * go or kicking off; swinging on a bar met in the air (caught, held a moment, launched forward); and swinging on a
 * hanging rope caught in the air, from any direction, pumped and steered with the stick, until it is let go. `update()`
 * runs the onPole, onBar and onRope states; the runner's step tries `tryAttach()` with grab held.
 */
class PolesAndBars {

	constructor( runner ) {

		this.runner = runner;

		// Each pole's catch box, the name of its look's beat on the clock, and the point on the pole level with the runner
		// once found.
		this.poles = ( runner.world.poles || [] ).map( ( pole, index ) => ( {
			start: pole.bottom.clone(),
			end: pole.top.clone(),
			radius: pole.radius,
			beat: 'poleDetect:' + index,
			detection: null
		} ) );

		this.ropes = runner.world.ropes ?? [];
		// The rope's lean and swing for the pose: the tilt that hangs the body along the rope, and which way it swings
		// (-1 back to 1 forward).
		this.ropeTilt = { pitch: 0, roll: 0 };

		this.reset();

	}

	reset() {

		// The pole, bar or rope held: { kind: 'pole', pole, from, target, elapsed, phase }, { kind: 'bar', from, target,
		// fromYaw, yaw, elapsed, phase, alignedAt, launchedAt } or { kind: 'rope', rope, radius, elapsed }; null when
		// free.
		this.attachment = null;
		this.ropeTilt.pitch = this.ropeTilt.roll = 0;
		this.ropeSwing = 0;
		// Jump held on a pole: the kick off it is charging (the pose shows it).
		this.kicking = false;
		// A kick off a pole steers like one for a moment (fromPoleClear ends it).
		this.runner.fromPole = false;
		// The next pole waits a moment after letting go of one (poleLock).
		this.runner.clock.cancel( 'poleLock', 'fromPoleClear', 'ropeLock' );

		for ( const pole of this.poles ) {

			this.runner.clock.cancel( pole.beat );
			pole.detection = null;

		}

	}

	everyStep() {

		this.detectPoles();

		// On the ground the next rope need not wait.
		if ( this.runner.grounded ) this.runner.clock.release( 'ropeLock' );

	}

	update( dt, input, viewYaw ) {

		this.detectPoles();

		const a = this.attachment;

		if ( ! a ) return;

		a.elapsed += dt;

		if ( a.kind === 'pole' ) {

			this.updatePole( dt, input, viewYaw );

		} else if ( a.kind === 'rope' ) {

			this.updateRope( dt, input, viewYaw );

		} else {

			this.updateBar( dt, input, viewYaw );

		}

	}

	/**
	 * Grab held in the air: a pole caught in its box, a rope in reach, else a bar ahead to swing on. True if one is
	 * caught.
	 */
	tryAttach( input ) {

		const c = this.runner;

		this.detectPoles();
		if ( ! input.held( 'grab' ) || c.grounded || c.tricking || c.state === 'airStunt' ) return false;

		const pole = ! c.clock.held( 'poleLock' ) && this.poles.find( ( volume ) => volume.detection );

		if ( pole ) {

			this.attachPole( pole, input );

			return true;

		}

		const rope = ! c.clock.held( 'ropeLock' ) && this.findRope();

		if ( rope ) {

			this.attachRope( rope );

			return true;

		}

		if ( input.held( 'jump', 'pad' ) || HELD.has( c.state ) ) return false;

		const bar = this.findBar();

		return bar ? this.attachBar( bar, input ) : false;

	}

	// ---- Poles

	// The runner is found in a pole's catch box DETECT_EVERY after it enters it (counting the step it enters in), then on
	// that beat while it stays; the point caught is on the pole as far up it as the runner is from its foot.
	detectPoles() {

		const c = this.runner;

		for ( const pole of this.poles ) {

			const halfHeight = c.capsule.halfHeight;
			const radius = CAPSULE.radius;
			const boxBottom = pole.start.y + POLE_CATCH_FROM;
			const segmentHalf = Math.max( 0, halfHeight - radius );
			const dx = Math.max( 0, Math.abs( c.position.x - pole.start.x ) - POLE_REACH );
			const dz = Math.max( 0, Math.abs( c.position.z - pole.start.z ) - POLE_REACH );
			const dy = Math.max( 0, boxBottom - ( c.position.y + segmentHalf ), c.position.y - segmentHalf - pole.end.y );
			const inside = dx * dx + dy * dy + dz * dz <= radius * radius;

			if ( ! inside ) {

				c.clock.cancel( pole.beat );
				pole.detection = null;
				continue;

			}

			if ( ! c.clock.every( pole.beat, DETECT_EVERY ) ) continue;

			pole.detection = pole.start.clone().addScaledVector( pole.end.clone().sub( pole.start ).normalize(), c.position.distanceTo( pole.start ) );

		}

	}

	attachPole( pole, input ) {

		const c = this.runner;

		this.attachment = {
			kind: 'pole',
			pole,
			from: c.position.clone(),
			target: pole.detection.clone().addScaledVector( c.forward(), - POLE_GRAB_BACK ).addScaledVector( UP, - POLE_GRAB_DOWN ),
			elapsed: 0,
			phase: 'placing'
		};
		c.stunt = null;
		c.grounded = false;
		c.velocity.set( 0, 0, 0 );
		c.airComboOpen = true;
		c.setState( 'onPole' );
		this.kicking = input.held( 'jump' );
		c.viewOnHead = true;
		this.camera( 'viewOnHead' );

	}

	// On the pole: jump released kicks off, grab released lets go; else it settles, then slides down and round.
	updatePole( dt, input, viewYaw ) {

		const c = this.runner;
		const a = this.attachment;

		if ( input.released( 'jump' ) ) return this.letGo( input, true, viewYaw );
		if ( input.released( 'grab' ) ) return this.letGo( input );

		this.kicking = input.held( 'jump' );

		if ( a.phase === 'placing' ) {

			c.position.copy( a.from ).lerp( a.target, clamp( a.elapsed / POLE_GRAB_TIME, 0, 1 ) );

			if ( a.elapsed >= POLE_GRAB_TIME ) {

				a.phase = 'riding';
				this.camera( 'recenterView' );
				this.camera( 'landing', { epicenter: c.position.clone() } );
				c.velocity.set( 0, 0, 0 );

			}

			return;

		}

		if ( c.queries.ray( c.position, DOWN, FLOOR_REACH, 'probe' ) ) return this.letGo( input );

		const polePoint = a.pole.detection || a.pole.start;
		const away = c.position.clone().sub( polePoint ).setY( 0 ).normalize();

		if ( away.lengthSq() === 0 ) away.copy( c.forward() ).negate();

		const tangent = right( yawOf( away ) );
		const turn = clamp( Number( input.value( 'poleTurn' ) ), - 1, 1 );
		const y = c.position.y - SLIDE_SPEED * dt;

		c.position.copy( polePoint ).addScaledVector( away, POLE_DISTANCE ).addScaledVector( tangent, turn * TURN_SPEED * dt ).setY( y );
		c.yaw = yawOf( away.clone().negate() );

	}

	/** Lets go of the pole: dropping off it, or (kick) leaving toward the steer. */
	letGo( input, kick = false, viewYaw = this.runner.yaw ) {

		const c = this.runner;

		c.clock.hold( 'poleLock', POLE_LOCK );
		this.attachment = null;
		this.kicking = false;
		c.viewOnHead = !! input.preferences?.values.headCamera;
		this.camera( 'viewFree' );
		this.camera( 'speedZoomOut' );
		this.camera( 'landing', { epicenter: c.position.clone() } );
		c.velocity.copy( c.forward() ).multiplyScalar( LET_GO_BACK );
		c.velocity.y = 0;
		c.grounded = false;
		c.landHard = true;

		if ( c.firstPerson ) {

			c.velocity.copy( c.forward() ).multiplyScalar( LEAVE_FORWARD );
			c.velocity.y = LEAVE_UP;
			this.camera( 'faceView', { yaw: c.yaw, pitch: 0 } );

		}

		if ( kick ) {

			const yaw = c.firstPerson ? c.yaw : this.steerYaw( input, viewYaw );

			c.velocity.copy( forward( yaw ) ).multiplyScalar( LEAVE_FORWARD );
			c.velocity.y = LEAVE_UP;
			c.fromPole = true;
			c.clock.after( FROM_POLE_TIME, 'fromPoleClear', () => {

				c.fromPole = false;

			} );
			c.clock.hold( 'noCollision', KICK_GHOST );
			c.motion.moves.play( 'poleKick' );

		}

		c.setState( 'falling' );

	}

	// ---- Bars

	isBar( hit ) {

		// A bar or one of its posts is a bar to swing on.
		return hit && ( hit.solid.tags.includes( 'bar' ) || hit.solid.tags.includes( 'barPost' ) );

	}

	// A bar ahead within reach, from the waist up (spheres stepped up the body): met nearly head-on, its top found, with
	// room to swing past it and under it, and both hands on it. The bar's top and its facing, or null.
	findBar() {

		const c = this.runner;
		const sphereCast = ( a, b, radius ) => c.queries.sphereCast( a, b, radius, { group: 'probe' } );
		const overlapSphere = ( at, radius ) => c.queries.overlapSphere( at, radius, { group: 'probe' } );
		const direction = c.forward();

		for ( let index = BAR_SCAN.first; index <= BAR_SCAN.last; index ++ ) {

			const origin = c.position.clone().addScaledVector( UP, index * BAR_SCAN.step + BAR_SCAN.base );
			const hit = sphereCast( origin.clone().addScaledVector( direction, BAR_SCAN.from ), origin.clone().addScaledVector( direction, BAR_SCAN.reach ), BAR_SCAN.radius );

			if ( ! hit ) continue;

			const behind = hit.point.clone().addScaledVector( hit.normal, - BAR_BEHIND.depth );

			if ( overlapSphere( behind, BAR_BEHIND.radius ) || ! this.isBar( hit ) ) return null;

			const top = sphereCast( hit.point.clone().addScaledVector( UP, BAR_TOP.above ), hit.point, BAR_TOP.radius );

			if ( ! top || top.startedInside ) return null;

			const facing = hit.normal.clone().negate();

			if ( Math.acos( clamp( facing.dot( direction ), - 1, 1 ) ) >= BAR_MAX_ANGLE ) return null;

			const past = top.point.clone().addScaledVector( direction, BAR_PAST.ahead );

			if ( c.queries.overlapCapsule( past, BAR_PAST.radius, BAR_PAST.halfHeight, { group: 'probe' } ) ) return null;

			const under = top.point.clone().addScaledVector( UP, - BAR_UNDER.down );

			if ( c.queries.overlapCapsule( under, BAR_UNDER.radius, BAR_UNDER.halfHeight, { group: 'probe' } ) ) return null;

			const along = right( yawOf( hit.normal ) );

			for ( const side of [ - 1, 1 ] ) {

				const hand = top.point.clone().addScaledVector( along, side * BAR_HANDS.along );

				if ( ! overlapSphere( hand, BAR_HANDS.radius ) ) return null;

			}

			return { location: top.point.clone(), normal: hit.normal.clone(), solid: [ top.solid, hit.solid ].find( ( solid ) => solid?.tags.includes( 'bar' ) ) ?? null };

		}

		return null;

	}

	// Catches the bar, true; or, too fast or mid-trick, the bar knocks the runner limp (a bail, asked of the bail
	// system as any other), false.
	attachBar( bar, input ) {

		const c = this.runner;

		if ( Math.abs( c.velocity.y ) > BAR_MAX_FALL || c.tricking ) {

			c.bail.request();

			return false;

		}

		const yaw = yawOf( bar.normal.clone().negate() );

		this.attachment = {
			kind: 'bar',
			from: c.position.clone(),
			target: bar.location.clone().addScaledVector( UP, - HANG_BELOW_BAR ).addScaledVector( bar.normal, HANG_OFF_BAR ),
			elapsed: 0,
			phase: 'placing',
			fromYaw: c.yaw,
			yaw,
			// The bar's line and thickness, for the hands.
			line: barLine( bar )
		};
		c.stunt = null;
		c.grounded = false;
		c.velocity.set( 0, 0, 0 );
		c.airComboOpen = false;
		c.kickedOffWall = false;
		c.fromWallRun = false;
		c.setState( 'onBar' );

		if ( ! c.firstPerson ) {

			this.camera( 'barSwing', { orientation: new Quaternion().setFromEuler( new Euler( 0, c.yaw + Math.PI, 0 ) ) } );

		} else {

			this.camera( 'faceView', { yaw } );

		}

		c.motion.moves.play( 'barSwing' );

		return true;

	}

	// The swing: settle on the bar, hold, launch (toward the steer a little), fly a moment, then fall free.
	updateBar( dt, input, viewYaw ) {

		const c = this.runner;
		const a = this.attachment;

		if ( a.phase === 'placing' ) {

			const t = clamp( a.elapsed / BAR_SETTLE, 0, 1 );

			c.position.copy( a.from ).lerp( a.target, t );
			c.yaw = a.fromYaw + wrapAngle( a.yaw - a.fromYaw ) * t;

			if ( t === 1 ) {

				a.phase = 'holding';
				a.alignedAt = a.elapsed;
				c.velocity.set( 0, 0, 0 );

			}

			return;

		}

		if ( a.phase === 'holding' && a.elapsed - a.alignedAt + BAR_HOLD_SLACK >= BAR_HOLD ) {

			const desired = this.steerYaw( input, viewYaw );
			let yaw = c.yaw;

			if ( Math.abs( wrapAngle( desired - c.yaw ) ) >= BAR_STEER_MIN ) yaw += BAR_STEER * Math.sign( right( desired ).dot( c.forward() ) );

			c.velocity.copy( forward( yaw ) ).multiplyScalar( BAR_LAUNCH_FORWARD );
			c.velocity.y = BAR_LAUNCH_UP;
			c.airComboOpen = true;
			a.phase = 'launched';
			a.launchedAt = a.alignedAt + BAR_HOLD;
			c.clock.hold( 'noCollision', BAR_GHOST );

		}

		if ( a.phase === 'launched' ) {

			const gravity = GRAVITY * c.tuning.values.gravityScale;
			const airTime = Math.min( dt, Math.max( 0, a.elapsed - a.launchedAt ) );

			c.position.addScaledVector( c.velocity, airTime ).addScaledVector( UP, - 0.5 * gravity * airTime * airTime );
			c.velocity.y -= gravity * airTime;

			if ( a.elapsed - a.launchedAt >= BAR_FLIGHT ) {

				this.attachment = null;
				c.setState( 'falling' );

			}

		}

	}

	// ---- Ropes

	// The rope whose grabbable length is nearest the hands, within reach; or null.
	findRope() {

		const c = this.runner;

		if ( c.velocity.y < - ROPE_MAX_FALL ) return null;

		const hands = c.position.clone().addScaledVector( UP, ROPE_HANDS );
		let best = null;

		for ( const rope of this.ropes ) {

			const down = rope.end.clone().sub( rope.anchor ).divideScalar( rope.length );
			const along = clamp( hands.clone().sub( rope.anchor ).dot( down ), ROPE_TOP_ROOM, rope.length + ROPE_PAST_END );
			const distance = hands.distanceTo( rope.anchor.clone().addScaledVector( down, along ) );

			if ( distance <= ROPE_REACH && ( ! best || distance < best.distance ) ) best = { rope, distance };

		}

		return best?.rope ?? null;

	}

	// Takes the rope where the body is: it swings from the anchor at the distance it was caught, with the speed it had
	// across the rope.
	attachRope( rope ) {

		const c = this.runner;
		const radius = c.position.distanceTo( rope.anchor );
		const out = c.position.clone().sub( rope.anchor ).divideScalar( radius );

		c.velocity.addScaledVector( out, - c.velocity.dot( out ) ).multiplyScalar( ROPE_CATCH_KEEP );
		this.attachment = { kind: 'rope', rope, radius, elapsed: 0 };
		c.stunt = null;
		c.grounded = false;
		c.jumps = 0;
		c.airComboOpen = false;
		c.kickedOffWall = false;
		c.fromWallRun = false;
		c.clock.hold( 'ropeLock', Infinity );
		c.motion.moves.stop( undefined, ROPE_MOVES_BLEND );
		c.setState( 'onRope' );
		this.leanOnRope();
		this.camera( 'landing', { epicenter: c.position.clone() } );

	}

	// On the rope: jump released leaps off, grab released or dive drops off; else the body swings, pushed by the stick.
	updateRope( dt, input, viewYaw ) {

		const c = this.runner;
		const a = this.attachment;

		if ( input.released( 'jump' ) ) return this.leaveRope( true );
		if ( input.released( 'grab' ) || input.pressed( 'dive' ) ) return this.leaveRope();

		const anchor = a.rope.anchor;
		const out = c.position.clone().sub( anchor ).divideScalar( a.radius );
		const steer = forward( viewYaw ).multiplyScalar( input.move.y ).addScaledVector( right( viewYaw ), input.move.x );

		if ( steer.lengthSq() > 0 ) steer.setLength( ROPE_PUSH * Math.min( 1, input.moveAmount ) );

		// Gravity and the push across the rope; the speed along it is the rope's to take.
		const acceleration = steer.setY( - GRAVITY * c.tuning.values.gravityScale * ROPE_GRAVITY );
		const velocity = c.velocity;

		acceleration.addScaledVector( out, - acceleration.dot( out ) );
		velocity.addScaledVector( acceleration, dt );
		velocity.addScaledVector( out, - velocity.dot( out ) ).multiplyScalar( 1 - ROPE_DRAG * dt );

		const next = c.position.clone().addScaledVector( velocity, dt ).sub( anchor ).setLength( a.radius ).add( anchor );
		const nextOut = next.clone().sub( anchor ).divideScalar( a.radius );

		if ( nextOut.y > - ROPE_SLACK ) return this.leaveRope();
		if ( c.queries.capsuleCast( c.position, next, CAPSULE.radius, c.capsule.halfHeight, { group: 'movement', stopAtPenetration: false } ) ) return this.leaveRope();

		velocity.subVectors( next, c.position ).divideScalar( dt );
		velocity.addScaledVector( nextOut, - velocity.dot( nextOut ) );
		c.position.copy( next );

		// Facing the way it swings, or back along it.
		if ( Math.hypot( velocity.x, velocity.z ) > ROPE_TURN_SPEED ) {

			let heading = yawOf( velocity );

			if ( Math.cos( heading - c.yaw ) < 0 ) heading += Math.PI;
			c.yaw += wrapAngle( heading - c.yaw ) * Math.min( 1, dt * ROPE_TURN_RATE );

		}

		this.leanOnRope();

	}

	// The body hangs along the rope: the tilt that turns its up toward the anchor, and how it swings along its heading.
	leanOnRope() {

		const c = this.runner;
		const up = this.attachment.rope.anchor.clone().sub( c.position ).normalize();

		this.ropeTilt.pitch = Math.atan2( up.dot( c.forward() ), up.y );
		this.ropeTilt.roll = Math.asin( clamp( up.dot( c.right() ), - 1, 1 ) );
		this.ropeSwing = clamp( c.velocity.dot( c.forward() ) / ROPE_POSE_SPEED, - 1, 1 );

	}

	/** Lets go of the rope, flying on as it swung; a leap (jump) adds a kick up and along the heading. */
	leaveRope( leap = false ) {

		const c = this.runner;

		this.attachment = null;
		this.ropeTilt.pitch = this.ropeTilt.roll = 0;
		this.ropeSwing = 0;
		c.clock.hold( 'ropeLock', ROPE_LOCK );
		c.grounded = false;

		if ( leap ) {

			c.velocity.addScaledVector( c.forward(), ROPE_JUMP_FORWARD );
			c.velocity.y += ROPE_JUMP_UP;
			c.jumps = 1;
			c.openAirComboSoon();

		}

		this.camera( 'speedZoomOut' );
		c.setState( c.velocity.y > 0 ? 'rising' : 'falling' );

	}

	// ---- Shared

	// The heading the stick asks for, relative to the view; the runner's own without a steer.
	steerYaw( input, viewYaw ) {

		const x = input.move.x;
		const y = input.move.y;

		if ( ! x && ! y ) return this.runner.yaw;

		return yawOf( forward( viewYaw ).multiplyScalar( y ).addScaledVector( right( viewYaw ), x ) );

	}

	camera( name, options = {} ) {

		this.runner.events.push( { type: 'camera', name, ...options } );

	}

}

// A bar's line (its ends, `a` and `b`) and thickness (`radius`): its box's long axis, or, without its solid, a line
// across the way through the top found.
function barLine( { location, normal, solid } ) {

	if ( solid?.shape?.kind === 'box' ) {

		const centre = new Vector3().fromArray( solid.position );
		const along = new Vector3( 1, 0, 0 ).applyQuaternion( new Quaternion().fromArray( solid.rotation ) ).multiplyScalar( solid.shape.halfExtents[ 0 ] );
		return { a: centre.clone().sub( along ), b: centre.clone().add( along ), radius: solid.shape.halfExtents[ 1 ] };

	}

	const along = new Vector3( - normal.z, 0, normal.x ).normalize().multiplyScalar( BAR_LINE.half );
	const centre = location.clone().addScaledVector( UP, - BAR_LINE.radius );
	return { a: centre.clone().sub( along ), b: centre.clone().add( along ), radius: BAR_LINE.radius };

}

export { PolesAndBars };
