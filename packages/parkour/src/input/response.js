// Response curves: how far a stick has to travel before it counts and how its reading grows from there, and how mouse
// counts and stick travel become turns of the view. Similar to the look system in Skate described in conversations.

import { clamp, radians } from '../math.js';

/**
 * One axis through a dead zone: nothing up to `deadZone`, then growing to 1 at `full`, times `max`, with the
 * reading's sign. `scale` multiplies the raw reading first.
 */
function axisResponse( value, { scale = 1, deadZone = 0, full = 1, max = 1 } = {} ) {

	const reading = value * scale;

	return Math.sign( reading ) * clamp( ( Math.abs( reading ) - deadZone ) / ( full - deadZone ), 0, 1 ) * max;

}

/**
 * A stick through a round dead zone: its direction kept, its length nothing up to `deadZone`, then growing to 1 at
 * `full`, times `max`. `scale` multiplies the raw reading first.
 */
function stickResponse( x, y, { scale = 1, deadZone = 0, full = 1, max = 1 } = {} ) {

	const sx = x * scale, sy = y * scale;
	const length = Math.hypot( sx, sy );

	if ( length <= deadZone ) return { x: 0, y: 0 };

	const stretch = Math.min( 1, ( length - deadZone ) / ( full - deadZone ) ) / length;

	return { x: sx * stretch * max, y: sy * stretch * max };

}

/** Mouse counts as a turn of the view, in radians: `sensitivity` degrees a count. */
function mouseLook( x, y, sensitivity ) {

	return { x: radians( x * sensitivity ), y: radians( y * sensitivity ) };

}

// The look stick's travel is halved before its dead zone, which spans the whole travel: a full push turns the view at
// 3/8 of the look rate with the dead zone at 0.2, a gentle look for a thumb.
const LOOK_STICK_SCALE = 0.5;

/** The right stick (y up) as a turn of the view over `dt` seconds, in radians: `rate` radians a second at full push. */
function stickLook( x, y, dt, rate, deadZone ) {

	const stick = stickResponse( x, y, { scale: LOOK_STICK_SCALE, deadZone } );
	const turn = rate * dt;

	return { x: stick.x * turn, y: stick.y * turn };

}

// The view turns by the look times this gain; the mouse's yaw is first held to 150° a second (2.5° a frame at 60
// frames a second), so a flick of the mouse cannot spin the view round, and the fastest turn is the same at any frame
// rate.
const LOOK_GAIN = 2.5;
const MOUSE_YAW_RATE = radians( 150 );

/** How far the view turns over a frame of `dt` seconds for a mouse and a stick look (radians). */
function lookDelta( mouse, stick, dt ) {

	const limit = MOUSE_YAW_RATE * dt;
	const yaw = clamp( mouse.x, - limit, limit );

	return { x: ( yaw + stick.x ) * LOOK_GAIN, y: ( mouse.y + stick.y ) * LOOK_GAIN };

}

export { axisResponse, stickResponse, mouseLook, stickLook, lookDelta, LOOK_GAIN, MOUSE_YAW_RATE };
