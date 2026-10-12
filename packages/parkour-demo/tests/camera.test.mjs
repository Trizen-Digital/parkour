import test from 'node:test';
import assert from 'node:assert/strict';
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ViewControl } from '@trizendigital/parkour/camera/ViewControl.js';
import { FollowCamera } from '@trizendigital/parkour/camera/FollowCamera.js';
import { Shake, envelope, bump, EPICENTER_REACH } from '@trizendigital/parkour/camera/Shake.js';
import { CAMERA } from '@trizendigital/parkour/data/camera.js';
import { Input } from '@trizendigital/parkour/input/Input.js';
import { movementMode } from '@trizendigital/parkour/runner/states.js';
import { Clock } from '@trizendigital/parkour/runner/Clock.js';
import { TUNING_DEFAULTS } from '@trizendigital/parkour/sim/tuning.js';

const DEG = Math.PI / 180;
const UP = new Vector3( 0, 1, 0 );
const { thirdPerson: THIRD, firstPerson: FIRST } = CAMERA;

// How the first-person camera sits on the head when it rides the head: the figure's head frame (x ahead of the face,
// y up) turned a quarter turn about up to the camera's (looking down its −z).
const ON_HEAD = new Quaternion().setFromAxisAngle( UP, - Math.PI / 2 );

const close = ( a, b, tolerance = 1e-9 ) => assert.ok( Math.abs( a - b ) <= tolerance, a + ' != ' + b );

// The sampled input as the camera reads it: the look over a frame of `dt` seconds.
function controls( { mouse = { x: 0, y: 0 }, stick = { x: 0, y: 0 }, move = { x: 0, y: 0 }, held = [], padHeld = [], preferences = {}, dt = 1 / 60 } = {} ) {

	return {
		dt,
		look: { mouse, stick },
		move,
		held: ( name, device ) => ( device === 'pad' ? padHeld : held ).includes( name ),
		value: () => 0,
		preferences: { values: preferences }
	};

}

function setup( { input = controls(), queries = { sphereCast: () => null } } = {} ) {

	const camera = new PerspectiveCamera( 60, 16 / 9 );
	const tuning = { values: { ...TUNING_DEFAULTS }, set( key, value ) {

		this.values[ key ] = value;

	} };
	const view = new ViewControl( tuning );
	const followCamera = new FollowCamera( camera, tuning, queries, input );
	const runner = {
		position: new Vector3(),
		velocity: new Vector3(),
		yaw: 0,
		state: 'standing',
		grounded: true,
		events: [],
		firstPerson: false,
		motion: { moves: { playing: () => null }, takeOf: ( name ) => name },
		tricks: { cartwheeling: false, largeTrickReady: true },
		capsule: { halfHeight: 0.9 },
		walls: { side: null },
		clock: new Clock()
	};
	const head = { position: new Vector3( 0, 1.7, 0 ), quaternion: new Quaternion() };
	const figure = { headPose: () => ( { position: head.position.clone(), quaternion: head.quaternion.clone() } ) };

	view.reset( runner.yaw );
	followCamera.reset( runner.position, runner.yaw );

	// A frame as the game runs it: the look, then (after the steps) the view and the camera body, and the frame's
	// events handed over once.
	const frame = ( dt, frameInput = input ) => {

		followCamera.input = frameInput;
		view.look( frameInput, runner );
		view.update( dt, runner );
		followCamera.update( dt, view, runner, runner.position, figure );
		runner.events.length = 0;

	};

	return { camera, tuning, view, followCamera, runner, head, frame };

}

function pad( ...pressed ) {

	return {
		connected: true,
		mapping: 'standard',
		id: 'Test pad (STANDARD GAMEPAD)',
		axes: [ 0, 0, 0, 0 ],
		buttons: Array.from( { length: 17 }, ( _, i ) => ( { pressed: pressed.includes( i ), value: pressed.includes( i ) ? 1 : 0 } ) )
	};

}

const pitchDown = ( camera ) => - Math.asin( camera.getWorldDirection( new Vector3() ).y );

// The view (the aim the runner steers by)

test( 'the look turns the view by the mouse and the stick, the mouse\'s turn held to 150° a second at any frame rate', () => {

	const { view, runner } = setup();
	view.look( controls( { mouse: { x: 0.01, y: 0.002 }, stick: { x: 0.004, y: 0 } } ), runner );
	close( view.yaw, - ( 0.01 + 0.004 ) * 2.5 );
	close( view.pitch, 0.002 * 2.5 );

	// A flick as fast as it goes turns the view as far in a second at 60 frames a second as at 144: 2.5° a frame at 60.
	const second = ( fps ) => {

		view.reset( 0 );
		for ( let frame = 0; frame < fps; frame ++ ) view.look( controls( { mouse: { x: 1, y: 0 }, dt: 1 / fps } ), runner );
		return view.yaw;

	};

	close( second( 60 ), - 150 * DEG * 2.5, 1e-12 );
	close( second( 144 ), - 150 * DEG * 2.5, 1e-12 );
	view.reset( 0 );
	view.look( controls( { mouse: { x: 1, y: 0 } } ), runner );
	close( view.yaw, - 2.5 * DEG * 2.5 );

} );

test( 'the view looks at most 30° up and 40° down, and nearly straight down at a bailing body', () => {

	const { view, runner } = setup();
	view.look( controls( { mouse: { x: 0, y: - 1 } } ), runner );
	close( view.pitch, - 30 * DEG );
	view.look( controls( { mouse: { x: 0, y: 1 } } ), runner );
	close( view.pitch, 40 * DEG );

	runner.state = 'bailing';
	view.look( controls( { mouse: { x: 0, y: 1 } } ), runner );
	close( view.pitch, 85 * DEG );

} );

test( 'in the air the mouse looks only with free look held, never through a power jump off a ledge; the stick always looks', () => {

	const { view, runner } = setup();
	const mouse = { x: 0.01, y: 0 };
	runner.grounded = false;
	runner.state = 'falling';
	view.look( controls( { mouse, stick: { x: 0.02, y: 0 } } ), runner );
	close( view.yaw, - 0.05 );

	view.reset( 0 );
	view.look( controls( { mouse, held: [ 'freeLook' ] } ), runner );
	close( view.yaw, - 0.025 );

	view.reset( 0 );
	runner.motion = {
		moves: { playing: () => ( { name: 'powerJumpOffLeft' } ) },
		takeOf: ( name ) => name === 'powerJumpOffLeft' ? 'vault_power_off_left' : name
	};
	view.look( controls( { mouse, held: [ 'freeLook' ] } ), runner );
	close( view.yaw, 0 );

	// On a pole the runner is held, not falling: the mouse looks.
	runner.state = 'onPole';
	view.look( controls( { mouse } ), runner );
	close( view.yaw, - 0.025 );

} );

test( 'in first person a climb holds the view still, and a trick keeps the heading but lets the view tip', () => {

	const { view, runner } = setup();
	const both = controls( { mouse: { x: 0.1, y: 0.01 }, stick: { x: 0.1, y: 0.01 } } );
	runner.firstPerson = true;
	runner.state = 'climbingUp';
	runner.climbingLedge = true;
	view.look( both, runner );
	close( view.yaw, 0 );
	close( view.pitch, 0 );

	runner.state = 'standing';
	runner.climbingLedge = false;
	runner.tricking = true;
	view.look( both, runner );
	close( view.yaw, 0 );
	close( view.pitch, 0.05 );

} );

test( 'entering first person recentres the view on the runner; the aim\'s events face it or recentre it', () => {

	const { view, runner, frame } = setup();
	view.look( controls( { mouse: { x: 0.01, y: 0.01 } } ), runner );
	runner.yaw = 1;
	frame( 0.01 );
	close( view.yaw, - 0.025 );

	runner.firstPerson = true;
	frame( 0.01 );
	close( view.yaw, 1 );
	close( view.pitch, 0 );

	runner.events.push( { type: 'camera', name: 'faceView', yaw: 2, pitch: 0.3 } );
	frame( 0.01 );
	close( view.yaw, 2 );
	close( view.pitch, 0.3 );

	runner.events.push( { type: 'camera', name: 'recenterView' } );
	frame( 0.01 );
	close( view.yaw, 1 );

} );

test( 'a turn of the view eases round to its yaw and pitch, and looking about ends it where it is', () => {

	const { view, runner, frame } = setup();
	runner.firstPerson = true;
	frame( 0.01 );

	runner.events.push( { type: 'camera', name: 'turnView', yaw: 1, pitch: 0.4 } );
	frame( 1 / 60 );
	assert.ok( view.yaw > 0 && view.yaw < 0.5 && view.pitch > 0 && view.pitch < 0.2, 'part way in a frame' );
	for ( let f = 0; f < 120; f ++ ) frame( 1 / 60 );
	close( view.yaw, 1, 0.01 );
	close( view.pitch, 0.4, 0.01 );
	assert.equal( view.turning, null );

	// Looking about while it turns: the look has the view from there.
	runner.events.push( { type: 'camera', name: 'turnView', pitch: 0 } );
	frame( 1 / 60 );
	const pitch = view.pitch;
	frame( 1 / 60, controls( { mouse: { x: 0, y: 0.001 } } ) );
	assert.equal( view.turning, null );
	for ( let f = 0; f < 30; f ++ ) frame( 1 / 60 );
	assert.ok( view.pitch > pitch - 0.05, 'no longer turned back up' );

} );

test( 'with tricks in first person a cartwheel comes back to first person; without, a trick steps out to third person until it is over', () => {

	const { view, runner } = setup();
	const check = ( preferences ) => {

		view.look( controls( { preferences } ), runner );
		view.update( 0.1, runner );

	};
	runner.firstPerson = true;
	runner.tricks.cartwheeling = true;
	check( { tricksInFirstPerson: true } );
	assert.equal( runner.firstPerson, true );
	assert.equal( view.returnToFirstPerson, true );

	runner.tricks.cartwheeling = false;
	runner.tricking = true;
	check( { tricksInFirstPerson: false } );
	assert.equal( runner.firstPerson, false );

	runner.tricking = false;
	check( { tricksInFirstPerson: false } );
	assert.equal( runner.firstPerson, true );

} );

test( 'the trick rule is checked every 0.1 s, not every frame', () => {

	const { view, runner } = setup();
	runner.firstPerson = true;
	runner.tricking = true;
	view.look( controls( { preferences: { tricksInFirstPerson: false } } ), runner );
	view.update( 0.05, runner );
	assert.equal( runner.firstPerson, true );
	view.update( 0.05, runner );
	assert.equal( runner.firstPerson, false );

} );

test( 'moving sideways turns the view toward the move, unless the right stick is looking or the runner is slow', () => {

	const { view, runner } = setup();
	const step = ( input ) => {

		view.look( input, runner );
		view.update( 0.01, runner );

	};
	runner.velocity.z = 5;
	step( controls( { move: { x: 1, y: 0 } } ) );
	close( view.yaw, ( - Math.PI / 2 ) * 0.01 * 0.85 * 2.5 );

	// The stick's own turn, and nothing more.
	const before = view.yaw;
	step( controls( { move: { x: 1, y: 0 }, stick: { x: 0.01, y: 0 } } ) );
	close( view.yaw, before - 0.01 * 2.5 );

	const after = view.yaw;
	runner.velocity.z = 1.5;
	step( controls( { move: { x: 1, y: 0 } } ) );
	close( view.yaw, after );

} );

test( 'on a wall run in third person the view lines up with the run, turned 10° toward a wall on the right, and levels out', () => {

	const { view, runner } = setup();
	view.look( controls(), runner );
	view.pitch = 0.4;
	runner.state = 'wallRunning';
	runner.walls = { side: 'right' };
	runner.yaw = 1;
	view.update( 0.05, runner );
	close( view.yaw, ( 1 - 10 * DEG ) * 0.05 * 8.5 );
	close( view.pitch, 0.4 * ( 1 - 0.05 * 8.5 ) );

} );

test( 'the field of view setting narrows and widens with the chord and the wheel, within each view\'s range, and is saved', () => {

	const { tuning, view, runner } = setup();
	const writes = [];
	const set = tuning.set;
	tuning.set = ( key, value ) => {

		writes.push( key );
		set.call( tuning, key, value );

	};
	const input = new Input( { addEventListener() {} }, tuning, { eventWindow: null, eventDocument: null, navigator: null, storage: null } );
	const look = ( gamepad, wheel = 0 ) => {

		input.mouse.wheel = wheel;
		input.sample( 1 / 60, gamepad );
		view.look( input, runner );

	};
	const R1 = 5, UP_BUTTON = 12, DOWN_BUTTON = 13;

	look( pad( UP_BUTTON ) );
	assert.equal( writes.length, 0 );
	look( pad( R1, UP_BUTTON ) );
	close( tuning.values.fov, 114.75 * DEG );
	look( pad(), 1 );
	close( tuning.values.fov, 113.25 * DEG );

	tuning.values.fov = 90 * DEG;
	look( pad( R1, UP_BUTTON, DOWN_BUTTON ) );
	close( tuning.values.fov, 90.25 * DEG );

	runner.firstPerson = true;
	look( pad(), 20 );
	close( tuning.values.firstPersonFov, 130 * DEG );
	close( tuning.values.fov, 90.25 * DEG );
	look( pad( R1, DOWN_BUTTON ) );
	close( tuning.values.firstPersonFov, 130.25 * DEG );
	assert.equal( writes.at( - 1 ), 'firstPersonFov' );

} );

// The camera body

test( 'in third person the camera hangs behind the runner over the shoulder, looks down by its fixed pitch, and sees 10° less than the setting at rest', () => {

	const { camera, followCamera, frame } = setup();
	frame( 0 );
	close( camera.position.x, - 0.5 );
	close( camera.position.y, 0.66 );
	close( camera.position.z, - ( 3 + 0.25 - 1.2 ) );
	close( pitchDown( camera ), 8.5 * DEG );
	close( followCamera.fov, 105 * DEG );

	// three.js is handed the vertical angle in degrees for the window's shape.
	close( camera.fov, 72.487623, 1e-6 );

} );

test( 'the speed zoom eases in along a smoothstep and back from wherever it has got to, drawing the camera in and widening the view', () => {

	const { camera, followCamera, runner, frame } = setup();
	runner.sprinting = true;
	frame( 0.75 );
	close( followCamera.speedZoom.value, 0.5 );
	close( followCamera.fov, 110 * DEG );
	close( camera.position.z, - ( 3 + 0.125 - 1.2 ) );

	runner.sprinting = false;
	frame( 0.375 );
	close( followCamera.speedZoom.time, 0.375 );
	close( followCamera.speedZoom.value, 0.15625 );

	for ( const [ name, length ] of Object.entries( CAMERA.eases ) ) {

		const ease = followCamera[ name ];
		ease.time = 0;
		close( ease.update( length / 4, true ), 0.15625 );
		close( ease.update( length, true ), 1 );
		close( ease.update( length * 2, false ), 0 );

	}

} );

test( 'falling, gliding a zipline or sliding zooms out as at speed; in the air the camera also tilts down, but a bail does neither', () => {

	const { camera, followCamera, runner, frame } = setup();
	runner.state = 'climbingUp';
	runner.grounded = false;
	runner.velocity.set( 0, - 12, 0 );
	runner.ledges = { placement: { mode: 'guided' } };
	frame( 0.2 );
	close( followCamera.fallTilt.time, 0 );
	close( followCamera.speedZoom.time, 0 );

	runner.ledges.placement.mode = 'air';
	frame( 0.9 );
	close( followCamera.fallTilt.time, 0.9 );
	close( followCamera.speedZoom.time, 0.9 );
	close( pitchDown( camera ), MathUtils.lerp( 8.5, 25.5, 0.5 ) * DEG );

	runner.state = 'bailing';
	assert.equal( movementMode( runner ), 'guided' );
	frame( 0.9 );
	close( followCamera.fallTilt.time, 0 );
	close( followCamera.speedZoom.time, 0 );

	runner.state = 'onZipline';
	frame( 0.1 );
	close( followCamera.speedZoom.time, 0.1 );

} );

test( 'the aim zoom follows its camera events, bringing the camera over the shoulder', () => {

	const { camera, followCamera, runner, frame } = setup();
	runner.state = 'aiming';
	frame( 0.2 );
	close( followCamera.aimZoom.time, 0 );

	runner.events.push( { type: 'camera', name: 'aimZoomIn' } );
	frame( 1 );
	close( camera.position.y, 0.41 );
	close( camera.position.z, - ( 3.25 - 1.5 ) );

	runner.events.push( { type: 'camera', name: 'aimZoomOut' } );
	frame( 0.25 );
	close( followCamera.aimZoom.time, 0.75 );

} );

test( 'the camera trails the runner the same way at any frame rate: two half frames are one whole one', () => {

	const one = setup(), two = setup();

	for ( const { runner } of [ one, two ] ) runner.position.set( 1, 2, 3 );
	one.frame( 0.02 );
	two.frame( 0.01 );
	two.frame( 0.01 );

	for ( const axis of [ 'x', 'y', 'z' ] ) {

		close( one.followCamera.follow[ axis ], two.followCamera.follow[ axis ], 1e-12 );
		close( one.followCamera.armRoot[ axis ], two.followCamera.armRoot[ axis ], 1e-12 );
		close( one.camera.position[ axis ], two.camera.position[ axis ], 1e-12 );

	}

	close( one.followCamera.follow.x, 1 - Math.exp( - THIRD.followRate * 0.02 ) );
	close( one.followCamera.follow.y, 2 * ( 1 - Math.exp( - THIRD.verticalFollowRate * 0.02 ) ) );

} );

test( 'a ledge move\'s camera lag picks the tuning\'s slow follow, unless the player has turned the lag off', () => {

	const lagged = setup();
	lagged.runner.cameraLag = true;
	lagged.runner.position.set( 1, 1, 1 );
	lagged.frame( 0.01 );
	close( lagged.followCamera.follow.x, 1 - Math.exp( - TUNING_DEFAULTS.cameraFollowRate * 0.01 ) );
	close( lagged.followCamera.follow.y, 1 - Math.exp( - TUNING_DEFAULTS.cameraVerticalFollowRate * 0.01 ) );

	const off = setup( { input: controls( { preferences: { cameraLag: false } } ) } );
	off.runner.cameraLag = true;
	off.runner.position.set( 1, 1, 1 );
	off.frame( 0.01 );
	close( off.followCamera.follow.x, 1 - Math.exp( - THIRD.followRate * 0.01 ) );

} );

test( 'however far the runner goes in a frame, the arm\'s root stays within reach of the follow point', () => {

	const { followCamera, runner, frame } = setup();
	runner.position.set( 0, 0, 10 );
	frame( 0.016 );
	close( followCamera.armRoot.distanceTo( followCamera.follow ), THIRD.maxLag );

} );

test( 'the third-person camera turns after the aim, without probing for walls', () => {

	let probes = 0;
	const { camera, view, followCamera, runner, frame } = setup( { queries: { sphereCast: () => {

		probes ++;
		return null;

	} } } );
	frame( 0 );
	view.look( controls( { stick: { x: - 0.2, y: 0 } } ), runner );
	followCamera.update( 0.05, view, runner, runner.position, null );
	const turned = followCamera.turn.angleTo( new Quaternion().setFromAxisAngle( UP, Math.PI ) );
	close( turned, 0.5 * ( 1 - Math.exp( - TUNING_DEFAULTS.cameraTurnRate * 0.05 ) ), 1e-6 );
	assert.ok( camera.position.x < - 0.5 );
	assert.equal( probes, 0 );

} );

test( 'in first person the camera sits just ahead of the eyes, kept out of walls by a sphere swept there from the top of the capsule on the camera group', () => {

	const casts = [];
	const { camera, followCamera, runner, frame } = setup( { queries: { sphereCast: ( from, to, radius, options ) => {

		casts.push( { from: from.clone(), to: to.clone(), radius, group: options.group } );
		return null;

	} } } );
	runner.firstPerson = true;
	frame( 0.01 );
	close( camera.position.x, 0.075 );
	close( camera.position.y, 1.7 );
	close( camera.position.z, 0.15 );
	assert.equal( casts[ 0 ].group, 'camera' );
	close( casts[ 0 ].radius, FIRST.probeRadius );
	close( casts[ 0 ].from.z, 0 );
	close( casts[ 0 ].from.y, 0.9 - 0.185 );
	close( followCamera.fov, TUNING_DEFAULTS.firstPersonFov );

	// A wall in the way: the camera stops where the sphere touched it.
	const blocked = setup( { queries: { sphereCast: () => ( { centre: new Vector3( 0.075, 1.7, 0.05 ) } ) } } );
	blocked.runner.firstPerson = true;
	blocked.frame( 0.01 );
	close( blocked.camera.position.z, 0.05 );

} );

test( 'in first person the view rides the head when told to, turning with it at once through a trick or a wall kick, and lagging otherwise', () => {

	const { camera, followCamera, runner, head, frame } = setup();
	const onHead = () => head.quaternion.clone().multiply( ON_HEAD );
	runner.firstPerson = true;
	frame( 0.01 );
	runner.events.push( { type: 'camera', name: 'viewOnHead' } );
	head.quaternion.setFromAxisAngle( UP, 0.5 );
	frame( 0.01 );
	assert.ok( camera.quaternion.angleTo( onHead() ) > 0.4 );

	runner.tricking = true;
	frame( 0.01 );
	close( camera.quaternion.angleTo( onHead() ), 0, 1e-6 );

	runner.tricking = false;
	runner.kickedOffWall = true;
	head.quaternion.setFromAxisAngle( UP, 1 );
	frame( 0.01 );
	close( camera.quaternion.angleTo( onHead() ), 0, 1e-6 );

	runner.kickedOffWall = false;
	head.quaternion.setFromAxisAngle( UP, 1.5 );
	frame( 0.01 );
	close( camera.quaternion.angleTo( onHead() ), 0.5 * Math.exp( - FIRST.turnRate * 0.01 ), 1e-6 );

	// Set free, it rides the head only if the player wants that.
	runner.events.push( { type: 'camera', name: 'viewFree' } );
	frame( 0.01 );
	assert.equal( followCamera.viewOnHead, false );

} );

test( 'riding the head of a runner facing ahead, the first-person view looks ahead, upright', () => {

	const { camera, runner, head, frame } = setup();
	runner.firstPerson = true;
	frame( 0.01 );

	// The head's frame of a runner facing +z: its x (ahead of the face) along +z, its y up.
	head.quaternion.setFromAxisAngle( UP, - Math.PI / 2 );
	runner.events.push( { type: 'camera', name: 'viewOnHead' } );
	runner.tricking = true;
	frame( 0.01 );

	const ahead = new Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
	const up = new Vector3( 0, 1, 0 ).applyQuaternion( camera.quaternion );
	close( ahead.z, 1, 1e-6 );
	close( up.y, 1, 1e-6 );

} );

test( 'switching view is a cut: back in third person the camera is where it would have been', () => {

	const stayed = setup(), switched = setup();

	for ( let i = 0; i < 60; i ++ ) {

		for ( const s of [ stayed, switched ] ) {

			s.runner.position.z += 0.1;
			s.runner.firstPerson = s === switched && i >= 20 && i < 40;
			s.frame( 1 / 60 );

		}

		if ( i === 20 ) close( switched.camera.quaternion.angleTo( switched.followCamera.turn ), 0 );

	}

	close( switched.camera.position.distanceTo( stayed.camera.position ), 0, 1e-9 );
	close( switched.camera.quaternion.angleTo( stayed.camera.quaternion ), 0, 1e-6 );

} );

test( 'a camera event starts its shake, an unknown one nothing, and a state change alone no shake', () => {

	const { followCamera, runner, frame } = setup();
	runner.events.push( { type: 'camera', name: 'landing' }, { type: 'camera', name: 'speedZoomOut' }, { type: 'camera', name: 'faceView', yaw: 0 } );
	frame( 0.01 );
	assert.deepEqual( followCamera.shakes.active.map( ( shake ) => shake.name ), [ 'landing' ] );

	runner.state = 'rising';
	runner.events.push( { type: 'state', from: 'standing', to: 'rising' } );
	frame( 0.01 );
	assert.equal( followCamera.shakes.active.length, 1 );

} );

test( 'running flat out with the pad\'s sprint held bobs the camera every 0.2 s, on the ground only', () => {

	const { followCamera, runner, frame } = setup();
	const started = [];
	const start = followCamera.shakes.start.bind( followCamera.shakes );
	followCamera.shakes.start = ( name, options ) => {

		started.push( name );
		return start( name, options );

	};
	const sprinting = controls( { padHeld: [ 'sprint' ] } );
	runner.velocity.set( 0, 0, 5 );

	for ( let i = 0; i < 10; i ++ ) frame( 0.1, sprinting );
	assert.deepEqual( started, [ 'runBob', 'runBob', 'runBob', 'runBob', 'runBob' ] );

	started.length = 0;
	for ( let i = 0; i < 4; i ++ ) frame( 0.1, controls( { held: [ 'sprint' ] } ) );
	runner.velocity.set( 0, 0, 4 );
	for ( let i = 0; i < 4; i ++ ) frame( 0.1, sprinting );
	runner.velocity.set( 0, 0, 5 );
	runner.grounded = false;
	runner.state = 'falling';
	for ( let i = 0; i < 4; i ++ ) frame( 0.1, sprinting );
	assert.deepEqual( started, [] );

	runner.grounded = true;
	runner.state = 'running';
	runner.firstPerson = true;
	for ( let i = 0; i < 2; i ++ ) frame( 0.1, sprinting );
	assert.deepEqual( started, [ 'runBobFirstPerson' ] );

} );

// Shakes

test( 'a shake fades in and out linearly over its own times', () => {

	const landing = CAMERA.shakes.landing;
	close( envelope( 0.05, landing ), 0.5 );
	close( envelope( 0.12, landing ), 1 );
	close( envelope( landing.duration - 0.1, landing ), 0.5 );
	close( envelope( landing.duration, landing ), 0 );

} );

test( 'a bump rises smoothly to its height at its peak and settles by the end; a held one stays up until the fade', () => {

	close( bump( 0, 0.5, 2 ), 0 );
	close( bump( 0.25, 0.5, 2 ), 0.5 );
	close( bump( 0.5, 0.5, 2 ), 1 );
	close( bump( 1.25, 0.5, 2 ), 0.5 );
	close( bump( 2, 0.5, 2 ), 0 );

	// The jump dips the view by a third of a second and holds it down through the flight, until the fade takes it
	// away; its nod up is at its height at one second, as it fades over the last 0.4 s of its 4/3.
	const at = ( time ) => {

		const camera = new PerspectiveCamera();
		const shakes = new Shake( () => 0 );
		shakes.start( 'jump' );
		shakes.update( time, camera );
		return { y: camera.position.y, pitch: - pitchDown( camera ) };

	};
	close( at( 1 / 3 ).y, - 0.15 );
	close( at( 0.9 ).y, - 0.15 );
	const nod = at( 1 );
	const fade = ( 4 / 3 - 1 ) / 0.4;
	close( nod.y, - 0.15 * fade );
	close( nod.pitch, 1.5 * DEG * fade, 1e-9 );

} );

test( 'a sway starts each axis at a random point of its swing, except the axes pinned to start from the middle', () => {

	const draws = [];
	const shakes = new Shake( () => {

		draws.push( 0.25 );
		return 0.25;

	} );
	const camera = new PerspectiveCamera();
	const landing = shakes.start( 'landing' );
	assert.deepEqual( landing.movePhases, [ Math.PI / 2, Math.PI / 2, 0 ] );
	assert.equal( draws.length, 2 );

	// Bumps draw nothing from the stream.
	shakes.start( 'roll' );
	assert.equal( draws.length, 2 );

	// The camera looks down its −z: forward is −z, right +x, up +y.
	shakes.active.length = 0;
	shakes.active.push( landing );
	shakes.update( 0.15, camera );
	const sway = ( phase ) => 0.035 * Math.sin( 2 * Math.PI * 4.06 * 0.15 + phase );
	close( camera.position.x, sway( Math.PI / 2 ) );
	close( camera.position.y, sway( Math.PI / 2 ) );
	close( camera.position.z, - sway( 0 ) );

} );

test( 'a shake from a point in the world weakens with the camera\'s distance from it, and is gone beyond its reach', () => {

	const shakes = new Shake( () => 0 );
	const camera = new PerspectiveCamera();
	const near = shakes.start( 'trick', { epicenter: new Vector3() } );
	const far = shakes.start( 'trick', { epicenter: new Vector3( 0, 0, EPICENTER_REACH / 2 ) } );
	const gone = shakes.start( 'trick', { epicenter: new Vector3( 0, 0, EPICENTER_REACH + 1 ) } );
	const half = shakes.start( 'trick', { scale: 0.5 } );

	for ( const shake of [ near, far, gone, half ] ) shake.time = 0.5;
	close( shakes.weight( near, camera ), 1 );
	close( shakes.weight( far, camera ), 0.5 );
	close( shakes.weight( gone, camera ), 0 );
	close( shakes.weight( half, camera ), 0.5 );

} );

test( 'the bar swing moves the camera along the swing\'s facing, not the view\'s; a shake goes once it has run its course', () => {

	const shakes = new Shake( () => 0 );
	const camera = new PerspectiveCamera();
	camera.quaternion.setFromAxisAngle( UP, Math.PI / 2 );
	shakes.start( 'barSwing', { orientation: new Quaternion() } );
	shakes.update( 2 / 3, camera );
	close( camera.position.z, - 0.85 * ( 1 / 3 ) / 0.4 );
	close( camera.position.x, 0 );

	shakes.update( 1 / 3, camera );
	assert.equal( shakes.active.length, 0 );

} );

test( 'every shake preset is a sway or a bump within its own time, of a camera-sized move and turn', () => {

	for ( const [ name, preset ] of Object.entries( CAMERA.shakes ) ) {

		assert.ok( preset.fadeIn > 0 && preset.fadeOut > 0 && Math.max( preset.fadeIn, preset.fadeOut ) <= preset.duration, name );

		for ( const [ part, axes, limit ] of [ [ preset.move, [ 'right', 'up', 'forward' ], 1 ], [ preset.turn, [ 'pitch', 'yaw', 'roll' ], 20 * DEG ] ] ) {

			if ( ! part ) continue;
			assert.ok( part.frequency > 0 || ( part.peak > 0 && part.peak < preset.duration ), name );
			assert.ok( axes.some( ( axis ) => part[ axis ] ), name );
			for ( const axis of axes ) assert.ok( Math.abs( part[ axis ] ?? 0 ) < limit, name + ' ' + axis );

		}

	}

} );
