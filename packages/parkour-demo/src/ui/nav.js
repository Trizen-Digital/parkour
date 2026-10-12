// The menus' input: the keyboard and the gamepad as menu moves (up, down, left, right, select, back, the previous and
// next tab, alt, x, start; any other key as 'key', with its code), sent to the screen that has the menus. It also
// keeps what is held, so play goes on only once every key and button is let go: the press that closed a menu never
// reaches the run.
//
// And it follows the device in use (ui.device), the last one touched: a key or the mouse makes it the keyboard, a pad's
// button or stick the pad, a finger (or a pen) on the screen touch, which puts the touch controls on. Pointers are
// told apart by their type, so the mouse events a browser makes up from a tap never count as the mouse.

import { ui } from './state.svelte.js';

const KEYS = {
	ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
	Enter: 'select', NumpadEnter: 'select', Space: 'select', Escape: 'back', Backspace: 'back', KeyQ: 'previous', KeyE: 'next', KeyR: 'alt',
};

// The standard pad's buttons by index: A, B, X, Y, LB, RB, Menu and the d-pad.
const PAD = { 0: 'select', 1: 'back', 2: 'x', 3: 'alt', 4: 'previous', 5: 'next', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

const DIRECTIONS = new Set( [ 'up', 'down', 'left', 'right' ] );

// The device in use by a pointer's type.
const POINTERS = { mouse: 'keyboard', touch: 'touch', pen: 'touch' };

// A held direction repeats after this long (ms), then this often.
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 110;

// The left stick counts as pushed past this much of its travel.
const STICK = 0.5;

const held = new Set();
let padHeld = false, padBefore = [], repeat = null, handler = null;

/**
 * Gives the menu moves to a screen until the returned function is called.
 * @param {(move: string, detail: {code: string|null, shift: boolean}) => boolean} fn true when it used the move
 * @returns {() => void}
 */
function takeMoves( fn ) {

	handler = fn;
	return () => {

		if ( handler === fn ) handler = null;

	};

}

/** @returns {boolean} whether no key and no pad button is held */
function idle() {

	return held.size === 0 && ! padHeld;

}

const editable = ( target ) => target?.closest?.( 'input, textarea, select, [contenteditable]' );

function send( move, detail ) {

	return handler ? handler( move, detail ) : false;

}

addEventListener( 'keydown', ( event ) => {

	held.add( event.code );
	if ( ui.device !== 'keyboard' ) ui.device = 'keyboard';
	if ( ! handler ) return;
	if ( editable( event.target ) ) {

		// After the field's own keys have had it (Escape may cancel an edit first).
		if ( event.key === 'Escape' ) setTimeout( () => event.target.blur() );
		return;

	}

	const move = KEYS[ event.code ] ?? 'key';
	if ( event.repeat && ! DIRECTIONS.has( move ) ) return;
	if ( send( move, { code: event.code, shift: event.shiftKey } ) ) event.preventDefault();

}, true );

addEventListener( 'keyup', ( event ) => held.delete( event.code ), true );
addEventListener( 'blur', () => held.clear() );

// Before anything under the pointer has it (a touch control keeps its own presses to itself).
for ( const type of [ 'pointerdown', 'pointermove' ] ) {

	addEventListener( type, ( event ) => {

		const device = POINTERS[ event.pointerType ];
		if ( device && ui.device !== device ) ui.device = device;

	}, true );

}

function connectedPad() {

	return [ ...( navigator.getGamepads?.() ?? [] ) ].find( ( pad ) => pad?.connected && pad.mapping === 'standard' ) ?? null;

}

// The pad, every animation frame: presses become moves, a held direction (d-pad or stick) repeats.
function poll( now ) {

	requestAnimationFrame( poll );
	const pad = connectedPad();
	if ( ! pad ) {

		padHeld = false;
		padBefore = [];
		repeat = null;
		return;

	}

	const pressed = pad.buttons.map( ( button ) => button.pressed );
	const [ x = 0, y = 0 ] = pad.axes;
	padHeld = pressed.some( Boolean );
	if ( padHeld || Math.hypot( x, y ) > STICK ) ui.device = 'pad';

	let direction = null;
	for ( const [ index, move ] of Object.entries( PAD ) ) {

		if ( ! pressed[ index ] ) continue;
		if ( DIRECTIONS.has( move ) ) direction = move;
		else if ( ! padBefore[ index ] ) send( move, { code: null, shift: false } );

	}

	if ( ! direction && Math.max( Math.abs( x ), Math.abs( y ) ) > STICK ) direction = Math.abs( x ) > Math.abs( y ) ? ( x > 0 ? 'right' : 'left' ) : ( y > 0 ? 'down' : 'up' );
	if ( direction !== repeat?.move ) {

		repeat = direction ? { move: direction, next: now + REPEAT_DELAY } : null;
		if ( direction ) send( direction, { code: null, shift: false } );

	} else if ( repeat && now >= repeat.next ) {

		repeat.next = now + REPEAT_EVERY;
		send( direction, { code: null, shift: false } );

	}

	padBefore = pressed;

}

requestAnimationFrame( poll );

export { takeMoves, idle };
