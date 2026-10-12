import { DEG, clamp, approach, wrapAngle } from '../math.js';
import { lookDelta, LOOK_GAIN } from '../input/response.js';
import { movementMode } from '../runner/states.js';

// The player's aim: the yaw and pitch the runner steers by. Before the steps it takes the look input (and the field
// of view setting); after them it follows what the runner did: the trick first-person rule, recentring, the aim's
// camera events, turning toward a sideways run, lining up with a wall run. The runner reads `yaw`, so everything
// here is part of the simulation and keeps its arithmetic exactly; the camera body (FollowCamera) only reads it.

// Pitch grows looking down. The look reaches 30° up and 40° down; a bailing runner may look nearly straight down
// at the body.
const PITCH_UP = - 30 * DEG;
const PITCH_DOWN = 40 * DEG;
const PITCH_DOWN_BAILING = 85 * DEG;

// The field of view settings (horizontal) stay in their own ranges; the narrow/widen chord moves them a quarter
// degree a frame, the wheel by its own scale (degrees per notch, from the action table).
const FOV_RANGE = [ 90 * DEG, 140 * DEG ];
const FIRST_PERSON_FOV_RANGE = [ 130 * DEG, 155 * DEG ];
const FOV_STEP = 0.25 * DEG;

// The trick first-person rule is checked on its own 0.1 s cadence, not every frame, so a trick that starts and
// ends between two checks never switches the view; the hair of slack lets a 60 Hz frame clock count as 0.1 s.
const TRICK_CHECK_EVERY = 0.1;
const TRICK_CHECK_SLACK = 1e-10;

// Auto-rotation: below this speed, or moving back this hard, the view is left alone.
const AUTO_TURN_MIN_SPEED = 1.5;
const AUTO_TURN_BACKWARD = - 0.25;

// How strongly the view turns toward a sideways move: little in the air, most on the ground in third person, and
// gently in first person (barely while sliding).
const AUTO_TURN_AIR = 0.1;
const AUTO_TURN_GROUND = 0.85;
const AUTO_TURN_FIRST_PERSON = 0.16;
const AUTO_TURN_FIRST_PERSON_SLIDING = 0.05;

// On a wall run in third person the view lines up with the run (turned 10° toward a wall on the right) and levels
// out.
const WALL_RUN_TURN_RATE = 8.5;
const WALL_RUN_RIGHT_OFFSET = 10 * DEG;

// A 'turnView' event eases the aim round to a yaw and pitch at this rate (1/s), done within TURN_DONE (rad); looking
// about ends it.
const TURN_VIEW_RATE = 6;
const TURN_DONE = 0.2 * DEG;

// The aim's own camera events; every other camera event belongs to the camera body.
const AIM_EVENTS = new Set( [ 'faceView', 'turnView', 'recenterView' ] );

class ViewControl {

	constructor( tuning ) {

		this.tuning = tuning;

		this.yaw = 0;

		this.pitch = 0;

		// A trick stepped out of first person; go back to it once the trick is over.
		this.returnToFirstPerson = false;

		this.lastFirstPerson = false;

		this.trickCheckClock = 0;

		// The frame's input, from look(); update() runs after the steps of the same frame.
		this.input = null;

		// An eased turn of the aim under way ('turnView'): { yaw, pitch } (either null to leave it), or null.
		this.turning = null;

	}

	/**
	 * Faces the view along `yaw`, level.
	 * @param {number} yaw radians
	 */
	reset( yaw = 0 ) {

		this.yaw = yaw;
		this.pitch = 0;
		this.returnToFirstPerson = false;
		this.trickCheckClock = 0;
		this.turning = null;

	}

	recenter( runner ) {

		this.yaw = runner.yaw;
		this.pitch = 0;

	}

	/**
	 * Every frame before the steps: the field of view setting, then the look input turns the aim.
	 * @param {object} input the sampled input
	 * @param {object} runner
	 */
	look( input, runner ) {

		this.input = input;
		this.editFov( input, runner );
		if ( runner.firstPerson && this.firstPersonLookLocked( runner ) ) return;

		// In the air the mouse draws trick gestures; it turns the view only with free look held, and never through
		// a power jump off a ledge.
		const falling = movementMode( runner ) === 'air';
		const mouseLooks = ! falling || ( input.held( 'freeLook' ) && this.playingTake( runner ) !== 'vault_power_off_left' );
		const look = lookDelta( mouseLooks ? input.look.mouse : { x: 0, y: 0 }, input.look.stick, input.dt );

		// A first-person trick turns the body; the view keeps its heading so the trick lands where it was aimed.
		if ( ! ( runner.firstPerson && runner.tricking ) ) this.yaw -= look.x;
		this.pitch = clamp( this.pitch + look.y, PITCH_UP, runner.state === 'bailing' ? PITCH_DOWN_BAILING : PITCH_DOWN );
		if ( look.x || look.y ) this.turning = null;

	}

	/**
	 * Every frame after the steps, in this order: the trick first-person rule, recentring on entering first person,
	 * the aim's camera events, auto-rotation, the wall-run line-up.
	 * @param {number} dt seconds of simulation this frame
	 * @param {object} runner
	 */
	update( dt, runner ) {

		this.checkTrickView( dt, runner );

		if ( runner.firstPerson !== this.lastFirstPerson && runner.firstPerson ) this.recenter( runner );
		this.lastFirstPerson = runner.firstPerson;

		for ( const event of runner.events ) {

			if ( event.type === 'camera' && AIM_EVENTS.has( event.name ) ) this.handle( event, runner );

		}

		this.turnToward( dt );
		this.autoRotate( dt, runner );

		if ( runner.state === 'wallRunning' && ! runner.firstPerson && ! this.stickLooking() ) {

			const target = runner.yaw - ( runner.walls.side === 'right' ? WALL_RUN_RIGHT_OFFSET : 0 );

			this.yaw += wrapAngle( target - this.yaw ) * clamp( dt * WALL_RUN_TURN_RATE, 0, 1 );
			this.pitch = approach( this.pitch, 0, WALL_RUN_TURN_RATE, dt );

		}

	}

	handle( event, runner ) {

		if ( event.name === 'faceView' ) {

			if ( Number.isFinite( event.yaw ) ) this.yaw = event.yaw;
			if ( Number.isFinite( event.pitch ) ) this.pitch = event.pitch;

		} else if ( event.name === 'turnView' ) {

			this.turning = {
				yaw: Number.isFinite( event.yaw ) ? event.yaw : null,
				pitch: Number.isFinite( event.pitch ) ? clamp( event.pitch, PITCH_UP, PITCH_DOWN ) : null
			};

		} else if ( event.name === 'recenterView' && runner.firstPerson ) {

			this.recenter( runner );

		}

	}

	// The eased turn under way, a step nearer; done once the aim is there.
	turnToward( dt ) {

		const turning = this.turning;
		if ( ! turning ) return;

		const share = clamp( dt * TURN_VIEW_RATE, 0, 1 );
		const yawLeft = turning.yaw === null ? 0 : wrapAngle( turning.yaw - this.yaw );
		const pitchLeft = turning.pitch === null ? 0 : turning.pitch - this.pitch;
		this.yaw += yawLeft * share;
		this.pitch += pitchLeft * share;
		if ( Math.abs( yawLeft ) < TURN_DONE && Math.abs( pitchLeft ) < TURN_DONE ) this.turning = null;

	}

	editFov( input, runner ) {

		const key = runner.firstPerson ? 'firstPersonFov' : 'fov';
		const range = runner.firstPerson ? FIRST_PERSON_FOV_RANGE : FOV_RANGE;
		const original = this.tuning.values[ key ];
		let fov = original;

		if ( input.held( 'narrowView' ) ) fov = clamp( fov - FOV_STEP, ...range );
		if ( input.held( 'widenView' ) ) fov = clamp( fov + FOV_STEP, ...range );

		const wheel = input.value( 'zoom' );

		if ( wheel ) fov = clamp( fov - wheel * DEG, ...range );

		// Written through the tuning, so the player's choice is kept.
		if ( fov !== original ) this.tuning.set( key, fov );

	}

	// In first person the view is held still while the body is placed for the player: sliding, vaulting, on a bar,
	// wall running, climbing, hanging, on a zipline, a pipe or a ladder.
	firstPersonLookLocked( runner ) {

		return Boolean(
			runner.state === 'sliding' ||
			runner.vaulting ||
			runner.state === 'onBar' ||
			runner.state === 'wallRunning' ||
			runner.climbingLedge ||
			runner.climbing ||
			runner.state === 'hanging' ||
			runner.state === 'leapingToLedge' ||
			runner.state === 'onZipline' ||
			runner.state === 'onPipe' ||
			runner.state === 'onLadder'
		);

	}

	playingTake( runner ) {

		const move = runner.motion.moves.playing();

		return move ? runner.motion.takeOf( move.name ) : null;

	}

	// With tricks in first person (the preference) a cartwheel that starts in first person comes back to it once
	// it is over; without, any trick steps out to third person to be seen, and comes back once the runner is on
	// its feet again.
	checkTrickView( dt, runner ) {

		this.trickCheckClock += dt;

		while ( this.trickCheckClock >= TRICK_CHECK_EVERY - TRICK_CHECK_SLACK ) {

			this.trickCheckClock -= TRICK_CHECK_EVERY;
			const tricksInFirstPerson = this.input?.preferences?.values.tricksInFirstPerson !== false;
			const falling = movementMode( runner ) === 'air';

			if ( tricksInFirstPerson ) {

				if ( runner.tricks.cartwheeling ) {

					if ( runner.firstPerson ) this.returnToFirstPerson = true;

				} else if ( this.returnToFirstPerson && runner.tricks.largeTrickReady && ! falling ) {

					if ( runner.state !== 'bailing' ) runner.firstPerson = true;
					this.returnToFirstPerson = false;

				}

			} else if ( runner.tricking ) {

				if ( runner.firstPerson ) {

					runner.firstPerson = false;
					this.returnToFirstPerson = true;

				}

			} else if (
				this.returnToFirstPerson &&
				runner.tricks.largeTrickReady &&
				! falling &&
				! runner.rolling &&
				! runner.clock.held( 'rollWindow' ) &&
				runner.state !== 'bailing'
			) {

				runner.firstPerson = true;
				this.returnToFirstPerson = false;

			}

		}

	}

	// The right stick is turning the view: the view's own follow-ups leave it alone.
	stickLooking() {

		const stick = this.input.look.stick;

		return Boolean( stick.x || stick.y );

	}

	// Moving sideways turns the view toward the move, more the more sideways it is, so running round a corner
	// brings the view round with it.
	autoRotate( dt, runner ) {

		const input = this.input;
		const mode = movementMode( runner );
		const right = input.move.x;
		const forward = input.move.y;

		if ( mode === 'guided' || runner.velocity.length() <= AUTO_TURN_MIN_SPEED || forward <= AUTO_TURN_BACKWARD ) return;
		if ( this.stickLooking() ) return;

		let strength;

		if ( mode === 'air' ) {

			// A pad's jump or trick buttons held in the air are steering a trick, not a turn.
			if ( runner.state === 'onZipline' || [ 'jump', 'wheel', 'flip' ].some( ( action ) => input.held( action, 'pad' ) ) ) return;
			strength = AUTO_TURN_AIR;

		} else if ( ! runner.firstPerson ) {

			if (
				runner.state === 'bailing' ||
				runner.state === 'hanging' ||
				runner.state === 'leapingToLedge' ||
				runner.state === 'onZipline' ||
				runner.state === 'sliding'
			) {

				return;

			}

			strength = AUTO_TURN_GROUND;

		} else {

			if ( runner.state === 'hanging' || runner.state === 'leapingToLedge' ) return;
			strength = runner.state === 'sliding' ? AUTO_TURN_FIRST_PERSON_SLIDING : AUTO_TURN_FIRST_PERSON;

		}

		const length = Math.hypot( right, forward );

		if ( ! length ) return;

		const sideways = 1 - Math.abs( forward / length );
		const ratio = clamp( dt * clamp( Math.abs( right ) + Math.abs( forward ), 0, 1 ) * sideways * strength, 0, 1 );

		this.yaw += - Math.atan2( right, forward ) * ratio * LOOK_GAIN;

	}

}

export { ViewControl };
