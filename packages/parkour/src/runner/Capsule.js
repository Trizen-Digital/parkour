import { clamp } from '../math.js';
import { CAPSULE } from '../sim/tuning.js';

// A flip tucks the runner into a ball: its markers shrink the capsule to this half height (m)...
const COMPACT_HALF_HEIGHT = 0.36;
// ...and grow it back to standing over this long (s), easing in and out.
const RESTORE_TIME = 0.1;

/**
 * The runner's collision capsule: how tall it is right now. The radius never changes; the half height drops for a
 * flip (its markers) or a slide (Slides) and comes back. The mover, the floor search and the catch volumes all use
 * the half height of the moment.
 */
class Capsule {

	constructor() {

		this.reset();

	}

	reset() {

		this.halfHeight = CAPSULE.halfHeight;

		// Seconds into growing back to standing height, or null when not growing.
		this.restoring = null;

	}

	/** Tucks into a ball for a flip. */
	shrink() {

		this.halfHeight = COMPACT_HALF_HEIGHT;
		this.restoring = null;

	}

	/** Starts growing back to standing height (a restore marker, or a landing). */
	restore() {

		this.restoring = 0;

	}

	/** Holds the capsule at a given half height, growing back no more (a slide). */
	lower( halfHeight ) {

		this.halfHeight = halfHeight;
		this.restoring = null;

	}

	/** Back to standing height at once (a slide ends). */
	stand() {

		this.halfHeight = CAPSULE.halfHeight;

	}

	update( dt ) {

		if ( this.restoring === null ) return;

		this.restoring = Math.min( RESTORE_TIME, this.restoring + dt );
		const t = clamp( this.restoring / RESTORE_TIME, 0, 1 );
		const alpha = t * t * ( 3 - 2 * t );

		this.halfHeight += ( CAPSULE.halfHeight - this.halfHeight ) * alpha;
		if ( t === 1 ) this.restoring = null;

	}

}

export { Capsule };
