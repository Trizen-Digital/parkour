import { Vector3 } from 'three';
import { clamp, wrapAngle } from '../math.js';
import { CAPSULE } from '../sim/tuning.js';
import { FLOOR_GAP } from '../physics/Mover.js';
import { RouteVolumes } from './RouteVolumes.js';
import { routeBasis } from '../world/catchVolumes.js';

const UP = new Vector3( 0, 1, 0 );
const DOWN = new Vector3( 0, - 1, 0 );

// Busy with something else: no pipe or zipline is grabbed.
const BUSY = new Set( [ 'airStunt', 'bailing', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'hanging', 'onRope' ] );

// After letting go of a pipe or a zipline, the next grab of one waits this long (s).
const REATTACH = 0.35;
// A pipe grab pulls the runner onto the pipe over this long (s), this far in front of it (m).
const PIPE_ATTACH_TIME = 0.2;
const PIPE_STAND_OFF = 0.3;
// The stick pushed past this far up or down climbs or slides the pipe, like forward and back.
const PIPE_STICK = 0.005;
// Climbing: with nothing ahead of the hands (a ray this far up, this long, m) the runner climbs over the top.
const PIPE_HANDS = 1.15;
const PIPE_HANDS_REACH = 0.55;
// Sliding: a floor this close below (m) lets go of the pipe.
const PIPE_FLOOR_REACH = 1.35;
// A jump off a pipe leaves at this speed along the steer (m/s)...
const PIPE_JUMP_SPEED = 4.5;
// ...and rising at this one (m/s).
const PIPE_JUMP_UP = 4.6;
// Letting go of a pipe pushes off it backwards at this speed (m/s)...
const PIPE_LET_GO_SPEED = - 1.5;
// ...or, in first person, forward at this speed (m/s)...
const PIPE_LET_GO_SPEED_FIRST_PERSON = 6.5;
// ...rising at this one (m/s).
const PIPE_LET_GO_UP_FIRST_PERSON = 2.5;
// A ladder grab pulls the runner onto it over LADDER_ATTACH_TIME (s), LADDER_STAND_OFF (m) out from the rungs (the
// ladder's takes put the hands and feet on them from there), no lower than standing at its foot (LADDER_FOOT, m above
// it).
const LADDER_ATTACH_TIME = 0.25;
const LADDER_STAND_OFF = 0.25;
const LADDER_FOOT = 0.92;
// Up a ladder hand over hand, and down it sliding on the rails (m/s).
const LADDER_CLIMB_SPEED = 1.2;
const LADDER_SLIDE_SPEED = 4;
// The climb goes no higher than where climbing out as off a pipe (pipeTopOut's rise) stands the runner on the
// ladder's top, its centre LADDER_STAND (m) over it; the hands are over the top there. It climbs out if there is a
// floor at the top (a ray TOP_FLOOR.reach down from TOP_FLOOR.above over the top, TOP_FLOOR.in past the rungs; m),
// passing between the rails, and otherwise holds on at the top rung.
const LADDER_STAND = 0.92;
const TOP_FLOOR = { above: 0.5, in: 0.45, reach: 1 };
// Climbing over the top: the floor stood on is found by a ray down from TOP_LOOK.up above the body's centre (over the
// hands), as far on as the climb's root carries the body, TOP_LOOK.reach (m) long.
const TOP_LOOK = { up: 1.6, reach: 1.2 };
// The runner hangs this far below a zipline's cable (m).
const HANG_BELOW_CABLE = 1.02;
// A zipline grab carries the runner onto the cable over this long (s): from its flight to the hold on the cable,
// which slides on along it at the speed the runner brought, so the ride neither stops nor slips back.
const ZIPLINE_ATTACH_TIME = 0.15;
// The ride then gathers speed toward the tuning's (it closes this share of the gap a second, 1/s).
const ZIPLINE_SPEED_UP = 3;
// The end of a zipline throws the runner off forward at this speed (m/s)...
const ZIPLINE_EXIT_SPEED = 8;
// ...rising at this one (m/s).
const ZIPLINE_EXIT_UP = 1.25;

// The pipes' and ziplines' timers and holds on the runner's clock.
const TIMERS = [ 'pipeLock', 'ladderLock', 'ziplineLock', 'pipeJumpDone', 'topOutDone', 'ziplineLetGo' ];

function yawOf( direction ) {

	return Math.atan2( direction.x, direction.z );

}

function forward( yaw ) {

	return new Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );

}

function right( yaw ) {

	return new Vector3( - Math.cos( yaw ), 0, Math.sin( yaw ) );

}

/**
 * Drainpipes, ladders and ziplines. A pipe is grabbed in its catch volume, climbed or slid, jumped off, let go of, or
 * climbed over at the top; a ladder the same way, climbed hand over hand and slid down on its rails, and climbed out
 * between its rails onto the floor at its top; a zipline is grabbed in the air, ridden to its end, and let go of. The
 * catch volumes (RouteVolumes) say which pipe, ladder or zipline the runner is at. `update()` runs the onPipe, onLadder, toppingOut and onZipline states; the runner's step tries `tryAttach()`
 * with grab held.
 */
class PipesAndZiplines {

	constructor( runner ) {

		this.runner = runner;

		this.volumes = new RouteVolumes( runner );

		this.reset();

	}

	reset() {

		// What the runner holds: { kind: 'pipe' | 'ladder' | 'topOut' | 'zipline', phase, elapsed, from, target, fromYaw,
		// yaw, placeTime, … }; null when free.
		this.attachment = null;
		// The next grab of a pipe, a ladder or a zipline waits on a hold (pipeLock, ladderLock, ziplineLock: held while
		// on one, until the ground or a moment after letting go).
		this.runner.clock.cancel( ...TIMERS );
		// Which way the runner is going on a pipe or a ladder: 'up', 'down' or null.
		this.going = null;

		this.volumes.reset();

	}

	// Which pipe, ladder or zipline the runner is at; on the ground the next grab of any need not wait.
	everyStep() {

		const c = this.runner;

		this.volumes.poll();

		if ( c.grounded ) {

			c.clock.release( 'pipeLock' );
			c.clock.release( 'ladderLock' );
			c.clock.release( 'ziplineLock' );

		}

	}

	update( dt, input, viewYaw = this.runner.yaw ) {

		const a = this.attachment;

		if ( ! a ) return;

		if ( a.kind === 'pipe' ) {

			this.updatePipe( dt, input, viewYaw );

		} else if ( a.kind === 'ladder' ) {

			this.updateLadder( dt, input, viewYaw );

		} else if ( a.kind === 'topOut' ) {

			this.climbOver( dt );

		} else {

			this.updateZipline( dt, input );

		}

	}

	/**
	 * Grab held: the pipe or the ladder the runner is at (no move playing), or the zipline (grab pressed in the air).
	 * True if caught.
	 */
	tryAttach( input ) {

		const c = this.runner;

		this.volumes.poll();

		if ( ! input.held( 'grab' ) || c.tricking || BUSY.has( c.state ) ) return false;

		const pipe = this.volumes.current.pipe;

		if ( pipe && ! c.clock.held( 'pipeLock' ) && ! c.motion.moves.busy() ) {

			this.attachPipe( pipe );

			return true;

		}

		const ladder = this.volumes.current.ladder;

		if ( ladder && ! c.clock.held( 'ladderLock' ) && ! c.motion.moves.busy() ) {

			this.attachLadder( ladder );

			return true;

		}

		const zipline = this.volumes.current.zipline;

		if ( zipline && input.pressed( 'grab' ) && ! c.grounded && ! c.clock.held( 'ziplineLock' ) ) {

			this.attachZipline( zipline );

			return true;

		}

		return false;

	}

	// ---- Pipes

	attachPipe( volume ) {

		const c = this.runner;
		const { forward: direction } = routeBasis( volume.route );
		const column = volume.route.start.clone().addScaledVector( direction, - PIPE_STAND_OFF );
		const a = this.attach( 'pipe', 'onPipe', column.clone().setY( volume.detection.y ), yawOf( direction ), PIPE_ATTACH_TIME );

		// Where the body stays across the pipe while it climbs and slides, and the pipe (the hands hold it).
		a.column = column;
		a.route = volume.route;
		c.clock.hold( 'pipeLock', Infinity );
		this.going = 'up';
		c.airComboOpen = true;
		c.jumps = 0;
		c.motion.moves.stop( 'walkOffHop' );
		c.tricks.resetAir();

	}

	// On the pipe: jump released jumps off, dive lets go; else settle, then climb or slide with the stick or keys (jump
	// held holds still).
	updatePipe( dt, input, viewYaw ) {

		const c = this.runner;
		const p = c.tuning.values;
		const a = this.attachment;

		if ( input.released( 'jump' ) ) return this.jumpOff( input, viewYaw );
		if ( input.pressed( 'dive' ) ) return this.letGoOfPipe( input );

		if ( a.phase === 'placing' ) {

			if ( this.carry( dt ) ) {

				a.phase = 'grab';
				c.velocity.set( 0, 0, 0 );
				this.landingShake();
				this.camera( 'recenterView' );

			}

			return;

		}

		const stick = input.value( 'stick' ) || {};
		const stickY = typeof stick === 'object' ? stick.y || 0 : 0;

		if ( input.held( 'jump' ) ) {

			this.going = null;

			return;

		}

		const up = input.held( 'forward' ) || stickY > PIPE_STICK;
		const down = input.held( 'back' ) || stickY < - PIPE_STICK;

		this.going = null;

		if ( up ) {

			const hands = c.position.clone().addScaledVector( UP, PIPE_HANDS );

			if ( ! c.queries.ray( hands, c.forward(), PIPE_HANDS_REACH, 'probe' ) ) {

				this.topOut();

				return;

			}

			c.position.set( a.column.x, c.position.y + p.pipeClimbSpeed * dt, a.column.z );
			c.yaw = a.yaw;
			this.going = 'up';

		}

		if ( down ) {

			if ( c.queries.ray( c.position, DOWN, PIPE_FLOOR_REACH, 'probe' ) ) return this.letGoOfPipe( input );

			c.position.set( a.column.x, c.position.y - p.pipeSlideSpeed * dt, a.column.z );
			c.yaw = a.yaw;
			this.going = 'down';

		}

	}

	// Lets go of a pipe or a ladder, pushing off it backwards (or forward, in first person).
	letGoOfPipe( input ) {

		const c = this.runner;
		const lock = this.attachment?.kind === 'ladder' ? 'ladderLock' : 'pipeLock';

		this.going = null;
		c.canMove = true;
		c.airComboOpen = false;
		c.landHard = true;
		c.velocity.copy( c.forward() ).multiplyScalar( PIPE_LET_GO_SPEED );
		c.velocity.y = 0;
		c.grounded = false;
		this.landingShake();
		this.camera( 'speedZoomOut' );
		this.viewFree( input );

		if ( c.firstPerson ) {

			c.velocity.copy( c.forward() ).multiplyScalar( PIPE_LET_GO_SPEED_FIRST_PERSON );
			c.velocity.y = PIPE_LET_GO_UP_FIRST_PERSON;
			this.camera( 'faceView', { yaw: c.yaw, pitch: 0 } );

		}

		c.clock.hold( lock, REATTACH );
		this.attachment = null;
		c.setState( 'falling' );

	}

	jumpOff( input, viewYaw ) {

		const c = this.runner;

		this.letGoOfPipe( input );

		const yaw = c.firstPerson ? c.yaw : this.steerYaw( input, viewYaw );

		c.velocity.copy( forward( yaw ) ).multiplyScalar( PIPE_JUMP_SPEED );
		c.velocity.y = PIPE_JUMP_UP;
		c.setState( 'rising' );

		// On the next step the jump and the wall runs come back.
		c.clock.after( 0, 'pipeJumpDone', () => {

			c.jumps = 1;
			c.walls.runReady = true;

		} );

	}

	// Over the top of the pipe or the ladder: its move carries the body (root motion, keyed along the body, so it moves
	// on over the edge as the body does), and the runner stands on the top on the step after the move blends out by
	// itself (not when something cuts it short). The body passes over the edge, and off a ladder between its rails,
	// with no collisions until it stands on the top.
	topOut() {

		const c = this.runner;
		const a = this.attachment;

		c.clock.hold( 'noCollision', c.motion.length( 'pipeTopOut' ) );

		// Onto the floor at the top, as far on as the root carries the body, along the root as it rises.
		const on = c.motion.moveDelta( 'pipeTopOut', 0, c.motion.length( 'pipeTopOut' ) ).z * c.tuning.values.rootMotionScale;
		const over = c.position.clone().addScaledVector( c.forward(), on );
		const floor = c.queries.ray( over.clone().addScaledVector( UP, TOP_LOOK.up ), DOWN, TOP_LOOK.reach, 'probe' );

		a.kind = 'topOut';
		a.elapsed = 0;
		a.from = c.position.clone();
		a.target = floor && floor.distance > 0 ? over.setY( floor.point.y + CAPSULE.halfHeight + FLOOR_GAP ) : null;
		a.placeTime = c.motion.riseTime( 'pipeTopOut' );
		this.going = null;
		c.airComboOpen = false;
		c.canMove = false;
		c.velocity.set( 0, 0, 0 );
		c.setState( 'toppingOut' );
		c.motion.moves.play( 'pipeTopOut', {
			onBlendOut: ( event ) => {

				// Done on the step after, once the body is up on the top too.
				if ( ! event?.interrupted && this.attachment === a ) a.blendedOut = true;

			}
		} );

	}

	// Climbing over: carried onto the floor at the top along the climb's root (as it rises, and on as it moves on); with
	// no floor found there, by the root's motion alone.
	climbOver( dt ) {

		const c = this.runner;
		const a = this.attachment;

		a.elapsed += dt;
		if ( a.blendedOut && a.elapsed >= a.placeTime && ! c.clock.pending( 'topOutDone' ) ) c.clock.after( 0, 'topOutDone', ( input ) => this.finishTopOut( input ) );

		if ( ! a.target ) {

			c.applyRootMotion( dt, 'guided' );

			return;

		}

		const before = c.position.clone();
		const { up, on } = c.motion.rootShare( 'pipeTopOut', a.elapsed, a.placeTime );
		const span = a.target.clone().sub( a.from );

		c.position.set( a.from.x + span.x * on, a.from.y + span.y * up, a.from.z + span.z * on );
		c.velocity.copy( c.position ).sub( before ).divideScalar( dt );

	}

	finishTopOut( input ) {

		const c = this.runner;

		c.clock.release( 'noCollision' );
		c.canMove = true;
		c.standOnFloor();
		this.viewFree( input );
		this.attachment = null;

	}

	// ---- Ladders

	attachLadder( volume ) {

		const c = this.runner;
		const ladder = volume.route;
		const { forward: direction } = routeBasis( ladder );
		const column = ladder.start.clone().addScaledVector( direction, - LADDER_STAND_OFF );
		const height = clamp( volume.detection.y, ladder.start.y + LADDER_FOOT, this.ladderTop( ladder ) );
		const a = this.attach( 'ladder', 'onLadder', column.clone().setY( height ), yawOf( direction ), LADDER_ATTACH_TIME );

		// Where the body stays across the ladder while it climbs and slides.
		a.column = column;
		a.ladder = ladder;
		c.clock.hold( 'ladderLock', Infinity );
		this.going = null;
		c.airComboOpen = true;
		c.jumps = 0;
		c.motion.moves.stop( 'walkOffHop' );
		c.tricks.resetAir();

	}

	// On the ladder, as on a pipe: jump released jumps off, dive lets go; else settle, then climb or slide with the stick
	// or keys (jump held holds still). At the top it climbs out onto the floor there, or holds on.
	updateLadder( dt, input, viewYaw ) {

		const c = this.runner;
		const a = this.attachment;

		if ( input.released( 'jump' ) ) return this.jumpOff( input, viewYaw );
		if ( input.pressed( 'dive' ) ) return this.letGoOfPipe( input );

		if ( a.phase === 'placing' ) {

			if ( this.carry( dt ) ) {

				a.phase = 'grab';
				c.velocity.set( 0, 0, 0 );
				this.landingShake();
				this.camera( 'recenterView' );

			}

			return;

		}

		this.going = null;

		if ( input.held( 'jump' ) ) return;

		const stick = input.value( 'stick' ) || {};
		const stickY = typeof stick === 'object' ? stick.y || 0 : 0;
		const top = this.ladderTop( a.ladder );

		if ( input.held( 'forward' ) || stickY > PIPE_STICK ) {

			if ( c.position.y >= top ) {

				if ( this.floorAtTop( a ) ) this.topOut();

				return;

			}

			c.position.set( a.column.x, Math.min( top, c.position.y + LADDER_CLIMB_SPEED * dt ), a.column.z );
			this.going = 'up';

		} else if ( input.held( 'back' ) || stickY < - PIPE_STICK ) {

			if ( c.queries.ray( c.position, DOWN, PIPE_FLOOR_REACH, 'probe' ) ) return this.letGoOfPipe( input );

			c.position.set( a.column.x, c.position.y - LADDER_SLIDE_SPEED * dt, a.column.z );
			this.going = 'down';

		}

		c.yaw = a.yaw;

	}

	// The highest the body climbs a ladder: where climbing out rises onto its top.
	ladderTop( ladder ) {

		const c = this.runner;
		const climbOut = c.motion.moveDelta( 'pipeTopOut', 0, c.motion.length( 'pipeTopOut' ) ).y * c.tuning.values.rootMotionScale;

		return ladder.end.y + LADDER_STAND - climbOut;

	}

	// A floor at the ladder's top to climb out onto: a ray down onto it, past the rungs, from open air (a ray that starts
	// in the wall the ladder stops short of the top of hits it at once).
	floorAtTop( a ) {

		const { forward: direction } = routeBasis( a.ladder );
		const from = a.column.clone().addScaledVector( direction, LADDER_STAND_OFF + TOP_FLOOR.in ).setY( a.ladder.end.y + TOP_FLOOR.above );
		const floor = this.runner.queries.ray( from, DOWN, TOP_FLOOR.reach, 'probe' );

		return Boolean( floor && floor.distance > 0 );

	}

	// ---- Ziplines

	attachZipline( volume ) {

		const c = this.runner;
		const route = volume.route;
		const cable = route.end.clone().sub( route.start );
		const toEnd = c.forward().dot( route.forward ) >= 0;
		const endpoint = toEnd ? route.end : route.start;
		// Caught where the runner is now along the cable (its catch volume looks only every 50 ms): its place across the
		// ground put square onto the cable's line.
		const flat = cable.clone().setY( 0 );
		const along = clamp( c.position.clone().sub( route.start ).setY( 0 ).dot( flat ) / Math.max( flat.lengthSq(), Number.EPSILON ), 0, 1 );
		const caught = route.start.clone().addScaledVector( cable, along );
		const direction = endpoint.clone().sub( caught ).normalize();
		const velocity = c.velocity.clone();
		const a = this.attach( 'zipline', 'onZipline', caught.clone().addScaledVector( UP, - HANG_BELOW_CABLE ), yawOf( direction ), ZIPLINE_ATTACH_TIME );

		// The point on the cable caught, the end ridden to and the way there, and the speed along it the runner brought
		// (never back up the cable), with the flight it was on.
		a.caughtAt = caught;
		a.end = endpoint.clone().addScaledVector( UP, - HANG_BELOW_CABLE );
		a.direction = direction;
		a.speed = Math.max( 0, velocity.dot( direction ) );
		a.flight = velocity;
		// The cable (the hands hold it).
		a.route = route;
		c.clock.hold( 'ziplineLock', Infinity );

	}

	// On the zipline: grab released lets go (the runner drops off on the next step); else onto the cable, then ride to
	// the end.
	updateZipline( dt, input ) {

		const c = this.runner;
		const p = c.tuning.values;
		const a = this.attachment;

		if ( input.released( 'grab' ) ) this.letGoOfZipline();
		if ( a.finishing ) return;

		if ( a.phase === 'placing' ) {

			// From the flight to the hold, which slides on along the cable: a smoothstep between them, so the body
			// leaves its flight at its own speed and joins the cable at the hold's.
			a.elapsed = Math.min( a.placeTime, a.elapsed + dt );
			const t = a.elapsed / a.placeTime, blend = t * t * ( 3 - 2 * t );
			const hold = a.target.clone().addScaledVector( a.direction, a.speed * a.elapsed );
			const flight = a.from.clone().addScaledVector( a.flight, a.elapsed );

			const before = c.position.clone();
			c.position.copy( flight ).lerp( hold, blend );
			c.velocity.copy( c.position ).sub( before ).divideScalar( Math.max( dt, Number.EPSILON ) );
			c.yaw = a.fromYaw + wrapAngle( a.yaw - a.fromYaw ) * blend;

			if ( t === 1 ) {

				a.phase = 'riding';
				this.landingShake();
				this.camera( 'recenterView' );

			}

			return;

		}

		// Riding: gathering speed toward the tuning's, to the end.
		a.speed += ( p.ziplineSpeed - a.speed ) * clamp( ZIPLINE_SPEED_UP * dt, 0, 1 );
		const left = a.end.clone().sub( c.position );
		const step = a.speed * dt;

		if ( step >= left.dot( a.direction ) ) {

			c.position.copy( a.end );
			this.finishZipline();

			return;

		}

		c.position.addScaledVector( a.direction, step );
		c.velocity.copy( a.direction ).multiplyScalar( a.speed );

	}

	letGoOfZipline() {

		const c = this.runner;
		const a = this.attachment;

		if ( a.finishing ) return;

		c.clock.hold( 'ziplineLock', REATTACH );
		this.landingShake();
		this.camera( 'speedZoomOut' );

		// A ride let go of drops off on the next step.
		if ( a.phase === 'riding' ) {

			a.finishing = true;
			c.clock.after( 0, 'ziplineLetGo', () => this.finishZipline() );

		}

	}

	// Off the end (or let go): thrown forward and up.
	finishZipline() {

		const c = this.runner;

		c.velocity.copy( c.forward() ).multiplyScalar( ZIPLINE_EXIT_SPEED );
		c.velocity.y = ZIPLINE_EXIT_UP;
		c.grounded = false;
		this.attachment = null;
		c.setState( 'rising' );

	}

	// ---- Shared

	attach( kind, state, target, yaw, placeTime ) {

		const c = this.runner;
		const a = ( this.attachment = {
			kind,
			phase: 'placing',
			elapsed: 0,
			from: c.position.clone(),
			target,
			fromYaw: c.yaw,
			yaw,
			placeTime
		} );

		c.stunt = null;
		c.grounded = false;
		c.velocity.set( 0, 0, 0 );
		c.walls.kickNormal.set( 0, 0, 0 );
		c.setState( state );

		return a;

	}

	// Carries the body from where it was caught onto the pipe or cable: true once there.
	carry( dt, easeIn = false ) {

		const c = this.runner;
		const a = this.attachment;

		a.elapsed += dt;

		const alpha = clamp( a.elapsed / a.placeTime, 0, 1 );
		const t = easeIn ? alpha * alpha : alpha;

		c.position.copy( a.from ).lerp( a.target, t );
		c.yaw = a.fromYaw + wrapAngle( a.yaw - a.fromYaw ) * t;

		return alpha === 1;

	}

	// The heading the stick asks for, relative to the view; the runner's own without a steer.
	steerYaw( input, viewYaw ) {

		const x = input.move.x;
		const y = input.move.y;

		return x || y ? yawOf( forward( viewYaw ).multiplyScalar( y ).addScaledVector( right( viewYaw ), x ) ) : this.runner.yaw;

	}

	viewFree( input ) {

		this.runner.viewOnHead = !! input.preferences?.values.headCamera;
		this.camera( 'viewFree' );

	}

	landingShake() {

		this.camera( 'landing', { epicenter: this.runner.position.clone() } );

	}

	camera( name, options ) {

		this.runner.events.push( { type: 'camera', name, ...options } );

	}

}

export { PipesAndZiplines };
