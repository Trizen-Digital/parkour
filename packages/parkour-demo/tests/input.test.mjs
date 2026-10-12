import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS } from '@trizendigital/parkour/data/actions.js';
import { lookDelta, mouseLook, stickLook } from '@trizendigital/parkour/input/response.js';
import { Input } from '@trizendigital/parkour/input/Input.js';
import { DeviceState } from '@trizendigital/parkour/input/deviceState.js';
import { PREFERENCE_DEFAULTS, PREFERENCE_LABELS, Preferences } from '@trizendigital/parkour/input/Preferences.js';
import { pressesOf } from '@trizendigital/parkour/replay/tape.js';
import { TUNING_DEFAULTS } from '@trizendigital/parkour/sim/tuning.js';

const DEG = Math.PI / 180;

const close = ( a, b, tolerance = 1e-12 ) => assert.ok( Math.abs( a - b ) <= tolerance, a + ' != ' + b );

// Pad buttons by their standard-mapping index.
const SOUTH = 0, EAST = 1, L1 = 4, R1 = 5, L2 = 6, R2 = 7, R3 = 11, UP = 12;

// An Input with no page around it: each test puts its devices in place before a sample.
function setup() {

	return new Input( { addEventListener() {} }, { values: { ...TUNING_DEFAULTS } }, { eventWindow: null, eventDocument: null, navigator: null, storage: null } );

}

// A pad with the standard mapping: axes as the page gives them (y down), buttons pressed (or a trigger's travel).
function pad( { axes = [ 0, 0, 0, 0 ], pressed = [], travel = {} } = {} ) {

	return {
		connected: true,
		mapping: 'standard',
		id: 'Test pad (STANDARD GAMEPAD)',
		axes,
		buttons: Array.from( { length: 17 }, ( _, i ) => {

			const value = travel[ i ] ?? ( pressed.includes( i ) ? 1 : 0 );
			return { pressed: pressed.includes( i ) || value > 0.5, value };

		} )
	};

}

function hold( input, ...codes ) {

	input.keys = new Set( codes );

}

test( 'the mouse turns the view a degree a count at sensitivity 1, its yaw held to 150 degrees a second', () => {

	const look = lookDelta( mouseLook( 10, 3, 1 ), { x: 0, y: 0 }, 1 / 60 );
	close( look.x, 2.5 * DEG * 2.5 );
	close( look.y, 3 * DEG * 2.5 );
	close( lookDelta( mouseLook( 10, 3, 1 ), { x: 0, y: 0 }, 1 / 144 ).x, 150 / 144 * DEG * 2.5 );

} );

test( 'the look stick reads half its travel through a round dead zone, turns by the frame time, and points y up', () => {

	const full = stickLook( 1, 0, 1, 125 * DEG, 0.2 );
	close( full.x, 125 * 0.375 * DEG );
	assert.equal( stickLook( 0.39, 0, 1, 125 * DEG, 0.2 ).x, 0 );
	assert.equal( stickLook( 1, 0, 0.5, 125 * DEG, 0.2 ).x, full.x / 2 );
	close( stickLook( 0, 1, 1, 125 * DEG, 0.2 ).y, 125 * 0.375 * DEG );

	// In play the stick's rate is scaled by the look sensitivity.
	const input = setup(), sensitivity = TUNING_DEFAULTS.mouseSensitivity;
	input.sample( 0.1, pad( { axes: [ 0, 0, 0, 1 ] } ) );
	close( input.look.stick.y, - 125 * sensitivity * 0.375 * DEG * 0.1, 1e-15 );
	input.preferences.values.invertStickY = true;
	input.sample( 0.1, pad( { axes: [ 0, 0, 0, 1 ] } ) );
	close( input.look.stick.y, 125 * sensitivity * 0.375 * DEG * 0.1, 1e-15 );

} );

test( 'the stick steers past a quarter of its travel on each axis, and pushes past the move dead zone, full at 0.9', () => {

	const input = setup();
	input.sample( 0.01, pad( { axes: [ 0.2, - 0.5, 0, 0 ] } ) );
	assert.equal( input.move.x, 0 );
	close( input.move.y, 1 / 3 );
	close( input.moveAmount, ( 0.6 - 0.2 ) / 0.7 );
	assert.ok( input.moveDirection.x > 0, 'a push too small to steer still counts as a direction' );

	input.sample( 0.01, pad( { axes: [ 0, - 0.75, 0, 0 ] } ) );
	assert.equal( input.moveAmount, 1 );
	input.sample( 0.01, pad( { axes: [ 0, - 0.16, 0, 0 ] } ) );
	assert.equal( input.moveAmount, 0 );

} );

test( 'a movement key steers and pushes in full; opposite keys cancel the steering but still push', () => {

	const input = setup();
	hold( input, 'KeyW', 'KeyD' );
	input.sample( 0.01 );
	assert.deepEqual( input.move, { x: 1, y: 1 } );
	assert.equal( input.moveAmount, 1 );
	close( Math.hypot( input.moveDirection.x, input.moveDirection.y ), 1 );

	hold( input, 'KeyA', 'KeyD' );
	input.sample( 0.01 );
	assert.equal( input.move.x, 0 );
	assert.equal( input.moveAmount, 1 );
	assert.equal( input.moveDirection.x, 0 );

	hold( input, 'KeyD' );
	input.sample( 0.01, pad( { axes: [ - 1, 0, 0, 0 ] } ) );
	assert.equal( input.move.x, 0, 'the key and the stick add up' );

} );

test( 'while limp the move still steers the ragdoll, but pushes nothing on foot', () => {

	const input = setup();
	input.setMode( 'limp' );
	hold( input, 'KeyW' );
	input.sample( 0.01 );
	assert.equal( input.move.y, 1 );
	assert.equal( input.moveAmount, 0 );
	assert.equal( input.held( 'limpMove' ), true );

	hold( input );
	input.sample( 0.01, pad( { axes: [ 0.15, 0, 0, 0 ] } ) );
	assert.equal( input.held( 'limpMove' ), false );
	input.sample( 0.01, pad( { axes: [ 0.2, 0, 0, 0 ] } ) );
	assert.equal( input.held( 'limpMove' ), true );

} );

test( 'a key tapped between two samples is pressed and released until the steps take it; the page takes its own presses once', () => {

	const handlers = new Map();
	const input = new Input( { addEventListener() {} }, { values: { ...TUNING_DEFAULTS } }, {
		eventWindow: { addEventListener: ( type, callback ) => handlers.set( type, callback ) },
		eventDocument: { addEventListener() {}, activeElement: null },
		navigator: { getGamepads: () => [] },
		storage: null
	} );
	handlers.get( 'keydown' )( { code: 'Space', target: null, preventDefault() {} } );
	handlers.get( 'keyup' )( { code: 'Space' } );
	input.sample( 1 / 240 );
	input.sample( 1 / 240 );
	assert.equal( input.held( 'jump' ), false );
	assert.equal( input.pressed( 'jump' ), true );
	assert.equal( input.released( 'jump' ), true );
	assert.equal( input.pressed( 'tuck' ), true, 'every button bound to the key' );
	input.consumeEdges();
	assert.equal( input.pressed( 'jump' ), false );

	handlers.get( 'keydown' )( { code: 'KeyP', target: null } );
	input.sample( 1 / 240 );
	assert.equal( input.pressed( 'pause' ), true );
	input.consumeSystemEdges();
	input.sample( 1 / 240 );
	assert.equal( input.pressed( 'pause' ), false );

} );

test( 'the limp action is held on the sample the stick click goes down only, and for as long as its key is held', () => {

	const input = setup();
	input.sample( 0.01, pad( { pressed: [ R3 ] } ) );
	assert.equal( input.held( 'goLimp' ), true );
	input.sample( 0.01, pad( { pressed: [ R3 ] } ) );
	assert.equal( input.held( 'goLimp' ), false );

	hold( input, 'Digit4' );
	input.sample( 0.01 );
	input.sample( 0.01 );
	assert.equal( input.held( 'goLimp' ), true );

} );

test( 'a flip then a dive within half a second is a spin dive', () => {

	const input = setup();
	const sequence = ( pause ) => {

		input.clear();
		hold( input, 'KeyF' );
		input.sample( 0.1 );
		hold( input );
		input.sample( pause );
		hold( input, 'KeyT' );
		input.sample( 0.01 );
		return input.held( 'spinDive' );

	};

	assert.equal( sequence( 0.1 ), true );
	assert.equal( sequence( 0.6 ), false );

} );

test( 'the triggers count from their slightest press, and a pad chord needs all its buttons', () => {

	const input = setup();
	input.sample( 0.01, pad( { travel: { [ R2 ]: 0.05, [ L2 ]: 0.02 } } ) );
	assert.equal( input.held( 'sprint' ), true );
	assert.equal( input.held( 'sprint', 'pad' ), true );
	assert.equal( input.held( 'grab', 'pad' ), true );

	input.sample( 0.01, pad( { pressed: [ L1 ] } ) );
	assert.equal( input.held( 'slide' ), false );
	input.sample( 0.01, pad( { pressed: [ L1, EAST ] } ) );
	assert.equal( input.held( 'slide' ), true );

	input.sample( 0.01, pad( { pressed: [ UP ] } ) );
	assert.equal( input.held( 'narrowView' ), false );
	input.sample( 0.01, pad( { pressed: [ R1, UP ] } ) );
	assert.equal( input.held( 'narrowView' ), true );

} );

test( 'an action asked on one device reads only that device\'s bindings, raw, in the current mode', () => {

	const input = setup();
	input.preferences.values.sprintToggle = true;
	hold( input, 'Space', 'KeyG' );
	input.sample( 0.01, pad( { travel: { [ R2 ]: 1 } } ) );
	assert.equal( input.held( 'jump', 'keys' ), true );
	assert.equal( input.held( 'jump', 'pad' ), false );
	assert.equal( input.held( 'backflip' ), true );
	assert.equal( input.held( 'sprint', 'pad' ), true );

	input.consumeEdges();
	input.sample( 0.01, pad() );
	assert.equal( input.held( 'sprint', 'pad' ), false );
	assert.equal( input.held( 'sprint' ), true, 'the toggle latched it on the press' );

	input.setMode( 'limp' );
	input.sample( 0.01, pad( { travel: { [ R2 ]: 1 } } ) );
	assert.equal( input.held( 'sprint', 'pad' ), false, 'sprint is not live while limp' );

} );

test( 'the sprint toggle latches on a press and lets go on the next', () => {

	const input = setup();
	input.preferences.values.sprintToggle = true;
	const step = ( ...codes ) => {

		hold( input, ...codes );
		input.sample( 0.01 );
		input.consumeEdges();
		return input.held( 'sprint' );

	};

	assert.equal( step( 'ShiftLeft' ), true );
	assert.equal( step(), true );
	assert.equal( step( 'ShiftRight' ), false );
	assert.equal( step(), false );

} );

test( 'an axis takes its binding with the larger magnitude, the first listed on a tie', () => {

	const input = setup();
	input.enabled = true;
	input.mouse.x = 3;
	hold( input, 'KeyA' );
	input.sample( 0.01 );
	assert.equal( input.value( 'poleTurn' ), 3 );

	input.mouse.x = 1;
	input.sample( 0.01 );
	assert.equal( input.value( 'poleTurn' ), 1, 'the mouse is listed before the keys' );

	hold( input, 'KeyA', 'KeyD' );
	input.sample( 0.01 );
	assert.equal( input.value( 'slideSteer' ), - 1 );

	hold( input );
	input.sample( 0.01, pad( { axes: [ 0.5, 0, 0, 0 ] } ) );
	assert.equal( input.value( 'slideSteer' ), 0.5, 'the slide steers by the raw stick' );
	close( input.value( 'poleTurn' ), ( 0.5 - 0.2 ) / 0.8 );
	assert.equal( input.value( 'stickSide' ), 0 );
	input.sample( 0.01, pad( { axes: [ - 0.95, 0, 0, 0 ] } ) );
	close( input.value( 'stickSide' ), - 0.5, 1e-9 );

} );

test( 'the trick stick reads 0 to 50 past its round dead zone, and the mouse flick its counts with y up', () => {

	const input = setup();
	input.enabled = true;
	input.mouse.x = 3;
	input.mouse.y = 2;
	input.sample( 0.01, pad( { axes: [ 0.5, 0, 0, 0 ] } ) );
	close( input.value( 'stick' ).x, 0.3 / 0.7 );
	assert.deepEqual( input.value( 'mouseFlick' ), { x: 3, y: - 2 } );
	input.sample( 0.01, pad( { axes: [ 0.15, - 0.1, 0, 0 ] } ) );
	assert.deepEqual( input.value( 'stick' ), { x: 0, y: 0 } );

} );

test( 'while limp the keys stand the runner up instead of jumping, and the mouse turns the view at the stick\'s fixed rate', () => {

	const input = setup();
	input.setMode( 'limp' );
	hold( input, 'Space', 'KeyF', 'Numpad3' );
	input.sample( 0.01 );
	assert.equal( input.held( 'standUp' ), true );
	assert.equal( input.held( 'jump' ), false );
	assert.equal( input.held( 'flip' ), false );
	assert.equal( input.pressed( 'backToMark' ), false, 'back to the mark is on the pad alone while limp' );

	input.enabled = true;
	input.mouse.x = 4;
	input.mouse.y = 2;
	input.sample( 0.01 );
	const sensitivity = TUNING_DEFAULTS.mouseSensitivity;
	close( input.look.mouse.x, 0 );
	close( input.look.stick.x, 4 * 0.01 * 125 * DEG * sensitivity );
	close( input.look.stick.y, 2 * 0.01 * 125 * DEG * sensitivity );

	input.setMode( 'play' );
	input.sample( 0.01 );
	assert.equal( input.held( 'jump' ), true );
	assert.equal( input.held( 'standUp' ), false );
	assert.equal( input.pressed( 'jump' ), true, 'a key held through a mode switch is a new press' );

} );

test( 'a mode switch inside a frame reads the frame\'s devices again for the new mode, with no presses until the next sample', () => {

	const input = setup();
	input.setMode( 'limp' );
	hold( input, 'Space', 'KeyW' );
	input.sample( 0.02, pad( { axes: [ 0.5, 0, 0, 0 ] } ) );
	assert.equal( input.moveAmount, 0 );
	assert.deepEqual( input.value( 'stick' ), { x: 0, y: 0 } );

	// The ragdoll gets up during the frame's steps.
	input.setMode( 'play' );
	assert.equal( input.held( 'jump' ), true );
	assert.equal( input.held( 'forward' ), true );
	assert.equal( input.held( 'standUp' ), false );
	assert.equal( input.moveAmount, 1 );
	close( input.value( 'stick' ).x, 0.3 / 0.7 );
	assert.equal( input.pressed( 'jump' ), false );

	input.sample( 0.02, pad( { axes: [ 0.5, 0, 0, 0 ] } ) );
	assert.equal( input.pressed( 'jump' ), true );

	// And the runner bails during another.
	input.setMode( 'limp' );
	assert.equal( input.held( 'limpMove' ), true );
	assert.equal( input.held( 'jump' ), false );

} );

test( 'typing in a field keeps the keys and the pad from the game, and sampling carries on', () => {

	const document = { activeElement: { tagName: 'INPUT' }, addEventListener() {} };
	const input = new Input( { addEventListener() {} }, { values: { ...TUNING_DEFAULTS } }, {
		eventDocument: document,
		eventWindow: { addEventListener() {} },
		navigator: { getGamepads: () => [] },
		storage: null
	} );
	const south = pad( { pressed: [ SOUTH ] } );
	hold( input, 'KeyE' );
	assert.doesNotThrow( () => input.sample( 1 / 60, south ) );
	assert.equal( input.held( 'jump' ), false );
	assert.equal( input.held( 'precision' ), false );

	document.activeElement = null;
	input.sample( 1 / 60, south );
	assert.equal( input.held( 'jump' ), true );
	assert.equal( input.held( 'precision' ), true );

} );

test( 'the pad is the device in use from its first push until a key or the mouse moves', () => {

	const input = setup();
	input.sample( 0.01, pad( { axes: [ 0.1, 0, 0, 0 ] } ) );
	assert.equal( input.usingPad, false );
	input.sample( 0.01, pad( { axes: [ 0.3, 0, 0, 0 ] } ) );
	assert.equal( input.usingPad, true );
	assert.equal( input.deviceName, 'GAMEPAD · Test pad' );
	input.sample( 0.01, pad() );
	assert.equal( input.usingPad, true );
	hold( input, 'KeyW' );
	input.sample( 0.01, pad() );
	assert.equal( input.usingPad, false );

} );

test( 'a recorded frame plays back as the same devices, and the page\'s keys stay out of a playback', () => {

	const live = setup(), replayed = setup();
	const recorder = new DeviceState( live ), player = new DeviceState( replayed );
	recorder.record();
	live.enabled = true;
	live.keys = new Set( [ 'KeyW' ] );
	live.mouse = { x: 2, y: - 1, wheel: 0 };
	live.queueKey( 'Space', 'pressed' );
	live.navigator = { getGamepads: () => [ pad( { axes: [ 0, - 0.5, 0, 0 ], pressed: [ L1 ] } ) ] };
	const frame = recorder.capture( 1 / 60 );
	live.sample( 1 / 60 );

	player.play();
	replayed.queueKey( 'KeyT', 'pressed' );
	player.apply( frame );
	replayed.sample( 1 / 60 );
	for ( const action of [ 'jump', 'dive', 'precision', 'forward' ] ) {

		assert.equal( replayed.held( action ), live.held( action ), action );
		assert.equal( replayed.pressed( action ), live.pressed( action ), action );

	}

	assert.deepEqual( replayed.move, live.move );
	assert.deepEqual( replayed.look, live.look );

} );

test( 'every action the game asks for is in the table', () => {

	// The game asks in the demo's code and in the core's (the package's src, wherever it is installed).
	const roots = [ path.join( path.dirname( fileURLToPath( import.meta.url ) ), '../src' ), path.dirname( fileURLToPath( import.meta.resolve( '@trizendigital/parkour' ) ) ) ];
	const asked = new Set();

	for ( const root of roots ) {

		for ( const file of fs.readdirSync( root, { recursive: true } ).filter( ( file ) => file.endsWith( '.js' ) ) ) {

			const text = fs.readFileSync( path.join( root, file ), 'utf8' );
			for ( const [ , name ] of text.matchAll( /input\??\.(?:held|pressed|released|value)\??\.?\(\s*'(\w+)'/g ) ) asked.add( name );

		}

	}

	assert.ok( asked.size > 30, `${asked.size} actions asked for` );
	for ( const name of asked ) assert.ok( ACTIONS[ name ], `'${name}' is not in the action table` );

} );

test( 'the QA timeline marks a press when an action\'s binding goes down, or when its key is tapped between frames', () => {

	const frame = ( { keys = [], edges = [], pad = null } = {} ) => ( { dt: 1 / 60, keys, buttons: [], mouse: [ 0, 0, 0 ], edges, pad, enabled: true, editing: false } );
	const south = { id: 'pad', axes: [ 0, 0, 0, 0 ], buttons: [ [ 1, 1 ] ] };
	const { presses, held } = pressesOf( [
		frame( { keys: [ 'ShiftRight' ] } ),
		frame( { keys: [ 'ShiftRight' ] } ),
		frame( { edges: [ [ 'KeyT', 'pressed' ], [ 'KeyT', 'released' ] ] } ),
		frame( { pad: south } )
	] );
	assert.deepEqual( presses, [ [ 0, 'sprint' ], [ 2, 'dive' ], [ 3, 'jump' ] ] );
	assert.ok( held[ 1 ].has( 'sprint' ) && ! held[ 2 ].has( 'dive' ) );

} );

test( 'the saved look inversion and camera choices come back as set, each on its own', () => {

	const memory = new Map();
	const storage = {
		getItem: ( key ) => memory.get( key ),
		setItem: ( key, value ) => memory.set( key, value )
	};
	new Preferences( storage ).replace( { invertStickY: true, headCamera: true, cameraLag: false, sprintToggle: 'yes' } );
	const restored = new Preferences( storage );
	assert.equal( restored.values.invertMouseY, false );
	assert.equal( restored.values.invertStickY, true );
	assert.equal( restored.values.headCamera, true );
	assert.equal( restored.values.cameraLag, false );
	assert.equal( restored.values.tricksInFirstPerson, true );
	assert.equal( restored.values.sprintToggle, false, 'a value of the wrong kind is ignored' );

} );

test( 'each preference has its switch on the panel; one set there is kept, and back to defaults keeps the defaults', () => {

	assert.deepEqual( Object.keys( PREFERENCE_LABELS ), Object.keys( PREFERENCE_DEFAULTS ) );

	const memory = new Map();
	const storage = {
		getItem: ( key ) => memory.get( key ),
		setItem: ( key, value ) => memory.set( key, value )
	};
	const preferences = new Preferences( storage );
	preferences.set( 'sprintToggle', true );
	preferences.set( 'cameraLag', false );
	assert.equal( new Preferences( storage ).values.sprintToggle, true );
	assert.equal( new Preferences( storage ).values.cameraLag, false );

	preferences.reset();
	assert.deepEqual( new Preferences( storage ).values, PREFERENCE_DEFAULTS );

} );
