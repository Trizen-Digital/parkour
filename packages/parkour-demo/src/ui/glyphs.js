// How a binding shows in the menus: a key cap, a mouse with its button lit, a pad button by its Xbox name (what most
// pads on a PC report), or a part of the touch controls as its button reads. A code is a keyboard code ('KeyW'), a
// mouse button ('Mouse0'), 'Mouse' (moving it), 'Wheel', a pad button or stick as 'pad:south', 'pad:stickL', or a
// touch control as 'touch:jump', 'touch:stick'.

const KEY_NAMES = {
	Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace',
	Delete: 'Del', Home: 'Home', End: 'End', Comma: ',', Period: '.', BracketLeft: '[', BracketRight: ']', Tab: 'Tab',
	ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', MetaLeft: '⌘', ControlLeft: 'Ctrl',
};

const MOUSE = { Mouse0: 'left', Mouse1: 'middle', Mouse2: 'right', Wheel: 'wheel', Mouse: 'move' };

// Each pad button's name and the shape it is drawn in.
const PAD = {
	south: [ 'A', 'face' ], east: [ 'B', 'face' ], west: [ 'X', 'face' ], north: [ 'Y', 'face' ],
	l1: [ 'LB', 'bumper' ], r1: [ 'RB', 'bumper' ], l2: [ 'LT', 'trigger' ], r2: [ 'RT', 'trigger' ],
	select: [ 'View', 'pill' ], start: [ 'Menu', 'pill' ], l3: [ 'LS', 'stick' ], r3: [ 'RS', 'stick' ],
	stickL: [ 'L', 'stick' ], stickR: [ 'R', 'stick' ],
	up: [ '↑', 'dpad' ], down: [ '↓', 'dpad' ], left: [ '←', 'dpad' ], right: [ '→', 'dpad' ],
};

/** The touch controls' parts by name: the buttons by the action each presses (src/ui/TouchControls.svelte labels them so). */
const TOUCH_NAMES = {
	jump: 'Jump', grab: 'Grab', slide: 'Slide', dive: 'Dive', flip: 'Flip', wheel: 'Wheel', backflip: 'Back Flip', interact: 'Use',
	stick: 'Stick', stickUp: 'Stick ↑', stickDown: 'Stick ↓', stickSide: 'Stick ← →', look: 'Drag', menu: 'Menu',
};

/**
 * @param {string} code
 * @returns {string} a key's name as a key cap shows it
 */
function keyName( code ) {

	if ( KEY_NAMES[ code ] ) return KEY_NAMES[ code ];
	if ( /^Key[A-Z]$/.test( code ) ) return code.slice( 3 );
	if ( /^Digit\d$/.test( code ) ) return code.slice( 5 );
	if ( /^Numpad\d$/.test( code ) ) return `Num ${code.slice( 6 )}`;
	return code;

}

/**
 * @param {string} code
 * @returns {{kind: 'key'|'mouse'|'pad'|'touch', label: string, shape?: string, button?: string}}
 */
function glyphOf( code ) {

	if ( MOUSE[ code ] ) return { kind: 'mouse', label: '', button: MOUSE[ code ] };
	if ( code.startsWith( 'touch:' ) ) return { kind: 'touch', label: TOUCH_NAMES[ code.slice( 6 ) ] ?? code.slice( 6 ) };
	if ( code.startsWith( 'pad:' ) ) {

		const [ label, shape ] = PAD[ code.slice( 4 ) ] ?? [ code.slice( 4 ), 'pill' ];
		return { kind: 'pad', label, shape };

	}

	return { kind: 'key', label: keyName( code ) };

}

export { glyphOf, keyName, TOUCH_NAMES };
