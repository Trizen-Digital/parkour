// The touch controls as a device: what the thumbs do on the on-screen controls (src/ui/TouchControls.svelte) becomes
// the raw device state a keyboard, a mouse and a pad give (@trizendigital/parkour/input/deviceState.js), so a run played by
// touch is recorded and replays like any other, and Easy mode's pilot hears a tap of Jump as it hears Space.
//
//   the stick    a pad's left stick: the pad comes first among the page's while a thumb is on it, and pushed to its
//                edge it holds the pad's sprint trigger too
//   the look     the mouse's counts, with free look held while there is look to give, so the view turns in the air as
//                it does on the ground
//   a button     an action's first key or mouse button in the action table, held and let go as the page's own key
//                events do it
//
// They are on while touch is the device in use (the player follows src/ui/nav.js), and play in Easy mode (the player
// keeps it on while they are on): the pilot times the jumps, grabs in the air, aims the precision jumps and rolls the
// hard landings, so the buttons are only the moves it leaves to the player.

import { ACTIONS } from '@trizendigital/parkour/data/actions.js';
import { MOUSE_BUTTONS, PAD_BUTTONS } from '@trizendigital/parkour/input/deviceState.js';
import { MOUSE_YAW_RATE } from '@trizendigital/parkour/input/response.js';
import { clamp, radians } from '@trizendigital/parkour/math.js';

/** The buttons, by the action each presses. */
const BUTTONS = [ 'jump', 'grab', 'slide', 'dive', 'flip', 'wheel', 'backflip', 'interact' ];

const KEYS = Object.fromEntries( BUTTONS.map( ( action ) => [ action, ACTIONS[ action ].keys[ 0 ] ] ) );

const FREE_LOOK = ACTIONS.freeLook.keys[ 0 ];

// The pad's sprint trigger, by its index in the standard mapping, which has the home button after PAD_BUTTONS.
const SPRINT = PAD_BUTTONS.indexOf( ACTIONS.sprint.pad[ 0 ] );
const PAD_BUTTON_COUNT = PAD_BUTTONS.length + 1;

// What the stick's pad is called (the debug HUD and a replay's setup name the device by it).
const PAD_ID = 'Touch controls';

// The stick sprints pushed past this share of its travel, and stops once back under the second, so a thumb wobbling at
// the edge does not flicker it.
const SPRINT_ON = 0.9;
const SPRINT_OFF = 0.8;

// Mouse counts per CSS pixel dragged: at the default look sensitivity (0.5° a count, times the view's gain of 2.5) a
// drag turns the view 0.3° a pixel, about 250° across a phone held sideways.
const LOOK_COUNTS = 0.24;

// The Use button's word for what Interact would work.
const USE_WORDS = { kick: 'Kick', valve: 'Turn', button: 'Press' };

// A key or mouse button held or let go, as the page's own events do it: the edge first (to whoever listens: the pilot
// for its keys, the QA recorder, the input), then the state.
function hold( input, code, down ) {

	if ( ! input ) return;
	const button = MOUSE_BUTTONS.indexOf( code );
	const held = button >= 0 ? input.mouseButtons : input.keys, id = button >= 0 ? button : code;
	if ( held.has( id ) === down ) return;
	input.queueKey( code, down ? 'pressed' : 'released' );
	if ( down ) held.add( id );
	else held.delete( id );

}

class TouchInput {

	constructor() {

		/** Whether the touch controls are on. */
		this.on = false;
		// The input the buttons press into: the player's simulation's.
		this.input = null;
		/** The stick as the thumb holds it, -1 to 1 each way (y down, as a pad's axes read), and whether it sprints. */
		this.stick = { x: 0, y: 0, held: false };
		this.sprint = false;
		// Look dragged and not yet given to the view (mouse counts), and whether a finger is dragging it.
		this.pending = { x: 0, y: 0 };
		this.looking = false;

		const page = globalThis.navigator;
		/** The navigator the simulation's input reads the pads through: the stick's pad first while a thumb is on it. */
		this.navigator = {
			getGamepads: () => {

				const pads = [ ...( page?.getGamepads?.() ?? [] ) ];
				return this.on && this.stick.held ? [ this.pad(), ...pads ] : pads;

			},
		};

	}

	/**
	 * Presses into a simulation's input (the player makes one for each course).
	 * @param {Input} input
	 */
	attach( input ) {

		this.input = input;
		this.pending.x = this.pending.y = 0;

	}

	/** @param {boolean} on off lets go of everything */
	setOn( on ) {

		if ( ! on ) this.releaseAll();
		this.on = on;

	}

	/**
	 * A thumb went onto a button (or off it).
	 * @param {string} action one of BUTTONS
	 * @param {boolean} [down]
	 */
	press( action, down = true ) {

		hold( this.input, KEYS[ action ], down );

	}

	release( action ) {

		this.press( action, false );

	}

	/**
	 * The stick as the thumb pushes it, at most 1 long.
	 * @param {number} x -1 (left) to 1
	 * @param {number} y -1 (up) to 1
	 */
	setStick( x, y ) {

		const length = Math.hypot( x, y );
		this.stick = { x, y, held: true };
		this.sprint = length >= SPRINT_ON || ( this.sprint && length >= SPRINT_OFF );

	}

	releaseStick() {

		this.stick = { x: 0, y: 0, held: false };
		this.sprint = false;

	}

	/**
	 * A finger dragged the view.
	 * @param {number} dx CSS pixels right
	 * @param {number} dy CSS pixels down
	 */
	look( dx, dy ) {

		this.pending.x += dx * LOOK_COUNTS;
		this.pending.y += dy * LOOK_COUNTS;

	}

	/** The run is held (a menu, a press awaited): look dragged meanwhile is dropped, as the mouse's is. */
	hold() {

		this.pending.x = this.pending.y = 0;

	}

	/** Lets go of every button, the stick and the look (the controls hidden, turned off). */
	releaseAll() {

		for ( const action of BUTTONS ) this.release( action );
		hold( this.input, FREE_LOOK, false );
		this.releaseStick();
		this.looking = false;
		this.hold();

	}

	/**
	 * Inside the frame, before the pilot's turn and the devices' sample: the pointer counts as captured (a touch screen
	 * has none to lock), and the look goes in as the mouse's counts.
	 * @param {Input} input
	 * @param {Runner} runner the run as the frame starts
	 * @param {number} dt the frame's duration (s)
	 */
	apply( input, runner, dt ) {

		if ( ! this.on ) return;

		input.enabled = true;

		const tuning = input.tuning.values;
		// The view holds the mouse's yaw to MOUSE_YAW_RATE; what is over waits for the frames after, so a quick swipe
		// still turns the view as far as the finger went.
		const yaw = MOUSE_YAW_RATE * dt / radians( tuning.mouseSensitivity );
		let x = clamp( this.pending.x, - yaw, yaw ), y = this.pending.y;
		// In the air a flick of the mouse points a trick (TrickGesture): there the look goes in no faster than the
		// flick's threshold, so dragging the view never points one. The stick points them.
		if ( ! runner.grounded ) {

			const flick = tuning.trickMouseFlick;
			x = clamp( x, - flick, flick );
			y = clamp( y, - flick, flick );

		}

		this.pending.x -= x;
		this.pending.y -= y;
		input.mouse.x += x;
		input.mouse.y += y;
		hold( input, FREE_LOOK, this.looking || x !== 0 || y !== 0 );

	}

	// The stick as a pad with the standard mapping: its left stick, and its sprint trigger.
	pad() {

		const { x, y } = this.stick;
		return {
			id: PAD_ID,
			connected: true,
			mapping: 'standard',
			axes: [ x, y, 0, 0 ],
			buttons: Array.from( { length: PAD_BUTTON_COUNT }, ( _, index ) => {

				const down = index === SPRINT && this.sprint;
				return { pressed: down, value: down ? 1 : 0 };

			} ),
		};

	}

	/**
	 * The Use button's word for what Interact would work now ('Kick', 'Turn', 'Press'), or '' when nothing is in reach.
	 * @param {Simulation} sim
	 * @returns {string}
	 */
	useWord( sim ) {

		if ( sim.ragdoll.active ) return '';
		const target = sim.runner.doorsAndSwitches.target();
		return target ? USE_WORDS[ target.kind ] : '';

	}

}

export { TouchInput, BUTTONS };
