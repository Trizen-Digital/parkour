import { clamp } from '../math.js';

// The curves blends follow, and the spring that eases blend weights and inputs.

/**
 * A blend's progress along its curve: `linear`, `smoothstep` (slow at both ends; the graph's cross-fades) or
 * `circleOut` (a quarter circle that starts fast).
 * @param {number} x how far through the blend, clamped to 0…1
 * @param {string} [curve]
 */
function ease( x, curve = 'linear' ) {

	x = clamp( x, 0, 1 );

	switch ( curve ) {

		case 'smoothstep':
			return x * x * ( 3 - 2 * x );
		case 'circleOut':
			return Math.sqrt( 1 - ( x - 1 ) ** 2 );
		default:
			return x;

	}

}

/**
 * One step of a critically damped spring pulling `value` toward `target`: it closes in without overshooting, and
 * keeps its rate from step to step so a moving target is followed smoothly. `speed` (1/s) sets how fast; 0 or less
 * snaps to the target.
 * @returns {{ value: number, rate: number }}
 */
function springTowards( value, rate, target, dt, speed ) {

	if ( speed <= 0 ) return { value: target, rate: 0 };

	// The spring's time constant is 1 / (e · speed); its decay over the step, e^-a, by a cubic approximation that holds
	// for any step length.
	const time = 1 / ( Math.E * speed ), w = 2 / time, a = w * dt;
	const decay = 1 / ( 1 + 1.00746054 * a + 0.45053901 * a * a + 0.25724632 * a * a * a );
	const offset = value - target, b = ( rate + offset * w ) * dt;

	return {
		value: target + ( offset + b ) * decay,
		rate: ( rate - b * w ) * decay
	};

}

export { ease, springTowards };
