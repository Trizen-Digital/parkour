import { Vector3 } from 'three';
import { ON_LEDGE } from './states.js';
import { CAPSULE } from '../sim/tuning.js';

const DOWN = new Vector3( 0, - 1, 0 );
// From the body's centre down to the feet, and from the floor back up to the centre: the capsule's half height.
const TO_FEET = new Vector3( 0, - CAPSULE.halfHeight, 0 );
const TO_HIPS = new Vector3( 0, CAPSULE.halfHeight, 0 );

// A bail asked for by the player goes limp this long after the press (s), once the dive out has started; one the
// game decides (a fatal fall, a botched landing, a stumble, a catch too fast to hold, no room for a trick) goes limp
// sooner.
const PLAYER_DELAY = 0.205;
const GAME_DELAY = 0.05;
// The player's bail asked for on the ground hops the runner up at this speed (m/s) into its dive.
const PLAYER_HOP = 2;
// Getting up: not before this long in the ragdoll (s), only with the body nearly still (m/s), and this long after the
// press (s). The runner stands on the floor found within this distance below the feet (m).
const GET_UP_LOCK = 0.2;
const GET_UP_MAX_SPEED = 1.5;
const GET_UP_DELAY = 0.05;
const FLOOR_SEARCH = 4.65;
// After getting up, the air tricks that start from a jump wait this long (s).
const AIR_TRICK_LOCK = 0.7;
// Getting up stands the runner on the floor through a step in the air: for this long (s) the stand-up key still held
// (Space, the jump and tuck key) does not arm a landing roll for that touchdown.
const GET_UP_SETTLE = 0.1;

/**
 * Going limp and getting up again. A bail is requested (by the player, or by the game: a fatal fall, a botched landing
 * or catch), starts a moment later (the clock's `bail` timer) unless the runner is then holding on to something, and
 * hands the body to the ragdoll (Simulation sees the bailing state). Getting up stands the runner on the floor under
 * the body (`getUpSettle`: the stand-up key held on does not roll that touchdown).
 *
 * While the ragdoll has the body the runner's step does not run, so neither does its clock: the get-up reads holds,
 * which read right as the time moves on (`getUpLock` from the bail's start, `getUpDelay` from the press).
 */
class Bail {

	constructor( runner ) {

		this.runner = runner;

	}

	reset() {

		this.runner.clock.cancel( 'bail', 'getUpLock', 'getUpDelay', 'getUpSettle' );
		// Where the runner stands once it gets up (found at the press), or null.
		this.standAt = null;

	}

	/** A bail asked for, waiting to start. */
	get pending() {

		return this.runner.clock.pending( 'bail' );

	}

	/**
	 * Asks for a bail, unless one is under way.
	 * @param {boolean} [byPlayer] the player's own (the go-limp press): it may be refused, hops off the ground into a
	 *   dive and waits for it; else the game's
	 * @returns {boolean} whether it was taken
	 */
	request( byPlayer = false ) {

		const c = this.runner;

		if ( c.state === 'bailing' || this.pending ) return false;

		// The player cannot let go while climbing, hanging or riding a zipline.
		if ( byPlayer && ( c.climbingLedge || c.climbing || ON_LEDGE.has( c.state ) || c.state === 'onZipline' ) ) return false;

		if ( byPlayer ) {

			c.precision.reset();
			c.clock.release( 'precisionWindow', 'rollWindow' );
			if ( c.polesAndBars.attachment?.kind === 'pole' ) c.polesAndBars.letGo( c.input );

			if ( c.grounded ) {

				c.velocity.y = PLAYER_HOP;
				c.grounded = false;
				if ( ! c.motion.moves.playing() ) c.motion.moves.play( 'diveOut' );

			}

		}

		c.clock.after( byPlayer ? PLAYER_DELAY : GAME_DELAY, 'bail', () => this.start() );

		return true;

	}

	// The bail comes due: the runner goes limp, unless it now holds a ledge, climbs or vaults (then it is called off).
	start() {

		const c = this.runner;

		if ( c.climbingLedge || ON_LEDGE.has( c.state ) || c.climbing || c.vaulting ) return;

		if ( c.state === 'sliding' ) c.slides.end();
		c.clock.hold( 'getUpLock', GET_UP_LOCK );

		c.stunt = null;
		c.sprinting = c.tricking = c.rolling = false;
		c.landHard = c.bailIfAirborne = false;
		c.balancing = c.diving = false;
		c.pace = 'walk';
		// What the body was timing ends with it: the landing windows, a ghosted move, the air combo's opening, and the
		// systems' own timers (the ledges' run on).
		c.clock.release( 'precisionWindow', 'rollWindow', 'noCollision' );
		c.clock.cancel( 'airComboOpen' );
		c.precision.reset();
		c.landings.reset();
		c.pipesAndZiplines.reset();
		c.polesAndBars.reset();
		c.slides.reset();
		c.capsule.reset();
		c.tricks.reset();
		c.walls.reset();
		c.events.push( { type: 'camera', name: 'viewOnHead' } );
		c.setState( 'bailing' );

	}

	/** While the ragdoll has the body: true once the runner has got up (standUp held, the body nearly still). */
	getUp( input ) {

		const c = this.runner;

		if ( ! this.standAt && input.held( 'standUp' ) && ! c.clock.held( 'getUpLock' ) && c.velocity.length() < GET_UP_MAX_SPEED ) {

			const floor = c.queries.ray( c.position.clone().add( TO_FEET ), DOWN, FLOOR_SEARCH, 'probe' );

			this.standAt = floor ? floor.point.clone().add( TO_HIPS ) : c.position.clone();
			c.clock.hold( 'getUpDelay', GET_UP_DELAY );

		}

		if ( ! this.standAt || c.clock.held( 'getUpDelay' ) ) return false;

		c.position.copy( this.standAt );
		c.previousPosition.copy( c.position );
		c.velocity.set( 0, 0, 0 );
		c.jumps = 0;
		c.canMove = c.precisionAllowed = c.canWalkOff = true;
		c.clock.release( 'jumpLock' );
		c.jumpLocked = false;
		c.bailIfAirborne = false;
		c.motion.moves.stop( undefined, 0 );
		c.grounded = c.slowMotion = false;
		c.clock.hold( 'airTrickLock', AIR_TRICK_LOCK );
		c.capsule.reset();
		c.clock.cancel( 'airComboOpen' );
		c.tricks.reset();
		c.walls.reset();
		c.setState( 'falling' );
		c.events.push( { type: 'camera', name: 'viewFree' } );
		this.reset();
		// Set after the reset, which cancels it.
		c.clock.release( 'rollWindow' );
		c.clock.hold( 'getUpSettle', GET_UP_SETTLE );

		return true;

	}

}

export { Bail };
