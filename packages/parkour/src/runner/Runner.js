import { Vector3 } from 'three';
import { GRAVITY, TERMINAL_FALL_SPEED } from '../sim/tuning.js';
import { FLOOR_GAP, FLOOR_GAP_MAX } from '../physics/Mover.js';
import { horizontalVelocity } from './velocity.js';
import { PIPE_AND_ZIPLINE_STATES, LEDGE_STATES, POLE_AND_BAR_STATES, WALL_STATES } from './states.js';
import { Clock } from './Clock.js';
import { Capsule } from './Capsule.js';
import { MarkerResponses } from './MarkerResponses.js';
import { TrickGesture } from './TrickGesture.js';
import { Bail } from './Bail.js';
import { PipesAndZiplines } from './PipesAndZiplines.js';
import { Ledges } from './Ledges.js';
import { Tricks } from './Tricks.js';
import { SkidStops } from './SkidStops.js';
import { Slides } from './Slides.js';
import { Landings } from './Landings.js';
import { PolesAndBars } from './PolesAndBars.js';
import { Precision } from './Precision.js';
import { Walls } from './Walls.js';
import { DoorsAndSwitches } from './DoorsAndSwitches.js';

const UP = new Vector3( 0, 1, 0 );

// The stunts that are rolls: they play in the rolling state.
const ROLLS = new Set( [ 'landingRoll', 'diveRoll', 'spinDiveRoll', 'hardLanding' ] );

// Falling faster than this (m/s) is fatal: the runner bails in the air. The fall is checked every FALL_CHECK (s).
const LETHAL_FALL_SPEED = - 25.5;
const FALL_CHECK = 0.1;
// No grab for this long after a spawn (s): a spawn may be right at something to catch.
const SPAWN_GRAB_LOCK = 0.25;
// Sprinting lapses on the ground once sprint is let go; that is checked every SPRINT_CHECK (s).
const SPRINT_CHECK = 0.2;
// Above this speed (m/s) a jump is a running jump.
const RUNNING_SPEED = 2.5;
// A running jump this fast across the ground (m/s) with the jump charged past STYLE_JUMP_CHARGE is a style jump: the
// jump's own rise does not count, so a standing jump held long is still a plain one.
const STYLE_JUMP_SPEED = 4.5;
const STYLE_JUMP_CHARGE = 0.95;
// Walking off an edge keeps at most this horizontal speed (m/s) and hops up at this one (m/s).
const WALK_OFF_MAX_SPEED = 6.5;
const WALK_OFF_HOP = 1.55;
// A stick pushed this far or less does not accelerate the runner.
const MOVE_THRESHOLD = 0.11;
// A steer shorter than a thousandth (compared squared) does not turn the runner.
const STEER_MIN = 1e-6;
// A jump blends the move playing out over this long (s).
const JUMP_BLEND_OUT = 0.1;
// Below this speed (m/s) on the ground the runner is standing.
const STILL_SPEED = 0.1;
// The air turn rates (per second) right after leaving a wall run, a pole and a wall kick: slow off a wall run, so the
// jump keeps its line, fast off a wall kick, so the steer takes over.
const WALL_RUN_JUMP_TURN_RATE = 2.25;
const POLE_JUMP_TURN_RATE = 5.5;
const WALL_KICK_TURN_RATE = 10;
// The air combo opens this long after a takeoff, or after the marker of a move that allows one (s).
const AIR_COMBO_DELAY = 0.055;
// An air stunt lands only once this long past its launch (s): the ground it leaves does not end it.
const AIR_STUNT_LANDS_AFTER = 0.15;
// A placed stunt (a stride) ends stepping down at this speed (m/s), so the next step finds the floor under it.
const PLACED_STUNT_SETTLE = - 0.1;

/**
 * The runner, the body the player moves. It owns its position, velocity, heading and capsule, the state it is in
 * (states.js) and the traversal systems that move it in their own states: ledges, walls, poles, bars and ropes, pipes,
 * ladders and ziplines.
 * Slides, tricks, precision jumps, landings, bails, doors and switches act on it from the general movement, in which
 * it walks, sprints, jumps and falls by itself. It reads timing, root motion and markers from the motion system and never a pose.
 * Everything it and its systems time (delays, locks, windows, periodic checks) is on one clock, `clock` (Clock.js),
 * whose timers fire at the start of each step.
 *
 * `step()` runs once per fixed step (Simulation, 120 Hz); it pushes what the frame should hear about into `events`:
 * state changes `{ from, to }`, and `{ type: 'camera', name, … }`.
 */
class Runner {

	constructor( tuning, queries, mover, motion, world ) {

		this.tuning = tuning;
		this.queries = queries;
		this.mover = mover;
		this.motion = motion;
		this.world = world;

		this.position = new Vector3();
		this.previousPosition = new Vector3();
		this.velocity = new Vector3();
		// The heading: forward is ( sin yaw, 0, cos yaw ).
		this.yaw = 0;
		this.state = 'standing';
		this.grounded = false;
		// Everything the runner times; its time is the runner's (seconds since the respawn).
		this.clock = new Clock();
		// Seconds since the state last changed.
		this.stateTime = 0;
		// The input of the step being run (what acts on a landing or a timer reads it).
		this.input = null;
		this.events = [];
		// The committed move playing, if any (startStunt).
		this.stunt = null;
		// The player's view: first person stays across respawns.
		this.firstPerson = false;

		this.capsule = new Capsule();
		this.markerResponses = new MarkerResponses( this );
		this.trickGesture = new TrickGesture( this );
		this.bail = new Bail( this );
		this.pipesAndZiplines = new PipesAndZiplines( this );
		this.ledges = new Ledges( this );
		this.tricks = new Tricks( this );
		this.skidStops = new SkidStops( this );
		this.slides = new Slides( this );
		this.landings = new Landings( this );
		this.polesAndBars = new PolesAndBars( this );
		this.precision = new Precision( this );
		this.walls = new Walls( this );
		this.doorsAndSwitches = new DoorsAndSwitches( this );

		this.teleport( world.spawn() );

	}

	/** Seconds since the respawn: the clock's time. The ragdoll's steps move it on without running the clock. */
	get time() {

		return this.clock.time;

	}

	set time( seconds ) {

		this.clock.time = seconds;

	}

	// Over a low obstacle: the power jump off one uses the vaulting state too, with a placement of its own kind.
	get vaulting() {

		return this.state === 'vaulting' && this.ledges.placement?.kind === 'vault';

	}

	/** Horizontal speed, m/s. */
	get speed() {

		return Math.hypot( this.velocity.x, this.velocity.z );

	}

	/** The speed the pace allows, m/s. */
	get topSpeed() {

		const p = this.tuning.values;

		return this.pace === 'sprint' ? p.sprintSpeed : p.walkSpeed;

	}

	forward() {

		return new Vector3( Math.sin( this.yaw ), 0, Math.cos( this.yaw ) );

	}

	right() {

		return new Vector3( - Math.cos( this.yaw ), 0, Math.sin( this.yaw ) );

	}

	setState( state ) {

		if ( this.state === state ) return;

		this.events.push( { from: this.state, to: state } );
		this.state = state;
		this.stateTime = 0;

	}

	/** Starts again at a spawn, falling, with everything the run carried cleared. */
	teleport( spawn ) {

		this.position.copy( spawn.position );
		this.previousPosition.copy( this.position );
		this.yaw = spawn.yaw;
		this.velocity.set( 0, 0, 0 );
		this.grounded = false;
		this.stunt = null;

		// Every timer, hold and beat starts again. The runner's own holds: jumpLock (a trick, a roll or a perch holds
		// the jump back), noCollision (a ghosted move passes through solids), airTrickLock (after getting up),
		// precisionWindow and rollWindow (what the next landing is), slideCooldown and grabLock.
		this.clock.clear();

		// Jumps since the runner last stood on something (a second one is not allowed), and the charge of a held jump.
		this.jumps = 0;
		this.jumpCharge = this.tuning.values.jumpChargeStart;
		// A cartwheel or a climb locks the jump until it is done (the clock's jumpLock holds it for a time).
		this.jumpLocked = false;
		// The air combo is open for an air trick (it opens a moment after a takeoff: airComboOpen on the clock).
		this.airComboOpen = false;
		// A precision jump's charge.
		this.precisionCharge = 0;
		// The braking a slide leaves on the ground until the stick moves (undefined: the tuning's).
		this.slideBraking = undefined;

		this.pace = 'walk';
		this.sprinting = false;

		this.slowMotion = false;
		// The follow camera lags behind (a hop or a climb onto something).
		this.cameraLag = false;

		// What the runner may do now: steer, crouch for a precision jump, hop off an edge it walks off.
		this.canMove = this.precisionAllowed = this.canWalkOff = true;
		// What it is in the middle of: a trick or roll (their markers), a dive.
		this.tricking = this.rolling = false;
		this.diving = false;
		// What the next landing should be: hard, or a bail if the runner leaves the ground meanwhile.
		this.landHard = this.bailIfAirborne = false;
		// The last jump was a plain one (not a style jump, not out of a slide): the graph picks its landing by it.
		this.plainJump = true;
		// Balancing after a precision landing.
		this.balancing = false;

		this.tricks.reset();
		this.skidStops.reset();
		this.capsule.reset();
		this.walls.reset();
		this.pipesAndZiplines.reset();
		this.ledges.reset();
		this.bail.reset();
		this.slides.reset();
		this.precision.reset();
		this.landings.reset();
		this.polesAndBars.reset();
		this.doorsAndSwitches.reset();
		this.trickGesture.reset();
		this.motion.moves.stop( undefined, 0 );

		this.setState( 'falling' );
		this.clock.hold( 'grabLock', SPAWN_GRAB_LOCK );

	}

	/** Puts the runner on the floor under it if there is one (after a placement onto a top), else falling. */
	standOnFloor() {

		const p = this.tuning.values;
		const floor = this.mover.findFloor( this.position, this.capsule.halfHeight, p.stepHeight + FLOOR_GAP_MAX, p.walkableSlope );

		this.mover.floor = floor;
		this.grounded = !! floor;

		if ( floor ) {

			this.position.y -= floor.floorDistance - FLOOR_GAP;
			this.velocity.y = 0;

		}

		this.setState( floor ? 'standing' : 'falling' );

	}

	step( dt, input, viewYaw ) {

		this.input = input;
		this.previousPosition.copy( this.position );

		// What happened since the last step acts first: the markers the motion fired at its end (at that step's time),
		// then, as the clock moves on by this step, every timer that has come due.
		this.markerResponses.update();
		this.clock.run( this.time + dt, input );

		// A bail that came due has handed the body over: nothing else acts this step.
		if ( this.state === 'bailing' ) return;

		// The systems' watches, in the order they act.
		this.pipesAndZiplines.everyStep();
		this.ledges.everyStep( dt, input );
		this.polesAndBars.everyStep();
		this.precision.everyStep( input );
		this.doorsAndSwitches.everyStep( dt );
		this.stateTime += dt;
		this.updateSprint( input );
		this.checkFall();

		if ( input.moveDirection.x || input.moveDirection.y ) this.slideBraking = undefined;

		this.capsule.update( dt );
		this.skidStops.everyStep( input );
		this.walls.everyStep( input );

		if ( input.pressed( 'toggleView' ) ) this.firstPerson = ! this.firstPerson;

		if ( input.preferences?.values.slowMotionToggle === false ) {

			this.slowMotion = input.held( 'slowMotion' );

		} else if ( input.pressed( 'slowMotion' ) ) {

			this.slowMotion = ! this.slowMotion;

		}

		this.tricks.update();

		if ( input.pressed( 'goLimp' ) ) this.bail.request( true );

		// Grab held on the ground with a trick button pressed: a vault or a hop if there is something to take.
		const trickPressed = [ 'jump', 'flip', 'wheel', 'dive' ].some( ( action ) => input.pressed( action ) );

		if ( input.held( 'grab' ) && this.grounded && ! this.clock.held( 'grabLock' ) && trickPressed && this.ledges.tryCatch( input ) ) return;

		// Below the world's floor the runner has fallen out of it and starts again at the first spawn.
		if ( this.position.y < this.world.floor || ! Number.isFinite( this.position.lengthSq() ) ) {

			this.teleport( this.world.spawn() );

			return;

		}

		this.trickGesture.update( input );

		// In a traversal system's state, that system moves the runner.
		if ( PIPE_AND_ZIPLINE_STATES.has( this.state ) ) {

			this.pipesAndZiplines.update( dt, input, viewYaw );

		} else if ( LEDGE_STATES.has( this.state ) ) {

			this.ledges.update( dt, input );

		} else if ( POLE_AND_BAR_STATES.has( this.state ) ) {

			this.polesAndBars.update( dt, input, viewYaw );

		} else if ( WALL_STATES.has( this.state ) ) {

			this.walls.update( dt, input, viewYaw );

		} else {

			this.stepFree( dt, input, viewYaw );

		}

		// A shut door the body has moved into is barged open, or holds it back (the world has no leaf to collide with).
		this.doorsAndSwitches.block();

	}

	// Free of the traversal systems: wall kicks, the power jump, jumps, stunts, the precision crouch and strides, slides,
	// tricks, the grabs that start a traversal, and else the runner's own movement.
	stepFree( dt, input, viewYaw ) {

		if ( this.walls.tryKick( input, viewYaw ) ) return;
		if ( this.ledges.tryPowerJumpApproach( input ) ) return;
		this.jump( dt, input );

		if ( this.stunt ) {

			// A stunt plays out, unless the runner leaves a perch or chains a trick from it.
			if ( this.balancing && this.precision.leavePerch( input ) ) return;
			if ( this.tricks.ground( input ) || this.tricks.air( input ) ) return;
			this.updateStunt( dt );

			return;

		}

		if ( this.state === 'bailing' ) {

			this.sprinting = false;

			return;

		}

		// In front of a door or a switch the precision button works it, before it can crouch.
		if ( this.doorsAndSwitches.tryInteract( input ) ) return;
		if ( this.precision.update( input ) ) {

			// A stride moves the body from the step it starts, as its take does.
			if ( this.stunt?.target && this.stunt.time === 0 ) this.updateStunt( dt );
			return;

		}

		this.slides.tryBegin( input );

		if ( this.state === 'sliding' ) {

			this.slides.update( dt, input );

			return;

		}

		if ( this.tricks.ground( input ) || this.tricks.air( input ) ) return;

		if ( input.held( 'grab' ) && ! this.clock.held( 'grabLock' ) ) {

			if ( this.pipesAndZiplines.tryAttach( input ) || this.polesAndBars.tryAttach( input ) ) return;
			if ( this.ledges.tryCatch( input ) ) return;
			if ( this.walls.tryWallRun( input ) ) return;

		}

		this.move( dt, input, viewYaw );

	}

	checkFall() {

		if ( this.clock.every( 'fallCheck', FALL_CHECK ) && this.velocity.y < LETHAL_FALL_SPEED ) this.bail.request();

	}

	updateSprint( input ) {

		if ( this.clock.every( 'sprintCheck', SPRINT_CHECK ) ) {

			// Sprint stays on while the toggle preference latches it or the pad's trigger holds it.
			const toggled = input.preferences?.values.sprintToggle && input.held( 'sprint' );
			const trigger = input.held( 'sprint', 'pad' );

			if ( ! toggled && ! trigger && this.grounded ) {

				this.sprinting = false;
				this.pace = 'walk';

			}

		}

		if ( input.held( 'sprint' ) ) {

			this.sprinting = true;
			this.pace = 'sprint';

		}

	}

	/** Charges the jump while it is held on the ground, and jumps when it is let go. */
	jump( dt, input ) {

		const p = this.tuning.values;

		if ( input.pressed( 'jump' ) && this.grounded ) this.jumpCharge = p.jumpChargeStart;
		if ( input.held( 'jump' ) && this.grounded ) this.jumpCharge = Math.min( 1, this.jumpCharge + p.jumpChargeRate * dt );

		if (
			! input.released( 'jump' ) ||
			this.jumpLocked ||
			this.clock.held( 'jumpLock' ) ||
			! this.grounded ||
			this.jumps >= 1 ||
			this.balancing ||
			this.climbing ||
			this.climbingLedge ||
			// A stunt that flies or is placed is committed, also while it waits to launch (a precision jump's delay).
			this.stunt?.air ||
			this.stunt?.target ||
			this.state === 'sliding' ||
			this.state === 'aiming' ||
			// A landing about to be rolled (judged on the step after touchdown, rolled on the one after) is not jumped
			// out of: Jump let go there, having been held to roll, would leave the roll to start in the air.
			( this.clock.held( 'rollWindow' ) && ( this.clock.pending( 'resolveLanding' ) || this.clock.pending( 'roll' ) ) ) ||
			// With precision held the jump is a precision jump instead; with grab held, a vault, a hop or a stride where grab
			// has one ahead to take. With nothing for grab to take it is a jump, which grab then catches with in the air
			// (a run at a tall wall, up it to the ledge).
			( input.held( 'grab' ) && ( this.ledges.groundTarget() || this.precision.strideTarget() ) ) ||
			input.held( 'precision' )
		) {

			return false;

		}

		this.stunt = null;
		this.motion.moves.stop( undefined, JUMP_BLEND_OUT );
		this.velocity.y = this.speed > RUNNING_SPEED ? p.runningJumpSpeed * this.jumpCharge : p.standingJumpSpeed;
		this.grounded = false;
		this.jumps ++;
		const style = this.speed > STYLE_JUMP_SPEED && this.jumpCharge > STYLE_JUMP_CHARGE;

		this.plainJump = ! style;
		this.openAirComboSoon();
		this.setState( 'rising' );
		this.events.push( { type: 'camera', name: 'landing', epicenter: this.position.clone() } );
		if ( style ) this.events.push( { type: 'camera', name: 'styleJump' } );

		return true;

	}

	/**
	 * Moves the body by the playing move's root motion over dt (turned to the heading, scaled by the tuning), if a move
	 * carries the root. On the ground it stays on the floor; in the air gravity takes the vertical; guided, the move
	 * alone moves it. Returns the mover's result, or null with no root motion.
	 */
	applyRootMotion( dt, mode = this.grounded ? 'ground' : 'air', motion = this.motion.rootMotion( dt ) ) {

		if ( ! motion ) return null;

		const p = this.tuning.values;
		const oldVertical = this.velocity.y;
		const delta = motion.translation.clone().multiplyScalar( p.rootMotionScale ).applyAxisAngle( UP, this.yaw );

		this.velocity.copy( delta ).divideScalar( dt );

		if ( mode === 'ground' ) {

			this.velocity.y = delta.y = 0;

		} else if ( mode === 'air' ) {

			// The step covers the average of the vertical speeds at its two ends.
			this.velocity.y = Math.max( TERMINAL_FALL_SPEED, oldVertical - GRAVITY * p.gravityScale * dt );
			delta.y = ( oldVertical + this.velocity.y ) * 0.5 * dt;

		}

		const result =
			this.stunt?.ghost || this.clock.held( 'noCollision' ) ? ( this.position.add( delta ), { grounded: false } ) :
			mode === 'guided' ? this.mover.glide( this.position, this.velocity, dt, p, this.capsule.halfHeight, delta, this.slides.rotation ) :
			this.mover.walk( this.position, this.velocity, dt, p, mode === 'ground', this.capsule.halfHeight, delta, this.slides.rotation );

		this.grounded = result.grounded;

		return result;

	}

	/** The runner's own movement on the ground and in the air, steered by the stick relative to the view. */
	move( dt, input, viewYaw ) {

		const p = this.tuning.values;
		const wasGrounded = this.grounded;
		const fallSpeed = this.velocity.y;
		const rootMotion = this.applyRootMotion( dt );

		if ( rootMotion ) {

			if ( rootMotion.grounded && ! wasGrounded ) this.landings.land( fallSpeed, input );

			return;

		}

		const axisX = input.move.x;
		const axisY = input.move.y;
		const move = new Vector3( Math.sin( viewYaw ) * axisY - Math.cos( viewYaw ) * axisX, 0, Math.cos( viewYaw ) * axisY + Math.sin( viewYaw ) * axisX );
		const magnitude = Math.min( 1, input.moveAmount );

		if ( this.firstPerson ) {

			this.yaw = viewYaw;

		} else if ( this.canMove && move.lengthSq() > STEER_MIN ) {

			// In the air on the pad, a trick button held leaves the stick to the trick's direction.
			const trickHeld = ! wasGrounded && input.usingPad && [ 'jump', 'wheel', 'flip' ].some( ( action ) => input.held( action ) );

			if ( ! trickHeld ) {

				const steer = Math.atan2( move.x, move.z );
				const difference = Math.atan2( Math.sin( steer - this.yaw ), Math.cos( steer - this.yaw ) );
				const rate =
					wasGrounded ? p.groundTurnRate :
					this.fromWallRun ? WALL_RUN_JUMP_TURN_RATE :
					this.fromPole ? POLE_JUMP_TURN_RATE :
					this.kickedOffWall ? WALL_KICK_TURN_RATE :
					p.airTurnRate;

				this.yaw += difference * Math.min( 1, dt * rate );

			}

		}

		// In third person the runner accelerates along the heading the stick turns; in first person it strafes.
		const direction =
			! this.canMove ? new Vector3() :
			this.firstPerson ? move.clampLength( 0, 1 ) :
			this.forward().multiplyScalar( magnitude > MOVE_THRESHOLD ? magnitude : 0 );
		const acceleration = direction.multiplyScalar( p.acceleration * ( wasGrounded ? 1 : p.airControl ) );
		const horizontal = horizontalVelocity(
			this.velocity,
			acceleration,
			this.topSpeed * magnitude,
			wasGrounded ? p.groundFriction : p.airFriction,
			wasGrounded ? ( this.slideBraking ?? p.braking ) : 0,
			dt
		);

		this.velocity.x = horizontal.x;
		this.velocity.z = horizontal.z;

		const previousVertical = this.velocity.y;

		this.velocity.y = wasGrounded ? 0 : Math.max( TERMINAL_FALL_SPEED, this.velocity.y - GRAVITY * p.gravityScale * dt );
		const impactSpeed = this.velocity.y;
		const displacement = this.velocity.clone().multiplyScalar( dt );

		// In the air the step covers the average of the vertical speeds at its two ends.
		if ( ! wasGrounded ) displacement.y = ( previousVertical + this.velocity.y ) * 0.5 * dt;

		const result =
			this.clock.held( 'noCollision' ) ? ( this.position.add( displacement ), { grounded: false } ) :
			this.mover.walk( this.position, this.velocity, dt, p, wasGrounded, this.capsule.halfHeight, displacement, this.slides.rotation );

		this.grounded = result.grounded;

		if ( this.grounded ) {

			this.velocity.y = 0;
			this.jumps = 0;

			if ( ! wasGrounded ) {

				this.landings.land( impactSpeed, input );

				return;

			}

			this.setState( this.speed > STILL_SPEED ? ( input.held( 'sprint' ) ? 'sprinting' : 'walking' ) : 'standing' );

		} else {

			if ( this.velocity.y <= 0 ) this.setState( 'falling' );

			if ( wasGrounded ) {

				this.setState( 'falling' );
				this.walkOff();

			}

		}

	}

	/** Off the edge of the floor: a small hop, unless a move, a stunt or a trick has the body. */
	walkOff() {

		if ( this.state === 'sliding' ) this.slides.end();

		if (
			this.motion.moves.busy() ||
			this.stunt ||
			! this.canWalkOff ||
			this.tricks.cartwheeling
		) {

			return;

		}

		this.velocity.setY( 0 ).clampLength( 0, WALK_OFF_MAX_SPEED );
		this.velocity.y = WALK_OFF_HOP;
		this.jumps ++;
		this.motion.moves.play( 'walkOffHop' );
		this.openAirComboSoon();

	}

	/** Leaves the ground along the heading. */
	launch( horizontal, vertical ) {

		this.velocity.copy( this.forward().multiplyScalar( horizontal ) );
		this.velocity.y = vertical;
		this.grounded = false;
		this.jumps ++;
		this.setState( 'rising' );

	}

	/**
	 * Commits to a move for its length (a trick, a roll, a precision jump, a stride): while it plays it owns the
	 * velocity, moving the body by its root motion if its take has one. Options:
	 * - `air`: it flies: gravity applies once it has launched, and a landing ends it;
	 * - `launchDelay`, `onLaunch`: seconds before the launch, and what the launch does;
	 * - `target`, `placeTime`: placed: the body is carried onto `target` over `placeTime`;
	 * - `length`: instead of the move's own length; `rate`: its play rate;
	 * - `ghost`: no collisions while it plays; `onDone`: called when it ends.
	 */
	startStunt( name, options = {} ) {

		const rate = options.rate || 1;

		this.airComboOpen = false;
		this.stunt = {
			name,
			time: 0,
			length: this.motion.length( name ) / rate,
			rootMotion: this.motion.hasRootMotion( name ) || false,
			from: this.position.clone(),
			fromYaw: this.yaw,
			...options,
			rate
		};
		this.setState( options.air ? 'airStunt' : options.target ? 'striding' : ROLLS.has( name ) ? 'rolling' : 'groundStunt' );
		this.motion.moves.play( name, { rate } );
		if ( ! options.air ) this.velocity.set( 0, 0, 0 );

	}

	updateStunt( dt ) {

		const p = this.tuning.values;
		const stunt = this.stunt;
		const previousTime = stunt.time;

		stunt.time = Math.min( stunt.length, stunt.time + dt );
		if ( stunt.launchDelay && previousTime < stunt.launchDelay && stunt.time >= stunt.launchDelay ) stunt.onLaunch?.();

		if ( stunt.target && previousTime < stunt.placeTime ) {

			this.position.copy( stunt.from ).lerp( stunt.target, Math.min( 1, stunt.time / stunt.placeTime ) );

		} else {

			const falling = this.velocity.y;
			const mode = this.grounded ? 'ground' : 'air';
			let hit = stunt.rootMotion ? this.applyRootMotion( dt, mode ) : null;

			if ( ! hit ) {

				const oldVertical = this.velocity.y;

				// No root motion this step (the move is not in charge yet, or any more): the stunt still moves by its
				// take's root between its two times.
				if ( stunt.rootMotion ) {

					const delta = this.motion
						.moveDelta( stunt.name, previousTime * stunt.rate, stunt.time * stunt.rate )
						.multiplyScalar( p.rootMotionScale )
						.applyAxisAngle( UP, this.yaw );

					this.velocity.copy( delta ).divideScalar( dt );
					this.velocity.y = oldVertical;

				}

				if ( mode === 'air' && ( ! stunt.launchDelay || stunt.time >= stunt.launchDelay ) ) {

					this.velocity.y = Math.max( TERMINAL_FALL_SPEED, this.velocity.y - GRAVITY * p.gravityScale * dt );

				} else if ( mode === 'ground' ) {

					this.velocity.y = 0;

				}

				const delta = this.velocity.clone().multiplyScalar( dt );

				// In the air the step covers the average of the vertical speeds at its two ends.
				if ( mode === 'air' ) delta.y = ( oldVertical + this.velocity.y ) * 0.5 * dt;
				hit =
					stunt.ghost || this.clock.held( 'noCollision' ) ? ( this.position.add( delta ), { grounded: false } ) :
					this.mover.walk( this.position, this.velocity, dt, p, this.grounded, this.capsule.halfHeight, delta, this.slides.rotation );

			}

			if ( hit.grounded && stunt.air && stunt.time > ( stunt.launchDelay || 0 ) + AIR_STUNT_LANDS_AFTER ) {

				this.stunt = null;
				this.grounded = true;
				this.landings.land( falling, this.input );

				return;

			}

			this.grounded = hit.grounded;

		}

		if ( stunt.time >= stunt.length ) {

			this.stunt = null;
			this.airComboOpen = false;

			if ( stunt.target ) {

				this.grounded = false;
				this.velocity.set( 0, PLACED_STUNT_SETTLE, 0 );

			}

			this.setState( this.grounded ? 'standing' : 'falling' );
			stunt.onDone?.();

		}

	}

	/** The air combo opens a moment from now (after a takeoff, or the marker of a move that allows one). */
	openAirComboSoon() {

		this.clock.after( AIR_COMBO_DELAY, 'airComboOpen', () => {

			this.airComboOpen = true;

		} );

	}

	/** The jump waits at least this long (s); a longer wait already running stays. */
	holdJump( seconds ) {

		if ( this.time + seconds > this.clock.readyAt( 'jumpLock' ) ) this.clock.hold( 'jumpLock', seconds );

	}

}

export { Runner };
