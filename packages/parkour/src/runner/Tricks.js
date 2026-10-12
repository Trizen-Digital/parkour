import { Vector3 } from 'three';
import { HANGING, movementMode } from './states.js';
import { GRAVITY } from '../sim/tuning.js';

const UP = new Vector3( 0, 1, 0 );

// A cartwheel or a large ground trick needs at least this speed (m/s).
const GROUND_TRICK_MIN_SPEED = 4.5;
// An air trick adds this much to the vertical speed (m/s).
const AIR_TRICK_LIFT = 1.5;
// The arc that times a ground trick leaves rising at this speed (m/s).
const GROUND_ARC_SPEED = 7.25;
// A dive leaves rising at this speed (m/s).
const DIVE_SPEED = 6.25;
// A back flip in the air needs at least this much forward speed (m/s).
const BACKFLIP_MIN_FORWARD = 2.5;
// A cartwheel holds the jump this long (s).
const CARTWHEEL_JUMP_LOCK = 0.7;
// After a ground trick, the next one waits this long (s).
const GROUND_TRICK_REARM = 0.4;
// A spin asked for after a side flip, or during a cartwheel, starts this much later (s).
const SPIN_TRANSFER = 0.15;
// A dive needs this much room above the body's centre (m).
const DIVE_HEADROOM = 1.15;
// A flip-button trick in the air needs no wall this close ahead (m)...
const WALL_CHECK_REACH = 1.25;
// ...swept with a sphere this size (m).
const WALL_CHECK_RADIUS = 0.35;
// The arc that times a trick to its landing: a sphere this size (m)...
const ARC_RADIUS = 0.1;
// ...stepped this many times a second...
const ARC_STEPS_PER_SECOND = 15;
// ...for at most this long (s), where steps that sum to within ARC_TIME_SLACK (s) of it count as there (no sliver of
// a step after the last)...
const ARC_MAX_TIME = 2;
const ARC_TIME_SLACK = 1e-10;
// ...from this far below the capsule's centre (m).
const ARC_START_DROP = - 0.45;

// The tricks' timers and holds on the runner's clock: the cartwheel's cooldown (a slide holds it) is a hold.
const TIMERS = [ 'cartwheelCooldown', 'spinTransfer', 'cartwheelEnd', 'groundTrickRearm' ];

// The moves a spin breaks off: a spin asked for during one waits SPIN_TRANSFER, then stops it.
const SPIN_BREAKS = [ 'cartwheel' ];
// The air back flips by the gesture's direction (to the left there is none).
const BACKFLIPS = { up: 'runningBackflip', down: 'layoutBackflip', right: 'heldBackflip' };

/**
 * Tricks: on the ground (the cartwheel, the dive) and in the air (side flip, vortex, back cork, spin, front flips,
 * dives, back flips), picked by the trick buttons and the gesture's direction. A trick is a stunt (the runner's
 * committed move) that keeps the speed it started with.
 */
class Tricks {

	constructor( runner ) {

		this.runner = runner;
		this.reset();

	}

	reset() {

		this.resetAir();
		this.runner.clock.cancel( ...TIMERS );

		// Whether a cartwheel and the large tricks may start (once the trick before has rearmed them).
		this.cartwheelReady = this.largeTrickReady = true;
		this.cartwheeling = false;

		this.runner.jumpLocked = false;

	}

	// The air tricks done since the last landing or catch: a second of a kind plays its repeat.
	resetAir() {

		this.counts = { sideflip: 0, vortex: 0, frontflip: 0, spin: 0 };

	}

	update() {

		const c = this.runner;

		// A cartwheel that leaves the ground before its time is a fall.
		if ( c.bailIfAirborne && this.isFalling() && SPIN_BREAKS.includes( this.playing() ) ) c.bail.request( false );

	}

	// ---- In the air

	airTrickAllowed( input ) {

		const c = this.runner;

		return (
			this.isFalling() &&
			c.airComboOpen &&
			this.playing() !== 'diveOut' &&
			! HANGING.has( c.state ) &&
			c.state !== 'sliding' &&
			! input.held( 'precision', 'pad' ) &&
			! c.wallAhead &&
			! c.bail.pending &&
			c.state !== 'bailing'
		);

	}

	/** An air trick, if the combo is open and a trick button and a direction ask for one: true if it started. */
	air( input ) {

		const c = this.runner;

		if ( ! this.airTrickAllowed( input ) ) return false;

		const gesture = ( direction ) => c.trickGesture.has( direction );
		const triggered = ( action ) => input.held( action ) || input.pressed( action );
		const playing = this.playing();
		const backflip = this.tryBackflip( input, true );

		if ( backflip !== null ) return backflip;

		if ( triggered( 'flip' ) && ! this.wallAhead() ) {

			if ( gesture( 'up' ) ) return this.startAir( ++ this.counts.sideflip === 1 ? 'sideFlip' : 'sideFlipRepeat', { shake: 'jump' } );
			if ( gesture( 'right' ) ) return this.startAir( ++ this.counts.vortex === 1 ? 'vortex' : 'vortexRepeat', { shake: 'jump' } );

			if ( gesture( 'down' ) ) {

				c.landHard = true;

				return this.startAir( 'backCork', { rate: true } );

			}

			if ( gesture( 'left' ) ) {

				c.airComboOpen = false;

				// After a side flip, or out of a cartwheel, the spin waits a moment.
				if ( this.counts.sideflip > 0 || SPIN_BREAKS.includes( playing ) ) {

					c.clock.after( SPIN_TRANSFER, 'spinTransfer', () => {

						if ( SPIN_BREAKS.includes( playing ) ) {

							for ( const name of SPIN_BREAKS ) c.motion.moves.stop( name );

						}

						this.startSpin();

					} );

					return false;

				}

				return this.startSpin();

			}

		}

		if ( triggered( 'wheel' ) ) {

			if ( gesture( 'up' ) ) {

				const first = ++ this.counts.frontflip === 1 && this.counts.sideflip === 0;

				return this.startAir( first ? 'frontFlip' : 'frontFlipRepeat', { shake: 'jump' } );

			}

			if ( gesture( 'down' ) ) return this.startAir( 'diveFrontFlip', { rate: true } );
			if ( gesture( 'left' ) ) return this.startAir( 'deathDive' );
			if ( gesture( 'right' ) && ! [ 'sideFlip', ...SPIN_BREAKS ].includes( playing ) ) return this.startAir( 'spinFrontFlip', { rate: true } );

		}

		return this.tryBackflip( input, false ) ?? false;

	}

	// An air back flip: by the jump press (onJump: with a direction, or a hard sideways push on the pad with jump held),
	// or by the back flip button. Null when nothing asks for one; false when one is asked for too soon after getting up.
	tryBackflip( input, onJump ) {

		const c = this.runner;

		if ( input.held( 'grab', 'pad' ) || input.held( 'jump', 'keys' ) || c.velocity.dot( c.forward() ) <= BACKFLIP_MIN_FORWARD ) return null;

		const gesture = ( direction ) => c.trickGesture.has( direction );
		let direction;

		if ( onJump ) {

			if ( input.pressed( 'jump' ) ) direction = [ 'right', 'up', 'down' ].find( gesture );
			const lateral = Number( input.value( 'stickSide' ) || 0 );

			if ( ! direction && input.pressed( 'stickSide' ) && input.held( 'jump', 'pad' ) && lateral > 0 ) direction = 'right';

		} else if ( input.held( 'backflip' ) || input.pressed( 'backflip' ) ) {

			direction = [ 'right', 'down', 'up' ].find( gesture );

		}

		if ( ! direction ) return null;
		c.airComboOpen = false;
		if ( c.clock.held( 'airTrickLock' ) ) return false;

		return this.startAir( BACKFLIPS[ direction ], { rate: true } );

	}

	// An air trick lifts the runner and, timed (rate) or not, plays to its landing.
	startAir( name, { rate = false, shake = 'cartwheel' } = {} ) {

		const c = this.runner;

		c.airComboOpen = false;
		this.launch( AIR_TRICK_LIFT, true );
		this.play( name, { air: true, rate: rate ? this.animationRate( false ) : 1 } );
		this.shake( shake );

		return true;

	}

	startSpin() {

		const name = ++ this.counts.spin === 1 ? 'spin' : 'spinRepeat';

		this.counts.sideflip = 0;

		return this.startAir( name, { shake: 'jump' } );

	}

	// A sphere swept ahead: a flip needs the room.
	wallAhead() {

		const c = this.runner;

		return c.queries.sphereCast( c.position, c.position.clone().addScaledVector( c.forward(), WALL_CHECK_REACH ), WALL_CHECK_RADIUS, { group: 'probe' } );

	}

	// ---- On the ground

	/** A ground trick, if one is asked for and allowed: true if it started. */
	ground( input ) {

		const c = this.runner;

		if ( this.isFalling() || this.isFlying() || c.bail.pending || c.state === 'bailing' ) return false;

		const leftShoulder = input.held( 'precision', 'pad' );

		if ( input.pressed( 'wheel' ) && this.cartwheelAllowed( input ) ) return this.startCartwheel();
		if ( ! this.largeTrickAllowed( input ) || leftShoulder || this.playing() || c.queries.ray( c.position, UP, DIVE_HEADROOM, 'probe' ) ) return false;
		if ( ( ! c.clock.held( 'rollWindow' ) && input.released( 'dive' ) ) || input.held( 'spinDive' ) ) return this.startDive( input.held( 'spinDive' ) );

		return false;

	}

	cartwheelAllowed( input ) {

		const c = this.runner;

		return (
			c.velocity.length() > GROUND_TRICK_MIN_SPEED &&
			! input.held( 'grab', 'keys' ) &&
			! input.held( 'precision', 'pad' ) &&
			! c.clock.held( 'cartwheelCooldown' ) &&
			this.cartwheelReady &&
			c.state !== 'sliding' &&
			! this.isFalling() &&
			! this.isFlying() &&
			this.jumpReady() &&
			! input.held( 'grab', 'pad' ) &&
			! ( c.climbing && c.vaulting && c.tricking )
		);

	}

	largeTrickAllowed( input ) {

		const c = this.runner;

		return (
			c.velocity.length() > GROUND_TRICK_MIN_SPEED &&
			input.held( 'sprint' ) &&
			c.state !== 'sliding' &&
			! c.climbing &&
			! this.isFalling() &&
			c.jumps < 1 &&
			! input.held( 'grab' ) &&
			this.largeTrickReady &&
			this.jumpReady()
		);

	}

	startCartwheel() {

		const c = this.runner;

		this.cartwheelReady = this.largeTrickReady = false;
		this.cartwheeling = true;
		c.bailIfAirborne = true;
		this.lockJump( CARTWHEEL_JUMP_LOCK );
		this.play( 'cartwheel' );
		this.shake( 'jump', true );
		c.clock.after( CARTWHEEL_JUMP_LOCK, 'cartwheelEnd', () => {

			this.cartwheeling = false;
			c.bailIfAirborne = false;
			c.jumpLocked = false;
			this.rearmGroundTrick();

		} );

		return true;

	}

	startDive( spin ) {

		const c = this.runner;

		this.launch( DIVE_SPEED );
		this.play( spin ? 'spinDiveRoll' : 'diveOut', { air: true, rate: this.animationRate( true ) } );
		c.diving = true;
		c.jumps ++;
		this.shake( 'trick' );
		this.shake( 'landing', true );
		this.rearmGroundTrick();

		return true;

	}

	// The next ground trick waits GROUND_TRICK_REARM; the large tricks too, unless a fall would still bail.
	rearmGroundTrick() {

		const c = this.runner;

		c.clock.after( GROUND_TRICK_REARM, 'groundTrickRearm', () => {

			this.cartwheelReady = true;

			if ( ! c.bailIfAirborne ) {

				this.largeTrickReady = true;
				this.event( 'camera', 'viewFree' );

			}

		} );

	}

	lockJump( seconds ) {

		const c = this.runner;

		c.jumpLocked = true;
		c.holdJump( seconds );

	}

	jumpReady() {

		const c = this.runner;

		return ! c.jumpLocked && ! c.clock.held( 'jumpLock' );

	}

	// ---- Shared

	/**
	 * The play rate that fits a trick to its flight: the arc from the launch (or the velocity given) is stepped until
	 * it hits something; a flight longer than a second slows the trick to fill it, and a trick never plays faster than
	 * its own pace.
	 */
	animationRate( fromGround, launchVelocity = null ) {

		const c = this.runner;
		const velocity = ( launchVelocity || c.velocity ).clone();

		if ( fromGround ) velocity.y = GROUND_ARC_SPEED;
		let point = c.position.clone().addScaledVector( UP, ARC_START_DROP );
		const gravity = - GRAVITY * c.tuning.values.gravityScale;
		const step = 1 / ARC_STEPS_PER_SECOND;
		let elapsed = 0;

		while ( elapsed < ARC_MAX_TIME - ARC_TIME_SLACK ) {

			const dt = Math.min( step, ARC_MAX_TIME - elapsed );
			const next = point.clone().addScaledVector( velocity, dt ).addScaledVector( UP, 0.5 * gravity * dt * dt );
			const hit = c.queries.sphereCast( point, next, ARC_RADIUS, { group: 'movement' } );

			elapsed += dt;
			if ( hit ) break;
			velocity.y += gravity * dt;
			point = next;

		}

		const adjusted = 1 / elapsed;

		return adjusted > 1 ? 1 : adjusted;

	}

	// A trick is a stunt that keeps the speed it started with.
	play( name, options = {} ) {

		const c = this.runner;
		const velocity = c.velocity.clone();

		c.startStunt( name, options );
		c.velocity.copy( velocity );

	}

	launch( vertical, additive = false ) {

		const c = this.runner;

		c.velocity.y = additive ? c.velocity.y + vertical : vertical;
		c.grounded = false;

	}

	// The move playing (not blending out), or null.
	playing() {

		return this.runner.motion.moves.playing()?.name ?? null;

	}

	isFlying() {

		return movementMode( this.runner ) === 'guided';

	}

	isFalling() {

		return movementMode( this.runner ) === 'air';

	}

	event( type, name, options = {} ) {

		this.runner.events.push( { type, name, ...options } );

	}

	// A camera shake: at the runner in the world, or on the camera itself.
	shake( name, atRunner = false ) {

		this.event( 'camera', name, atRunner ? { epicenter: this.runner.position.clone() } : {} );

	}

}

export { Tricks };
