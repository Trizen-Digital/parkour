const NONE = Object.freeze( { up: false, down: false, left: false, right: false } );

// A mouse flick past this many counts in a frame is a wild swing, not a trick gesture.
const MOUSE_FLICK_LIMIT = 25;

/**
 * Which way the player is pointing a trick: a flick of the left stick in the air or on a ledge, or of the mouse in the
 * air. Tricks pick their move by it; a hang reads the stick's up to climb.
 */
class TrickGesture {

	constructor( runner ) {

		this.runner = runner;

		this.reset();

	}

	reset() {

		this.mouse = { ...NONE };
		this.stick = { ...NONE };

	}

	update( input ) {

		const c = this.runner;
		const tuning = c.tuning.values;
		const falling = ! c.grounded;
		const hanging = c.state === 'hanging';
		const stick = input.value( 'stick' );

		// The stick's direction is read afresh every step: a flick past the threshold, in four sectors (the sideways ones
		// trickSideSector either side of the horizontal, in radians).
		if ( stick && typeof stick === 'object' ) {

			this.stick = { ...NONE };

			if ( ( falling || hanging ) && Math.hypot( stick.x, stick.y ) > tuning.trickStickFlick ) {

				const angle = Math.atan2( stick.y, stick.x );
				const side = tuning.trickSideSector;
				const direction =
					Math.abs( angle ) < side ? 'right' :
					Math.abs( angle ) > Math.PI - side ? 'left' :
					angle > 0 ? 'up' :
					'down';

				this.stick[ direction ] = true;

			}

		}

		// A mouse flick in the air sets each direction on its own; a still mouse keeps the last flick.
		const mouse = input.value( 'mouseFlick' );

		if ( falling && mouse && ( mouse.x || mouse.y ) ) {

			const threshold = tuning.trickMouseFlick;

			this.mouse.left = mouse.x > - MOUSE_FLICK_LIMIT && mouse.x < - threshold;
			this.mouse.right = mouse.x < MOUSE_FLICK_LIMIT && mouse.x > threshold;
			this.mouse.up = mouse.y < MOUSE_FLICK_LIMIT && mouse.y > threshold;
			this.mouse.down = mouse.y > - MOUSE_FLICK_LIMIT && mouse.y < - threshold;

		}

	}

	/** Pointed this way ('up', 'down', 'left' or 'right') by the stick or the mouse. */
	has( direction ) {

		return this.mouse[ direction ] || this.stick[ direction ];

	}

}

export { TrickGesture };
