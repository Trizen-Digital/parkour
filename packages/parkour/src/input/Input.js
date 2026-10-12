// The player's devices as actions. Once a frame `sample( dt )` reads the keyboard, the mouse and a gamepad and
// evaluates the action table (src/data/actions.js) for the current mode. Until the next sample, gameplay asks it which
// actions are held, which were pressed or released (kept until the steps take them), the actions' values, the move
// and the look. The page's events only keep raw state (keys held, mouse counts) and queue the presses that fall
// between samples; a QA replay or a golden tape puts the same raw state in place instead (deviceState.js), so a run
// replays exactly.
//
// Modes: 'play' while the runner is on its feet, 'limp' while the ragdoll has the body. An action is live in the modes
// the table gives it; elsewhere it reads as not held, at rest.

import { ACTIONS } from '../data/actions.js';
import { clamp, radians } from '../math.js';
import { MOUSE_BUTTONS, PAD_BUTTONS, connectedPad, unpackPad } from './deviceState.js';
import { axisResponse, mouseLook, stickLook, stickResponse } from './response.js';
import { Preferences } from './Preferences.js';

const MODES = [ 'play', 'limp' ];

const NAMES = Object.keys( ACTIONS );

// A pad button counts as down above this reading. The triggers (l2, r2) read their travel, so they count from their
// slightest press; the other buttons read 0 or 1.
const BUTTON_DOWN = 1e-8;
const TRIGGERS = new Set( [ 'l2', 'r2' ] );

// The pad becomes the device in use once a stick leaves this much travel or a button is pressed.
const PAD_IN_USE = 0.15;

// While limp, the look turns the view at this rate at full push (rad/s, times the sensitivity), whether it comes from
// the mouse or the stick.
const LIMP_LOOK_RATE = radians( 125 );

function kindOf( action ) {

	return action.sequence ? 'sequence' : action.kind ?? 'button';

}

// The bindings an action has in a mode, or null where it is not live.
function bindingsIn( action, mode ) {

	if ( mode === 'limp' && action.limp ) return action.limp;

	return ( action.modes ?? [ 'play' ] ).includes( mode ) ? action : null;

}

// Per mode, the live actions and their bindings.
const LIVE = Object.fromEntries( MODES.map( ( mode ) => [
	mode,
	new Map( NAMES.map( ( name ) => [ name, bindingsIn( ACTIONS[ name ], mode ) ] ).filter( ( [ , bindings ] ) => bindings ) )
] ) );

// Per mode, each key or mouse button and the buttons it is bound to on its own: a press or release queued between two
// samples is an edge of all of them.
const QUEUED = Object.fromEntries( MODES.map( ( mode ) => {

	const actions = new Map();

	for ( const [ name, bindings ] of LIVE[ mode ] ) {

		if ( kindOf( ACTIONS[ name ] ) !== 'button' ) continue;

		for ( const key of bindings.keys ?? [] ) {

			if ( typeof key === 'string' ) actions.set( key, [ ...( actions.get( key ) ?? [] ), name ] );

		}

	}

	return [ mode, actions ];

} ) );

// The actions whose presses the page takes once a frame.
const SYSTEM = NAMES.filter( ( name ) => ACTIONS[ name ].system );

// Nothing held, nothing moved, no pad.
function noReading() {

	return { keys: new Set(), mouse: { x: 0, y: 0, wheel: 0 }, pad: null };

}

// The devices as the actions read them: the key codes and mouse buttons held, the mouse's counts (x right, y down,
// the wheel's notches) and the pad's buttons and axes (y up), or no pad. A text field with the keyboard mutes the keys
// and the pad; the mouse moves and clicks only while the pointer is captured. The wheel counts whenever the page saw
// it (it only listens while captured).
function readDevices( keys, mouseButtons, mouse, pad, { enabled, editing } ) {

	const held = new Set();
	const pointer = enabled && ! editing;

	if ( ! editing ) for ( const code of keys ) held.add( code );
	if ( pointer ) for ( const button of mouseButtons ) held.add( MOUSE_BUTTONS[ button ] );

	return {
		keys: held,
		mouse: { x: pointer ? mouse.x : 0, y: pointer ? mouse.y : 0, wheel: mouse.wheel },
		pad: pad && ! editing ? readPad( pad ) : null
	};

}

function readPad( pad ) {

	const buttons = {};

	PAD_BUTTONS.forEach( ( name, index ) => {

		const button = pad.buttons?.[ index ];
		buttons[ name ] = TRIGGERS.has( name ) ? button?.value || 0 : Number( button?.pressed || false );

	} );

	// The page's sticks point y down; ours point up.
	const axes = pad.axes || [];

	return { buttons, axes: { leftX: axes[ 0 ] || 0, leftY: - ( axes[ 1 ] || 0 ), rightX: axes[ 2 ] || 0, rightY: - ( axes[ 3 ] || 0 ) } };

}

function padStick( pad, stick ) {

	return pad ? { x: pad.axes[ stick + 'X' ], y: pad.axes[ stick + 'Y' ] } : { x: 0, y: 0 };

}

// One button binding: a key code or pad button, a chord (all of it), or a tap (down now and not at the sample before;
// with no sample before, down).
function bindingDown( binding, device, reading, before ) {

	if ( Array.isArray( binding ) ) return binding.every( ( part ) => bindingDown( part, device, reading, before ) );
	if ( binding.tap ) return bindingDown( binding.button, device, reading ) && ! ( before && bindingDown( binding.button, device, before ) );

	return device === 'keys' ? reading.keys.has( binding ) : ( reading.pad?.buttons[ binding ] ?? 0 ) > BUTTON_DOWN;

}

function buttonHeld( bindings, devices, reading, before ) {

	return devices.some( ( device ) => ( bindings[ device ] ?? [] ).some( ( binding ) => bindingDown( binding, device, reading, before ) ) );

}

// An analog binding's reading through its response (raw, times its scale, when it has no dead zone).
function shapeAxis( value, binding, tuning ) {

	if ( binding.deadZone === undefined ) return value * ( binding.scale ?? 1 );

	return axisResponse( value, { ...binding, deadZone: deadZoneOf( binding, tuning ) } );

}

function shapeStick( stick, binding, tuning ) {

	if ( binding.deadZone === undefined ) {

		const scale = binding.scale ?? 1;

		return { x: stick.x * scale, y: stick.y * scale };

	}

	const response = { ...binding, deadZone: deadZoneOf( binding, tuning ) };

	if ( binding.perAxis ) return { x: axisResponse( stick.x, response ), y: axisResponse( stick.y, response ) };

	return stickResponse( stick.x, stick.y, response );

}

function deadZoneOf( binding, tuning ) {

	return typeof binding.deadZone === 'string' ? tuning[ binding.deadZone ] : binding.deadZone;

}

// An axis: the binding with the larger magnitude, the first on a tie (mouse, keys, pad).
function axisValue( bindings, reading, tuning ) {

	let value = 0;
	const take = ( candidate ) => {

		if ( Math.abs( candidate ) > Math.abs( value ) ) value = candidate;

	};

	if ( bindings.mouse ) take( reading.mouse[ bindings.mouse.axis ] * ( bindings.mouse.scale ?? 1 ) );

	if ( bindings.keys ) {

		take( - Number( reading.keys.has( bindings.keys.minus ) ) );
		take( Number( reading.keys.has( bindings.keys.plus ) ) );

	}

	if ( bindings.pad && reading.pad ) take( shapeAxis( reading.pad.axes[ bindings.pad.axis ], bindings.pad, tuning ) );

	return value;

}

// A stick: per component, the binding with the larger magnitude, the first on a tie (mouse, keys, pad).
function stickValue( bindings, reading, tuning ) {

	const value = { x: 0, y: 0 };
	const take = ( x, y ) => {

		if ( Math.abs( x ) > Math.abs( value.x ) ) value.x = x;
		if ( Math.abs( y ) > Math.abs( value.y ) ) value.y = y;

	};

	if ( bindings.mouse ) {

		const up = - reading.mouse.y;
		take( reading.mouse.x, bindings.mouse.invertY ? - up : up );

	}

	if ( bindings.keys ) {

		const down = ( code ) => Number( reading.keys.has( code ) );
		take( 0, down( bindings.keys.forward ) );
		take( 0, - down( bindings.keys.back ) );
		take( - down( bindings.keys.left ), 0 );
		take( down( bindings.keys.right ), 0 );

	}

	if ( bindings.pad && reading.pad ) {

		const stick = shapeStick( padStick( reading.pad, bindings.pad.stick ), bindings.pad, tuning );
		take( stick.x, stick.y );

	}

	return value;

}

// The move (the table's `move`): the steering direction, the move as a direction, and how hard it pushes. The keys
// give each axis −1, 0 or 1, opposite keys cancelling; the stick has its `steer` and `push` responses. The ragdoll
// steers by the move too, so the steering is read in every mode; the push only drives the runner, and reads 0 where
// the move is not live.
function readMove( reading, tuning, live ) {

	const { keys, pad } = ACTIONS.move;
	const down = ( code ) => reading.keys.has( code );
	const keyX = Number( down( keys.right ) ) - Number( down( keys.left ) );
	const keyY = Number( down( keys.forward ) ) - Number( down( keys.back ) );
	const stick = padStick( reading.pad, pad.stick );
	const steer = shapeStick( stick, pad.steer, tuning );
	const push = shapeStick( stick, pad.push, tuning );

	const x = keyX || push.x, y = keyY || push.y;
	const length = Math.max( 1, Math.hypot( x, y ) );
	const anyKey = [ keys.forward, keys.back, keys.left, keys.right ].some( down );

	return {
		steer: { x: clamp( keyX + steer.x, - 1, 1 ), y: clamp( keyY + steer.y, - 1, 1 ) },
		direction: { x: x / length, y: y / length },
		amount: ! live ? 0 : anyKey ? 1 : Math.max( Math.abs( push.x ), Math.abs( push.y ) )
	};

}

function restValue( action ) {

	const kind = kindOf( action );

	return kind === 'stick' ? { x: 0, y: 0 } : 0;

}

class Input {

	/**
	 * @param {HTMLCanvasElement|null} canvas the game's canvas: the mouse's buttons and wheel, and pointer capture
	 * @param {Tuning} tuning dead zones and look rates
	 * @param {object} [page] the page's objects, replaced in tests and headless runs: `storage` (the preferences),
	 *   `eventWindow`, `eventDocument`, `navigator` (the gamepads)
	 */
	constructor( canvas, tuning, { storage, eventWindow = globalThis.window, eventDocument = globalThis.document, navigator = globalThis.navigator } = {} ) {

		this.canvas = canvas;
		this.tuning = tuning;
		this.eventDocument = eventDocument;
		this.navigator = navigator;

		this.preferences = new Preferences( storage );

		this.mode = 'play';

		// Raw state, kept by the page's events (or put in place by a replay): key codes held, mouse buttons held, and
		// the mouse's counts since the last sample.
		this.keys = new Set();
		this.mouseButtons = new Set();
		this.mouse = { x: 0, y: 0, wheel: 0 };

		// The pointer is captured (pointer lock, or the viewport when the browser refuses the lock).
		this.enabled = false;
		this.fallbackCapture = false;
		this.pointerInside = false;
		this.onCaptureChange = null;

		// This sample's devices as the actions read them and its duration, and the reading before it (for taps; null
		// after a reset).
		this.reading = noReading();
		this.dt = 0;
		this.before = null;

		// The actions held as gameplay sees them (after the sprint latch), as last sampled (before it: the next sample's
		// presses and releases compare against these), and the actions' values.
		this.current = {};
		this.previous = {};
		this.values = {};

		// Presses and releases since the steps last took them.
		this.edges = { pressed: new Set(), released: new Set() };

		// How far each sequence has got: { armed, time } by name.
		this.sequences = {};

		/** The steering direction, { x right, y forward }, each within ±1. */
		this.move = { x: 0, y: 0 };

		/** The move as a direction of at most unit length: the keys on an axis, else the stick's push. */
		this.moveDirection = { x: 0, y: 0 };

		/** How hard the move pushes, 0 to 1. */
		this.moveAmount = 0;

		/** How far the view turns this sample (radians): { mouse: { x, y }, stick: { x, y } }. */
		this.look = { mouse: { x: 0, y: 0 }, stick: { x: 0, y: 0 } };

		/** The gamepad is the device in use (it was the last one touched). */
		this.usingPad = false;
		this.padName = '';

		this.sprintLatched = false;

		this.listeners = [];
		this.listen( eventWindow, eventDocument, canvas );

	}

	listen( eventWindow, eventDocument, canvas ) {

		const on = ( target, type, callback, options ) => {

			target?.addEventListener( type, callback, options );
			this.listeners.push( [ target, type, callback, options ] );

		};

		on( eventWindow, 'keydown', ( event ) => {

			// Escape ends pointer lock by itself; a viewport capture ends here.
			if ( event.code === 'Escape' && this.fallbackCapture ) {

				this.releaseCapture();
				return;

			}

			if ( this.isEditing( event.target ) ) return;

			// Keys the page would scroll by.
			if ( event.code === 'Space' || event.code.startsWith( 'Arrow' ) ) event.preventDefault();

			if ( ! this.keys.has( event.code ) ) this.queueKey( event.code, 'pressed' );
			this.keys.add( event.code );

		} );

		on( eventWindow, 'keyup', ( event ) => {

			if ( this.keys.delete( event.code ) ) this.queueKey( event.code, 'released' );

		} );

		on( eventWindow, 'blur', () => this.clear() );

		on( eventDocument, 'pointerlockchange', () => {

			this.enabled = eventDocument.pointerLockElement === canvas || this.fallbackCapture;
			this.clear();
			this.onCaptureChange?.( this.enabled );

		} );

		on( canvas, 'mouseenter', () => {

			this.pointerInside = true;

		} );

		on( canvas, 'mouseleave', () => {

			this.pointerInside = false;
			this.mouse.x = this.mouse.y = 0;

		} );

		// A click outside the canvas ends a viewport capture, as leaving pointer lock would.
		on( eventDocument, 'mousedown', ( event ) => {

			if ( this.fallbackCapture && event.target !== canvas ) this.releaseCapture();

		} );

		on( canvas, 'contextmenu', ( event ) => event.preventDefault() );

		on( canvas, 'mousedown', ( event ) => {

			if ( ! this.enabled || ! MOUSE_BUTTONS[ event.button ] ) return;
			if ( ! this.mouseButtons.has( event.button ) ) this.queueKey( MOUSE_BUTTONS[ event.button ], 'pressed' );
			this.mouseButtons.add( event.button );

		} );

		on( eventWindow, 'mouseup', ( event ) => {

			if ( this.mouseButtons.delete( event.button ) ) this.queueKey( MOUSE_BUTTONS[ event.button ], 'released' );

		} );

		on( eventDocument, 'mousemove', ( event ) => {

			if ( this.enabled && ( ! this.fallbackCapture || this.pointerInside ) ) {

				this.mouse.x += event.movementX;
				this.mouse.y += event.movementY;

			}

		} );

		on( canvas, 'wheel', ( event ) => {

			if ( ! this.enabled ) return;
			this.mouse.wheel -= Math.sign( event.deltaY );
			event.preventDefault();

		}, { passive: false } );

	}

	/**
	 * Switches the actions to another mode ('play' or 'limp'). The ragdoll starts and ends inside a frame's steps, so
	 * this frame's devices are read again for the new mode: the steps left in the frame play by it. What was held is
	 * forgotten all the same: still down at the next sample, it is a press.
	 */
	setMode( mode ) {

		const next = mode === 'limp' ? 'limp' : 'play';

		if ( next === this.mode ) return;

		this.mode = next;
		this.forget();

		const { held, values } = this.evaluate( this.reading, null, {}, {}, this.dt );
		this.take( held, values );

	}

	forget() {

		this.previous = {};
		this.current = {};
		this.before = null;
		this.sequences = {};
		this.edges.pressed.clear();
		this.edges.released.clear();

	}

	/**
	 * A key or mouse button went down or up between samples (from the page, a tape or the pilot): an edge of each
	 * button bound to it in this mode, so a tap shorter than a frame still counts.
	 */
	queueKey( key, edge ) {

		for ( const action of QUEUED[ this.mode ].get( key ) ?? [] ) this.edges[ edge ].add( action );

	}

	isEditing( target ) {

		return /INPUT|SELECT|TEXTAREA/.test( target?.tagName ) || target?.isContentEditable;

	}

	/** Lets go of everything (the window lost focus, the capture changed, or a replay says so). */
	clear() {

		this.keys.clear();
		this.mouseButtons.clear();
		this.mouse.x = this.mouse.y = this.mouse.wheel = 0;
		this.reading = noReading();
		this.values = {};
		this.forget();

	}

	dispose() {

		this.clear();
		for ( const [ target, type, callback, options ] of this.listeners ) target?.removeEventListener?.( type, callback, options );

	}

	/** Captures the pointer: pointer lock, or the viewport where the browser refuses it. */
	async capture() {

		try {

			await this.canvas.requestPointerLock();
			// The lock is held once the request resolves. Its pointerlockchange can come after, and until then the input
			// would still read as let go (which opens the pause menu).
			this.fallbackCapture = false;
			this.enabled = true;

		} catch {

			this.fallbackCapture = true;
			this.enabled = true;
			this.pointerInside = true;

		}

		this.canvas.focus();
		this.onCaptureChange?.( this.enabled );

		return this.fallbackCapture ? 'viewport' : 'locked';

	}

	releaseCapture() {

		this.fallbackCapture = false;
		this.enabled = false;
		this.eventDocument?.exitPointerLock?.();
		this.clear();
		this.onCaptureChange?.( false );

	}

	/**
	 * Reads the devices for this frame and evaluates every action.
	 * @param {number} dt the frame's duration (s)
	 * @param {Gamepad} [gamepad] a pad to read instead of the page's
	 */
	sample( dt, gamepad ) {

		const editing = Boolean( this.isEditing( this.eventDocument?.activeElement ) );

		const pad = gamepad || connectedPad( this.navigator );

		const reading = readDevices( this.keys, this.mouseButtons, this.mouse, pad, { enabled: this.enabled, editing } );
		const { held, values, sequences } = this.evaluate( reading, this.before, this.previous, this.sequences, dt );

		this.reading = reading;
		this.dt = dt;
		this.before = reading;
		this.sequences = sequences;

		for ( const name of NAMES ) {

			if ( held[ name ] && ! this.previous[ name ] ) this.edges.pressed.add( name );
			if ( ! held[ name ] && this.previous[ name ] ) this.edges.released.add( name );

		}

		if ( this.preferences.values.sprintToggle && this.edges.pressed.has( 'sprint' ) && ! this.previous.sprint ) this.sprintLatched = ! this.sprintLatched;

		this.previous = held;
		this.take( held, values );
		this.noteDeviceInUse( editing ? null : pad, reading );

		this.mouse.x = this.mouse.y = this.mouse.wheel = 0;

	}

	// What gameplay reads until the next sample, from the actions evaluated on this sample's reading.
	take( held, values ) {

		this.current = { ...held };
		if ( this.preferences.values.sprintToggle ) this.current.sprint = this.sprintLatched;
		this.values = values;

		const move = readMove( this.reading, this.tuning.values, LIVE[ this.mode ].has( 'move' ) );
		this.move = move.steer;
		this.moveDirection = move.direction;
		this.moveAmount = move.amount;
		this.look = this.readLook( this.reading, this.dt );

	}

	// Which actions are held (before the sprint latch) and their values, for this mode, from a reading of the devices.
	// `before` and `previous` are the sample before's reading (for taps) and held actions (for sequences),
	// `sequences` the sequences' progress, which moves on by `dt`.
	evaluate( reading, before, previous, sequences, dt ) {

		const tuning = this.tuning.values, live = LIVE[ this.mode ];
		const held = {}, values = {}, progress = {};

		for ( const name of NAMES ) {

			const action = ACTIONS[ name ], bindings = live.get( name ), kind = kindOf( action );

			if ( kind === 'move' || kind === 'sequence' || action.while ) continue;

			if ( ! bindings ) {

				held[ name ] = false;
				values[ name ] = restValue( action );

			} else if ( kind === 'button' ) {

				held[ name ] = buttonHeld( bindings, [ 'keys', 'pad' ], reading, before );
				values[ name ] = Number( held[ name ] );

			} else {

				let value = kind === 'axis' ? axisValue( bindings, reading, tuning ) : stickValue( bindings, reading, tuning );
				if ( action.perSecond ) value = kind === 'axis' ? value * dt : { x: value.x * dt, y: value.y * dt };
				values[ name ] = value;
				held[ name ] = kind === 'axis' ? value !== 0 : value.x !== 0 || value.y !== 0;

			}

		}

		// Buttons gated by another action.
		for ( const name of NAMES ) {

			const action = ACTIONS[ name ], bindings = live.get( name );

			if ( ! action.while ) continue;

			held[ name ] = Boolean( bindings ) && held[ action.while ] && buttonHeld( bindings, [ 'keys', 'pad' ], reading, before );
			values[ name ] = Number( held[ name ] );

		}

		// Sequences: armed when the first action goes down, held when the second goes down within the time allowed.
		for ( const name of NAMES ) {

			const action = ACTIONS[ name ];

			if ( ! action.sequence ) continue;

			const [ first, then ] = action.sequence;
			const state = { armed: false, time: 0, ...sequences[ name ] };
			const started = ( other ) => held[ other ] && ! previous[ other ];

			state.time += dt;
			if ( state.time > action.within ) state.armed = false;

			held[ name ] = Boolean( live.get( name ) ) && state.armed && started( then );
			if ( held[ name ] ) state.armed = false;

			if ( started( first ) ) {

				state.armed = true;
				state.time = 0;

			}

			values[ name ] = Number( held[ name ] );
			progress[ name ] = state;

		}

		return { held, values, sequences: progress };

	}

	// The look (radians this sample). On foot the mouse and the right stick are kept apart: the view holds the mouse's
	// yaw to a turn rate and ignores the mouse while falling. While limp both come through the `look` action
	// at a fixed rate.
	readLook( reading, dt ) {

		const tuning = this.tuning.values, preferences = this.preferences.values, sensitivity = tuning.mouseSensitivity;
		const right = padStick( reading.pad, 'right' );

		const mouse = mouseLook( reading.mouse.x, reading.mouse.y * ( preferences.invertMouseY ? - 1 : 1 ), sensitivity );
		const stick = stickLook( right.x, right.y * ( preferences.invertStickY ? - 1 : 1 ), dt, tuning.stickLookRate * sensitivity, tuning.lookDeadZone );

		if ( this.mode !== 'limp' ) return { mouse, stick };

		// The inversion preference is the one of whichever device turned the pitch more this sample.
		const look = this.value( 'look' );
		const mouseLeads = Math.abs( reading.mouse.y * dt ) >= Math.abs( stick.y / ( LIMP_LOOK_RATE * sensitivity ) );
		const invert = mouseLeads ? preferences.invertMouseY : preferences.invertStickY;

		return {
			mouse: { x: 0, y: 0 },
			stick: {
				x: look.x * LIMP_LOOK_RATE * sensitivity,
				y: look.y * LIMP_LOOK_RATE * sensitivity * ( invert ? - 1 : 1 )
			}
		};

	}

	// The device in use is the last one touched: the pad once a stick or button moves, the keyboard and mouse while a
	// key is held or the mouse moves.
	noteDeviceInUse( pad, reading ) {

		if ( pad && ( pad.axes.some( ( value ) => Math.abs( value ) > PAD_IN_USE ) || pad.buttons.some( ( button ) => button.pressed ) ) ) {

			this.usingPad = true;
			this.padName = pad.id.split( '(' )[ 0 ].trim();

		}

		if ( this.keys.size || Math.abs( reading.mouse.x ) + Math.abs( reading.mouse.y ) > 0 ) this.usingPad = false;

	}

	/** The action's value this sample: a number for an axis, { x, y } for a stick, 1 or 0 for a button. */
	value( action ) {

		return this.values[ action ] ?? ( ACTIONS[ action ] ? restValue( ACTIONS[ action ] ) : 0 );

	}

	/**
	 * The action is held this sample. On one device (`'keys'`, the keyboard and mouse, or `'pad'`): its bindings there
	 * as they are (before the sprint latch; a tap counts while held).
	 */
	held( action, device ) {

		if ( ! device ) return Boolean( this.current[ action ] );

		const bindings = LIVE[ this.mode ].get( action ), definition = ACTIONS[ action ];

		if ( ! bindings || kindOf( definition ) !== 'button' ) return false;
		if ( definition.while && ! this.held( definition.while, device ) ) return false;

		return buttonHeld( bindings, [ device ], this.reading, null );

	}

	pressed( action ) {

		return this.edges.pressed.has( action );

	}

	released( action ) {

		return this.edges.released.has( action );

	}

	/** The steps took this frame's presses and releases. */
	consumeEdges() {

		this.edges.pressed.clear();
		this.edges.released.clear();

	}

	/** The page took the presses it reads once a frame (pause, marks, the UI and QA keys). */
	consumeSystemEdges() {

		for ( const action of SYSTEM ) {

			this.edges.pressed.delete( action );
			this.edges.released.delete( action );

		}

	}

	get deviceName() {

		return this.usingPad ? 'GAMEPAD · ' + this.padName : 'KEYBOARD + MOUSE';

	}

}

/**
 * A frame of raw device state (deviceState.js) as a mode's buttons see it: the buttons held (a tap counts while held),
 * and those whose keys were pressed between frames. The QA timeline's presses.
 */
function buttonsInFrame( frame, mode = 'play' ) {

	const mouse = { x: frame.mouse[ 0 ], y: frame.mouse[ 1 ], wheel: frame.mouse[ 2 ] };
	const reading = readDevices( frame.keys, frame.buttons, mouse, unpackPad( frame.pad ), frame );
	const held = new Set(), tapped = new Set();

	for ( const [ name, bindings ] of LIVE[ mode ] ) {

		const action = ACTIONS[ name ];
		if ( kindOf( action ) === 'button' && ! action.while && buttonHeld( bindings, [ 'keys', 'pad' ], reading, null ) ) held.add( name );

	}

	for ( const [ key, edge ] of frame.edges ) {

		if ( edge === 'pressed' ) for ( const name of QUEUED[ mode ].get( key ) ?? [] ) tapped.add( name );

	}

	return { held, tapped };

}

export { Input, buttonsInFrame };
