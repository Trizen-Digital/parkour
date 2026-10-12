// The action table: everything the player can do, and the keys, buttons, sticks and mouse that do it. Gameplay asks
// for actions (`input.held( 'jump' )`, `input.value( 'poleTurn' )`), never for a key; Input reads this table directly
// every sample.
//
// An action is a button (the default), an axis (a number) or a stick ({ x, y }, y up); the runner's move is a kind of
// its own (below). Its bindings, by device:
//
//   keys    keyboard codes (KeyboardEvent.code) and the mouse buttons Mouse0 (left), Mouse1 (middle), Mouse2 (right).
//           A button lists them, or chords ( [ a, b ]: all held at once). An axis names its { minus, plus } keys and
//           a stick its { forward, back, left, right } keys; a key reads as a full push.
//   pad     a gamepad with the standard mapping. A button lists pad buttons (south, east, west, north, l1, r1, l2, r2,
//           select, start, l3, r3, up, down, left, right) or chords like keys; the triggers l2 and r2 count from
//           their slightest press, and { button, tap: true } counts only on the sample the button goes down. An axis
//           reads { axis: 'leftX' | 'leftY' | 'rightX' | 'rightY' }, a stick { stick: 'left' | 'right' } (y up).
//   mouse   { axis: 'x' | 'wheel' } or { stick: 'move' }: the counts since the last sample (y up, like a stick;
//           `invertY` gives the screen's y).
//
// An analog binding can shape its reading: `scale` multiplies it; `deadZone` is the travel that reads as nothing (a
// number, or the name of a tuning value), after which it grows to 1 at `full` (default 1), times `max` (default 1).
// A stick's dead zone is round unless `perAxis`. With no dead zone a binding reads raw (times its scale).
//
// An axis or a stick takes, per component, the binding with the larger magnitude, the first listed on a tie (mouse,
// then keys, then pad). A button is held while any of its bindings is down.
//
// Other fields:
//   modes      where the action is live: 'play' (on foot; the default) and 'limp' (the ragdoll has the body)
//   limp       other bindings while limp (the action is then live there with these)
//   while      a button live only while another action is held (the field-of-view chords)
//   sequence   [ first, then ] and `within`: held on the sample `then` goes down if `first` went down no more than
//              `within` seconds before
//   perSecond  the reading is scaled by the sample's duration
//   system     the page reads its presses once a frame, before the steps (pause, marks, the UI and QA keys)

const ALWAYS = [ 'play', 'limp' ];

const MOVE_KEYS = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' };

export const ACTIONS = {

	// The runner.

	jump: { keys: [ 'Space' ], pad: [ 'south' ] },
	// In the air: arm the landing roll.
	tuck: { keys: [ 'Space' ], pad: [ 'east' ] },
	sprint: { keys: [ 'ShiftLeft', 'ShiftRight' ], pad: [ 'r2' ] },
	grab: { keys: [ 'Mouse0' ], pad: [ 'l2' ] },
	precision: { keys: [ 'KeyE' ], pad: [ 'l1' ] },
	// The precision button in front of a door, a valve or a button works it instead (DoorsAndSwitches).
	interact: { keys: [ 'KeyE' ], pad: [ 'l1' ] },
	// Side flips, vortex, spin, back cork; kick off a ledge or a wall.
	flip: { keys: [ 'KeyF' ], pad: [ 'west' ] },
	// Cartwheel and front flips.
	wheel: { keys: [ 'KeyR' ], pad: [ 'north' ] },
	// Dive roll; drop from a ledge or a pipe.
	dive: { keys: [ 'KeyT' ], pad: [ 'east' ] },
	backflip: { keys: [ 'KeyG' ] },
	// A flip, then a dive within half a second.
	spinDive: { sequence: [ 'flip', 'dive' ], within: 0.5 },
	slide: { keys: [ 'KeyX' ], pad: [ [ 'l1', 'east' ] ] },
	slowMotion: { keys: [ 'Mouse2' ], pad: [ 'r1' ], modes: ALWAYS },
	// Goes limp on its press (the runner reads nothing else of it): the key's press, or a click of the right stick.
	goLimp: { keys: [ 'Digit4' ], pad: [ { button: 'r3', tap: true } ] },
	standUp: { keys: [ 'Space' ], pad: [ { button: 'south', tap: true } ], modes: [ 'limp' ] },

	// The movement keys on their own: climbing from a hang, the shimmy, up and down a pipe.
	forward: { keys: [ MOVE_KEYS.forward ], modes: ALWAYS },
	back: { keys: [ MOVE_KEYS.back ], modes: ALWAYS },
	left: { keys: [ MOVE_KEYS.left ], modes: ALWAYS },
	right: { keys: [ MOVE_KEYS.right ], modes: ALWAYS },

	// The runner's move: the movement keys or the left stick. The stick has two responses: `steer`, the direction the
	// runner turns toward (each axis past a quarter of its travel), and `push`, how hard it accelerates (each axis
	// stretched by 1.2, past the move dead zone, full at 0.9 of its travel). Input reports the move as `move`,
	// `moveAmount` and `moveDirection` rather than as held or a value.
	move: {
		kind: 'move',
		keys: MOVE_KEYS,
		pad: {
			stick: 'left',
			steer: { deadZone: 0.25, perAxis: true },
			push: { scale: 1.2, deadZone: 'moveDeadZone', full: 0.9, perAxis: true }
		}
	},

	// While limp: whether to push the ragdoll (Input's `move` gives the direction).
	limpMove: { kind: 'stick', modes: [ 'limp' ], keys: MOVE_KEYS, pad: { stick: 'left', scale: 1.2, deadZone: 0.2, perAxis: true } },

	// The left stick as a direction for tricks, the shimmy and the pipe: 0 to 1 past its dead zone.
	stick: { kind: 'stick', pad: { stick: 'left', deadZone: 0.2, full: 0.9 } },

	// A hard sideways push of the left stick: the stick's side tricks.
	stickSide: { kind: 'axis', pad: { axis: 'leftX', deadZone: 0.9 } },

	// Circling a pole.
	poleTurn: { kind: 'axis', mouse: { axis: 'x' }, keys: { minus: 'KeyA', plus: 'KeyD' }, pad: { axis: 'leftX', deadZone: 0.2 } },

	// Steering a slide.
	slideSteer: { kind: 'axis', keys: { minus: 'KeyA', plus: 'KeyD' }, pad: { axis: 'leftX' } },

	// The mouse's counts this sample, for the trick flicks.
	mouseFlick: { kind: 'stick', mouse: { stick: 'move' } },

	// The view.

	toggleView: { keys: [ 'KeyC' ], pad: [ 'right' ], modes: ALWAYS },
	freeLook: { keys: [ 'Mouse1' ], modes: ALWAYS },
	// Degrees of field of view per notch of the wheel.
	zoom: { kind: 'axis', modes: ALWAYS, mouse: { axis: 'wheel', scale: 1.5 } },
	// The d-pad while the slow-motion button is held.
	narrowView: { while: 'slowMotion', pad: [ 'up' ], modes: ALWAYS },
	widenView: { while: 'slowMotion', pad: [ 'down' ], modes: ALWAYS },
	// While limp the mouse and the right stick turn the view through this one action (Input's `look`). The mouse turns
	// it the way it does on foot: down looks down.
	look: {
		kind: 'stick',
		modes: [ 'limp' ],
		perSecond: true,
		mouse: { stick: 'move', invertY: true },
		pad: { stick: 'right', scale: 0.5, deadZone: 0.2 }
	},

	// The run and the page.

	pause: { keys: [ 'Escape', 'KeyP' ], pad: [ 'start' ], modes: ALWAYS, system: true },
	setMark: { keys: [ 'Numpad2' ], pad: [ 'down' ], system: true },
	// While limp, the d-pad alone.
	backToMark: { keys: [ 'Numpad3' ], pad: [ 'up' ], limp: { pad: [ 'up' ] }, system: true },
	// Starts the course again from its first spawn: the page respawns between frames.
	restart: { keys: [ 'Backspace' ], pad: [ 'select' ], modes: ALWAYS, system: true },
	toggleUi: { keys: [ 'KeyH' ], modes: ALWAYS, system: true },
	easyMode: { keys: [ 'KeyB' ], modes: ALWAYS, system: true },
	captureReplay: { keys: [ 'KeyV' ], modes: ALWAYS, system: true },
	replayLibrary: { keys: [ 'KeyL' ], modes: ALWAYS, system: true },
	benchmark: { keys: [ 'KeyK' ], modes: ALWAYS, system: true }

};
