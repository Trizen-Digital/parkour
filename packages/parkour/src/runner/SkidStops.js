// Held to something: not falling, whatever the floor says. Not a rope: the body swings on it, and no skid plays there.
const HELD = new Set( [ 'hanging', 'catchingLedge', 'leapingToLedge', 'climbingUp', 'vaulting', 'onPole', 'onBar', 'wallRunning', 'onPipe', 'onLadder', 'toppingOut', 'onZipline' ] );

// Letting go of the stick faster than this along either ground axis (m/s) skids.
const SKID_SPEED = 2.5;
// After a stride the stick cannot cut its skid short for this long (s).
const STRIDE_STICK_LOCK = 0.45;

/**
 * The skid stop: letting go of the stick at running speed plays the skid once, until the stick moves again. Moving
 * the stick or falling cuts it short. A stride ends in a skid too, which the stick cannot cut short for a moment (the
 * clock's skidStopLock).
 */
class SkidStops {

	constructor( runner ) {

		this.runner = runner;
		this.reset();

	}

	reset() {

		// Skidded since the stick was let go.
		this.skidded = false;
		this.runner.clock.release( 'skidStopLock' );

	}

	everyStep( input ) {

		const c = this.runner;

		if ( ! c.grounded && ! HELD.has( c.state ) && c.state !== 'bailing' ) {

			this.stop();

			return;

		}

		if ( input.move.y !== 0 || input.move.x !== 0 ) {

			if ( ! c.clock.held( 'skidStopLock' ) ) {

				this.stop();
				this.skidded = false;

			}

			return;

		}

		if ( c.clock.held( 'rollWindow' ) || c.vaulting || c.state === 'hanging' || c.state === 'leapingToLedge' || c.climbingLedge || c.motion.moves.playing() ) return;
		if ( Math.abs( c.velocity.x ) <= SKID_SPEED && Math.abs( c.velocity.z ) <= SKID_SPEED ) return;
		if ( this.skidded ) return;

		this.skidded = true;
		this.play();

	}

	/** A stride has ended: it skids to a stop, which the stick cannot cut short for a moment. */
	strideCompleted( input = this.runner.input ) {

		const c = this.runner;
		const skid = c.clock.held( 'rollWindow' ) || c.clock.held( 'precisionWindow' ) || input?.held( 'sprint' ) ? null : this.play();

		c.clock.hold( 'skidStopLock', STRIDE_STICK_LOCK );

		return skid;

	}

	// No skid in a slide or in first person.
	play() {

		const c = this.runner;

		if ( c.state === 'sliding' || c.firstPerson ) return null;

		return c.motion.moves.play( 'skidStop' );

	}

	stop() {

		this.runner.motion.moves.stop( 'skidStop' );

	}

}

export { SkidStops };
