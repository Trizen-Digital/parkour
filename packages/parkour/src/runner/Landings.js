import { Vector3 } from 'three';
import { floorSlope } from './Slides.js';
import { TRAVERSAL_STATES } from './states.js';
import { CAPSULE } from '../sim/tuning.js';
import { radians } from '../math.js';

const DOWN = new Vector3( 0, - 1, 0 );

// The moves a landing ends (the flips and jumps that last until the ground); a ledge catch ends them too.
const MOVES_ENDED_BY_LANDING = Object.freeze( [
	'frontFlip',
	'sideFlip',
	'spin',
	'heldBackflip',
	'precisionJump',
	'ticTacRight',
	'speedVault',
	'diveOut',
	'skidStop',
	'ticTacLeft',
	'powerJumpOnRight',
	'powerJumpOffLeft',
	'walkOffHop',
	'poleKick',
	'spinFrontFlip',
	'frontFlipRepeat',
	'sideFlipRepeat',
	'vortexRepeat',
	'spinRepeat',
	'standingBackflip'
] );

// A stride lands on its target by design: it never turns into a slide.
const STRIDES = new Set( [ 'strideLeft', 'strideRight' ] );

// Landing speeds (m/s, falling is negative): faster than HARD_LANDING_SPEED is a hard landing, faster than
// BAIL_SPEED a bail unless rolled (or dived), and faster than ROLL_LIMIT even a roll bails.
const HARD_LANDING_SPEED = - 8.5;
const BAIL_SPEED = - 12.5;
const ROLL_LIMIT = - 18.5;
// A floor between these slopes (rad) is too steep to land on standing: the landing becomes a slide.
const SLIDE_SLOPE_MIN = radians( 20 );
const SLIDE_SLOPE_MAX = radians( 70 );
// Landing with slide held and at least this speed forward (m/s) slides on, if there is floor ahead: within
// SLIDE_FLOOR_DROP below the feet SLIDE_FLOOR_AHEAD ahead (m).
const SLIDE_ON_LANDING_SPEED = 3.5;
const SLIDE_FLOOR_AHEAD = 2;
const SLIDE_FLOOR_DROP = 0.5;
// A roll lasts this long (s) before the runner may jump and walk off edges again (a dive roll less), and its roll
// window closes this long into it (s).
const ROLL_TIME = 0.6;
const DIVE_ROLL_TIME = 0.4;
const ROLL_WINDOW_CLOSE = 0.2;
// This long after a landing (s) its precision window closes and the wall abilities come back.
const SETTLE_TIME = 0.15;

// The landing's timers on the runner's clock.
const TIMERS = [ 'resolveLanding', 'landingSettled', 'roll', 'rollWindowEnd', 'rollDone' ];

/**
 * What a landing does. At touchdown (`land`) the runner stands and the flips end; at the start of the next step the
 * landing is judged (`resolve`) by its fall speed, the floor's slope and what the player held: a slide, a roll, a
 * precision landing, a hard landing, a bail, or nothing more. A moment later the landing settles.
 */
class Landings {

	constructor( runner ) {

		this.runner = runner;

		this.reset();

	}

	reset() {

		this.runner.clock.cancel( ...TIMERS );

	}

	/** Touchdown: the runner stands, the flips end, and the landing is judged on the next step. */
	land( fallSpeed, input ) {

		const c = this.runner;

		c.capsule.restore();

		if ( c.clock.held( 'precisionWindow' ) && ! input.held( 'dive' ) && ! input.held( 'slide', 'keys' ) ) c.precision.landed();
		if ( c.tricking ) c.bail.request();

		for ( const name of MOVES_ENDED_BY_LANDING ) c.motion.moves.stop( name );

		if ( c.stunt?.air && ! c.balancing ) c.stunt = null;

		c.events.push( { type: 'camera', name: 'landing', epicenter: c.position.clone() } );

		if ( ! c.clock.held( 'rollWindow' ) && ! c.diving ) c.events.push( { type: 'camera', name: 'viewFree' } );

		c.clock.after( 0, 'resolveLanding', ( stepInput ) => this.resolve( fallSpeed, stepInput ) );
		c.clock.after( SETTLE_TIME, 'landingSettled', () => this.settle() );

		c.jumps = 0;
		c.precisionCharge = 0;
		c.airComboOpen = false;
		c.tricks.resetAir();
		c.plainJump = true;
		c.hangingFree = false;
		c.canMove = true;
		c.clock.release( 'ledgeCatchLock' );
		c.walls.reset();
		c.fromWallRun = c.fromPole = c.kickedOffWall = false;
		c.wallAhead = c.cameraLag = false;

		if ( ! c.stunt && c.state !== 'bailing' ) c.setState( 'standing' );

	}

	resolve( fallSpeed, input ) {

		const c = this.runner;
		const slope = floorSlope( c ).angle;
		const precision = c.clock.held( 'precisionWindow' );
		// A trick that asked for a hard landing asked it of this landing, whatever this landing turns out to be.
		const hard = c.landHard;

		c.landHard = false;

		// Too steep to stand on: slide down it, unless diving or aiming a precision landing.
		if ( slope > SLIDE_SLOPE_MIN && slope < SLIDE_SLOPE_MAX ) {

			if ( c.diving || precision ) {

				c.bail.request();

			} else {

				c.clock.release( 'rollWindow' );
				c.slides.begin();

			}

			return;

		}

		// Slide held at speed, at full height: slide on if there is floor ahead.
		if ( input.held( 'slide' ) && c.velocity.dot( c.forward() ) > SLIDE_ON_LANDING_SPEED && c.capsule.halfHeight === CAPSULE.halfHeight && ! STRIDES.has( c.stunt?.name ) ) {

			if ( fallSpeed < BAIL_SPEED ) {

				c.bail.request();

				return;

			}

			if ( c.diving ) {

				this.resolveDive( fallSpeed );

				return;

			}

			const from = c.position.clone().addScaledVector( c.forward(), SLIDE_FLOOR_AHEAD ).addScaledVector( DOWN, SLIDE_FLOOR_DROP );

			if ( c.queries.ray( from, DOWN, 1 ) ) {

				c.clock.release( 'rollWindow' );
				c.slides.begin();

				return;

			}

		}

		// A trick that asked for a hard landing gets it, unless this is a precision landing or a dive's.
		if ( hard && ! precision && ! c.diving ) this.hardLanding( true );

		if ( c.diving ) {

			this.resolveDive( fallSpeed );

		} else if ( c.clock.held( 'rollWindow' ) ) {

			// Tuck held: roll on the next step if the window is still open then, unless the fall was too fast for any roll.
			if ( fallSpeed > ROLL_LIMIT ) {

				c.clock.after( 0, 'roll', () => {

					if ( ! c.bail.pending && c.state !== 'sliding' && ! c.clock.held( 'precisionWindow' ) && c.clock.held( 'rollWindow' ) ) {

						// A traversal system took the body in the step between (runner.rollComing holds off the moves that
						// could): the roll is dropped rather than started over it. Only off the ground it still rolls: a
						// landing on an edge that lifts off it for a step rolls on onto the top.
						if ( c.ledges.placement || TRAVERSAL_STATES.has( c.state ) ) c.clock.release( 'rollWindow' );
						else this.roll();

					}

				} );

			} else {

				c.bail.request();

			}

		} else if ( fallSpeed > BAIL_SPEED && fallSpeed < HARD_LANDING_SPEED ) {

			if ( ! precision ) this.hardLanding();

		} else if ( fallSpeed > ROLL_LIMIT && fallSpeed < BAIL_SPEED ) {

			if ( ! precision ) c.bail.request();

		} else if ( fallSpeed <= HARD_LANDING_SPEED ) {

			// Past the roll limit (or right on one of the speeds above), a precision landing does not save it.
			c.bail.request();

		}

	}

	resolveDive( fallSpeed ) {

		if ( fallSpeed > BAIL_SPEED ) {

			this.roll( true );

		} else {

			this.runner.bail.request();

		}

	}

	// The landing has settled: its precision window closes, the wall moves come back, and a dive on the ground is over.
	settle() {

		const c = this.runner;

		c.clock.release( 'precisionWindow' );
		c.walls.reset();
		if ( c.grounded ) c.diving = false;

	}

	roll( dive = false ) {

		const c = this.runner;
		const length = dive ? DIVE_ROLL_TIME : ROLL_TIME;

		c.startStunt( dive ? 'diveRoll' : 'landingRoll' );
		c.holdJump( length );
		c.clock.after( length, 'rollDone', () => this.rollDone() );

		if ( ! dive ) {

			c.rolling = c.bailIfAirborne = true;
			c.canWalkOff = false;
			c.clock.after( ROLL_WINDOW_CLOSE, 'rollWindowEnd', () => c.clock.release( 'rollWindow' ) );
			c.events.push( { type: 'camera', name: 'recenterView' } );

		}

		if ( ! c.firstPerson ) c.events.push( { type: 'camera', name: 'roll' } );

		c.events.push( { type: 'camera', name: 'viewOnHead' } );

	}

	// The roll is over: the runner may walk off edges again.
	rollDone() {

		const c = this.runner;

		c.rolling = c.bailIfAirborne = false;
		c.canWalkOff = true;
		c.events.push( { type: 'camera', name: 'viewFree' } );

	}

	// A hard landing: one a trick asked for shakes the camera.
	hardLanding( trick = false ) {

		const c = this.runner;

		c.startStunt( 'hardLanding' );

		if ( trick && ! c.firstPerson ) c.events.push( { type: 'camera', name: 'hardLanding' } );

	}

}

export { Landings, MOVES_ENDED_BY_LANDING };
