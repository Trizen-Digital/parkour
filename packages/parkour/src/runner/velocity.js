import { Vector3 } from 'three';
import { clamp } from '../math.js';

// A speed within 1 % of the top speed counts as at it (squared speeds are compared, so 1.01 of the square).
const OVER_TOP = 1.01;
// Braking that brings the runner under this speed (m/s) stops it.
const STOP_SPEED = 0.1;
// An acceleration shorter than a millionth (m/s², compared squared) is no input.
const NO_INPUT = 1e-12;

/**
 * The horizontal velocity after one step of acceleration, friction and braking (the runner's walk, run and air
 * control, and a slide's).
 *
 * With input the velocity turns toward the acceleration's direction at the friction rate, keeping its speed, then
 * accelerates, capped at the top speed (or at the speed it already had above it). Without input, or above the top
 * speed, it brakes; above the top speed and still pushing forward, braking stops at the top speed.
 *
 * @param {Vector3} velocity the current velocity (its vertical part is ignored)
 * @param {Vector3} acceleration m/s², horizontal; zero for no input
 * @param {number} topSpeed m/s
 * @param {number} friction how fast the velocity turns toward the input, per second
 * @param {number} braking m/s²
 * @param {number} dt s
 * @returns {Vector3} the new horizontal velocity (y = 0)
 */
function horizontalVelocity( velocity, acceleration, topSpeed, friction, braking, dt ) {

	const result = new Vector3( velocity.x, 0, velocity.z );
	const oldSpeed = result.length();
	const hasInput = acceleration.lengthSq() > NO_INPUT;
	const overTop = oldSpeed * oldSpeed > topSpeed * topSpeed * OVER_TOP;

	if ( ! hasInput || overTop ) {

		if ( oldSpeed > 0 && braking > 0 ) result.setLength( Math.max( 0, oldSpeed - braking * dt ) );

		if ( overTop && result.length() < topSpeed && acceleration.dot( velocity ) > 0 ) result.copy( velocity ).setY( 0 ).setLength( topSpeed );

		if ( braking > 0 && result.length() < STOP_SPEED ) result.set( 0, 0, 0 );

	} else {

		result.lerp( acceleration.clone().normalize().multiplyScalar( oldSpeed ), clamp( dt * friction, 0, 1 ) );

	}

	if ( hasInput ) {

		const cap = result.lengthSq() > topSpeed * topSpeed * OVER_TOP ? result.length() : topSpeed;

		result.addScaledVector( acceleration, dt );
		if ( result.length() > cap ) result.setLength( cap );

	}

	return result;

}

export { horizontalVelocity };
