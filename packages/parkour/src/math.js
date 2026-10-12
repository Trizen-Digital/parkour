// Small numeric helpers shared across the game. Angles are radians; DEG turns a degree a person reads or types
// into radians where it enters the code.

/** One degree in radians: `65 * DEG`. */
const DEG = Math.PI / 180;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number} value held inside [min, max]
 */
function clamp( value, min, max ) {

	return Math.max( min, Math.min( max, value ) );

}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} alpha 0 gives a, 1 gives b
 * @returns {number}
 */
function lerp( a, b, alpha ) {

	return a + ( b - a ) * alpha;

}

/**
 * Degrees to radians as `degrees · π / 180`, which can differ from `degrees * DEG` in the last bit.
 * @param {number} degrees
 * @returns {number}
 */
function radians( degrees ) {

	return ( degrees * Math.PI ) / 180;

}

/**
 * Radians to degrees, for a person to read.
 * @param {number} angle
 * @returns {number}
 */
function degrees( angle ) {

	return ( angle * 180 ) / Math.PI;

}

/**
 * @param {number} angle (rad)
 * @returns {number} the same direction in (−π, π]
 */
function wrapAngle( angle ) {

	return Math.atan2( Math.sin( angle ), Math.cos( angle ) );

}

/**
 * Moves a value toward a target by `rate · dt` of the gap, at most all of it.
 * @param {number} value
 * @param {number} target
 * @param {number} rate (1/s)
 * @param {number} dt (s)
 * @returns {number}
 */
function approach( value, target, rate, dt ) {

	return lerp( value, target, clamp( rate * dt, 0, 1 ) );

}

export { DEG, clamp, lerp, radians, degrees, wrapAngle, approach };
