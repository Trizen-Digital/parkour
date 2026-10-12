// The player's devices as raw state, frame by frame: what the golden tapes and QA replays record and what a replay
// feeds back in place of the page's devices. A frame is
//
//   { dt, keys, buttons, mouse: [ x, y, wheel ], edges: [ [ code, 'pressed' | 'released' ] ], pad, enabled, editing }
//
// the key codes held, the mouse buttons held, the mouse's counts since the last frame, the keys and mouse buttons
// pressed or released between frames (a tap shorter than a frame still counts), the gamepad ({ id, axes, buttons:
// [ [ pressed, value ] ] } or null), whether the pointer was captured, and whether a text field had the keyboard.
// Replaying the frames into a fresh simulation runs it again exactly: nothing else reaches a run from outside.

/** The standard mapping's pad buttons, by index. */
const PAD_BUTTONS = [ 'south', 'east', 'west', 'north', 'l1', 'r1', 'l2', 'r2', 'select', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right' ];

/** The mouse buttons by `MouseEvent.button`: left, middle, right. */
const MOUSE_BUTTONS = [ 'Mouse0', 'Mouse1', 'Mouse2' ];

/** The first connected gamepad with the standard mapping, if there is one. */
function connectedPad( navigator ) {

	return [ ...( navigator?.getGamepads?.() || [] ) ].find( ( pad ) => pad?.connected && pad.mapping === 'standard' );

}

/** A gamepad as a frame keeps it. */
function packPad( pad ) {

	if ( ! pad ) return null;
	return { id: pad.id, axes: Array.from( pad.axes ), buttons: Array.from( pad.buttons, ( button ) => [ button.pressed ? 1 : 0, button.value ] ) };

}

/** A frame's gamepad as the page would give it. */
function unpackPad( packed ) {

	if ( ! packed ) return null;
	return {
		id: packed.id,
		connected: true,
		mapping: 'standard',
		axes: packed.axes.slice(),
		buttons: packed.buttons.map( ( [ pressed, value ] ) => ( { pressed: Boolean( pressed ), value } ) )
	};

}

/**
 * Records an Input's devices frame by frame, or plays frames back into it. While playing back, the page's own key
 * presses no longer reach the Input, so a replay runs on its frames alone.
 */
class DeviceState {

	constructor( input ) {

		this.input = input;

		// null, 'recording' or 'playing'.
		this.state = null;

		// The key edges queued since the last captured frame.
		this.queued = [];

		this.page = { navigator: input.navigator, eventDocument: input.eventDocument };

		// The Input's own queueKey, for the edges a frame carries.
		this.queueKey = input.queueKey.bind( input );

		input.queueKey = ( key, edge ) => {

			if ( this.state === 'playing' ) return;
			if ( this.state === 'recording' ) this.queued.push( [ key, edge ] );
			this.queueKey( key, edge );

		};

	}

	record() {

		this.state = 'recording';
		this.queued = [];

	}

	play() {

		this.state = 'playing';

	}

	/** Back to the page's devices. */
	stop() {

		this.state = null;
		this.input.navigator = this.page.navigator;
		this.input.eventDocument = this.page.eventDocument;

	}

	/** The Input's devices now, as a frame of `dt` seconds. */
	capture( dt ) {

		const input = this.input;

		return {
			dt,
			keys: [ ...input.keys ],
			buttons: [ ...input.mouseButtons ],
			mouse: [ input.mouse.x, input.mouse.y, input.mouse.wheel ],
			edges: this.queued.splice( 0 ),
			pad: packPad( connectedPad( input.navigator ) ),
			enabled: input.enabled,
			editing: Boolean( input.isEditing( input.eventDocument?.activeElement ) )
		};

	}

	/** Puts a frame's devices in place of the page's, for the Input's next sample. */
	apply( frame ) {

		const input = this.input;
		input.keys = new Set( frame.keys );
		input.mouseButtons = new Set( frame.buttons );
		input.mouse = { x: frame.mouse[ 0 ], y: frame.mouse[ 1 ], wheel: frame.mouse[ 2 ] };
		input.enabled = frame.enabled;
		for ( const [ key, edge ] of frame.edges ) this.queueKey( key, edge );
		const pad = unpackPad( frame.pad );
		input.navigator = { getGamepads: () => ( pad ? [ pad ] : [] ) };
		input.eventDocument = { activeElement: frame.editing ? { tagName: 'INPUT' } : null, exitPointerLock() {} };

	}

}

export { PAD_BUTTONS, MOUSE_BUTTONS, connectedPad, packPad, unpackPad, DeviceState };
