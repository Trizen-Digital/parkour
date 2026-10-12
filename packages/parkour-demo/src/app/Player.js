// The player: the playable run on the game's course. It makes a Simulation for each course (the Y Bot, the game's
// camera, the page's devices, the chosen physics engine), steps it every rendered frame, and writes the HUD
// (src/ui/Hud.svelte), the course's moving parts (doors, valves, buttons, ropes) and the sound (src/sound/) as the run
// has them. Easy mode
// (the pilot), the touch controls (src/touch/), the tutorial (src/tutorial/) and the QA recorder ride along: every
// frame's raw input passes through the recorder, so whatever just happened can be captured and replayed exactly. The
// run pausing itself (its pause key) or the pointer let go in play opens the pause menu (QA.openMenu), which holds the
// run. The touch controls are on while touch is the device in use (src/ui/nav.js), and play in Easy mode: while they
// are on, the pilot is.

import * as THREE from 'three/webgpu';
import { Simulation } from '@trizendigital/parkour/sim/Simulation.js';
import { CAPSULE } from '@trizendigital/parkour/sim/tuning.js';
import { World } from '@trizendigital/parkour/world/World.js';
import { fromCourse } from '../world/fromCourse.js';
import { ENGINES, backendOf } from '../engines.js';
import { DeviceState } from '@trizendigital/parkour/input/deviceState.js';
import { YBotFigure } from '../figure/YBotFigure.js';
import { Pilot } from '@trizendigital/parkour/pilot/Pilot.js';
import { QA } from '../qa/QA.js';
import { movementMode } from '@trizendigital/parkour/runner/states.js';
import { CourseParts } from './CourseParts.js';
import { Sound } from '../sound/Sound.js';
import { Tutorial } from '../tutorial/Tutorial.js';
import { TouchInput } from '../touch/TouchInput.js';
import { toast, ui } from '../ui/state.svelte.js';

// Falling this far (m) below the course's lowest point starts the run again.
const FALL_LIMIT = 20;

// The HUD's debug text refreshes this often (s); the jump meter every frame.
const HUD_INTERVAL = 0.1;

class Player {

	/**
	 * A player on the game's current course.
	 * @param {Game} game
	 * @returns {Promise<Player>}
	 */
	static async create( game ) {

		const player = new Player( game );
		await player.setCourse( game.course );
		return player;

	}

	constructor( game ) {

		this.game = game;
		this.camera = game.camera;
		this.canvas = game.stage.renderer.domElement;
		this.root = new THREE.Group();
		this.root.name = 'player';
		game.root.add( this.root );

		// The runner's capsule, to see what the simulation collides with; its nose shows the heading.
		this.capsule = new THREE.Mesh(
			new THREE.CapsuleGeometry( CAPSULE.radius, 2 * ( CAPSULE.halfHeight - CAPSULE.radius ), 6, 16 ),
			new THREE.MeshStandardNodeMaterial( { color: 0xd8dde3, roughness: 0.6 } ),
		);
		this.capsule.castShadow = true;
		const nose = new THREE.Mesh( new THREE.BoxGeometry( 0.08, 0.08, 0.2 ), new THREE.MeshStandardNodeMaterial( { color: 0x2b6cd8 } ) );
		nose.position.set( 0, 0.55, 0.17 );
		this.capsule.add( nose );
		this.root.add( this.capsule );

		// The simulation being loaded to take over (start), as a ticket only the latest start holds; null when none is.
		this.starting = null;

		const page = new URLSearchParams( location.search );
		this.settings = {
			capsule: false,
			easy: page.get( 'easy' ) === '1',
			// The physics engine runs are built on: `?engine=box3d`, or the settings' choice.
			engine: ENGINES.includes( page.get( 'engine' ) ) ? page.get( 'engine' ) : ENGINES[ 0 ],
		};
		/** The touch controls, which the simulations read their stick through: on while touch is the device in use. */
		this.touch = new TouchInput();
		this.touch.setOn( ui.device === 'touch' );
		this.qa = new QA( game, this );
		this.sound = new Sound( game.mixer );
		/** The spawn a restart and a fall go back to: the course's first, or the tutorial's flag. */
		this.checkpoint = 0;
		this.tutorial = new Tutorial( this );
		this.hudClock = 0;

		this.canvas.addEventListener( 'click', () => {

			if ( ! this.game.params.freeCamera && ! this.qa.open && ! this.sim?.input.enabled && ! this.touch.on ) this.sim?.input.capture();

		} );

	}

	/**
	 * Runs on a course: a new simulation on it, started at its first spawn. Held while QA shows a replay's course.
	 * @param {Course} course
	 */
	async setCourse( course ) {

		if ( ! course || this.course === course || this.qa.holdCourse ) return;
		await this.start( course );

	}

	/**
	 * Runs on a physics engine: a new simulation on the course if the run is on another (a run is made on one engine).
	 * While QA shows a replay's course, the next course the player takes is run on it.
	 * @param {string} name one of ENGINES
	 */
	async setEngine( name ) {

		this.settings.engine = name;
		if ( ! this.sim || this.sim.engine === name || this.qa.holdCourse ) return;
		await this.start( this.course );

	}

	// A new simulation on the course, on the engine set, started at its first spawn. It loads while the one it replaces
	// runs on (the page's frames step it until the swap, so it keeps its physics worlds until then); when two starts
	// overlap, the later one wins and the earlier one's simulation is let go of unused.
	async start( course ) {

		const ticket = this.starting = {};
		const sim = new Simulation( {
			world: new World( fromCourse( course ) ), camera: this.camera, canvas: this.canvas, figure: new YBotFigure(), engine: backendOf( this.settings.engine ),
			page: { navigator: this.touch.navigator },
		} );
		await sim.load( this.game.progress );

		if ( this.starting !== ticket ) {

			sim.dispose();
			dispose( sim.figure.root );
			return;

		}

		this.starting = null;

		// The simulation this one replaces lets go of its physics worlds and the page's devices.
		const previous = this.sim;
		if ( previous ) {

			previous.dispose();
			this.root.remove( previous.figure.root );
			dispose( previous.figure.root );

		}

		this.course = course;
		this.parts = new CourseParts( course );
		this.root.add( sim.figure.root );
		sim.onKeys = ( input ) => {

			if ( input.pressed( 'toggleUi' ) ) ui.hud.hidden = ! ui.hud.hidden;
			if ( input.pressed( 'easyMode' ) ) this.easyPressed = true;
			if ( input.pressed( 'restart' ) ) this.restartPressed = true;
			if ( input.pressed( 'captureReplay' ) ) this.qa.request( 'capture' );
			if ( input.pressed( 'replayLibrary' ) ) this.qa.request( 'library' );
			if ( input.pressed( 'benchmark' ) ) this.qa.request( 'bench' );

		};
		// Letting go of the pointer in play (Esc in pointer lock, another window) opens the menu.
		sim.input.onCaptureChange = ( on ) => {

			ui.hud.captured = on;
			if ( ! on ) this.qa.lostCapture();

		};
		ui.hud.captured = sim.input.enabled;
		this.sim = sim;
		this.raw = new DeviceState( sim.input );
		this.pilot = new Pilot( sim );
		this.pilot.toggle( this.easy );
		this.touch.attach( sim.input );
		this.qa.attach( sim, this.raw, course );
		this.tutorial.attach( course );
		this.respawn( this.checkpoint );

	}

	/** Whether Easy mode plays: the player's choice, or always with the touch controls. */
	get easy() {

		return this.settings.easy || this.touch.on;

	}

	/** The device in use as the HUD and a capture's setup name it: the touch controls while they are on. */
	get deviceName() {

		return this.touch.on ? 'TOUCH CONTROLS' : this.sim.input.deviceName;

	}

	/**
	 * Easy mode on or off, between frames (the tape sees it as a change of who presses the keys).
	 * @param {boolean} on
	 */
	setEasy( on ) {

		if ( ! on && this.touch.on ) return toast( 'Touch controls play in Easy mode' );
		this.settings.easy = on;
		this.pilot?.toggle( this.easy );

	}

	/**
	 * The touch controls on or off, between frames (touch became the device in use, or stopped being it). On, they hold
	 * the pointer as captured each frame; off, they let go of it, and the keys play on while a click captures the mouse.
	 * @param {boolean} on
	 */
	setTouch( on ) {

		if ( on === this.touch.on ) return;
		const easy = this.easy;
		this.touch.setOn( on );
		if ( this.easy !== easy ) this.pilot?.toggle( this.easy );
		if ( ! on && this.sim && document.pointerLockElement !== this.canvas ) ui.hud.captured = this.sim.input.enabled = false;

	}

	/** Takes the course on show as the one played, without a new simulation (QA put it back after a replay). */
	adoptCourse( course ) {

		this.course = course;
		this.parts = new CourseParts( course );
		this.tutorial.course = course;

	}

	/**
	 * Starts the run again (through the QA recorder, which notes it on the tape).
	 * @param {number|{position: number[], yaw: number}} [start]
	 */
	respawn( start = 0 ) {

		return this.qa.respawn( start );

	}

	/**
	 * Starts the course again from the checkpoint (its first spawn, or the tutorial's flag): the restart key, its prompt
	 * on the HUD, a fall off the course.
	 */
	restart() {

		this.tutorial.restarting();
		return this.respawn( this.checkpoint );

	}

	frame( dt ) {

		this.setTouch( ui.device === 'touch' );

		const sim = this.sim;
		if ( ! sim || this.qa.holds( dt ) ) {

			this.touch.hold();
			return this.sound.hold();

		}

		this.advance( dt );
		this.sound.frame( sim, dt );

		if ( this.easyPressed ) {

			this.easyPressed = false;
			this.setEasy( ! this.easy );

		}

		// The restart key respawns between frames, as the tape records a respawn.
		if ( this.restartPressed ) {

			this.restartPressed = false;
			this.restart();

		}

		// The tutorial reads the frame, and may send the runner back to its flag (between frames, as a respawn).
		this.tutorial.frame( dt );

		// The run paused itself (its pause key): the menu opens over it.
		if ( sim.paused ) this.qa.request( 'menu' );
		this.qa.afterFrame();
		this.drawCapsule();
		// Not while QA shows another course.
		if ( this.game.course === this.course ) this.parts.draw( sim );
		this.drawMeters();

		this.hudClock -= dt;
		if ( this.hudClock <= 0 ) {

			this.hudClock = HUD_INTERVAL;
			this.drawHud();

		}

	}

	/**
	 * One frame of the run, its raw input recorded.
	 * @param {number} dt
	 * @param {(input: Input) => void} [feed] raw device state a script sets for the frame (the QA console's lanes)
	 */
	advance( dt, feed = null ) {

		const sim = this.sim, qa = this.qa;
		this.pilot.think( dt );
		qa.beginFrame();
		sim.frame( dt, ( input ) => {

			feed?.( input );
			this.touch.apply( input, sim.runner, dt );
			this.pilot.apply( input );
			qa.captureInput( dt );

		} );
		qa.endFrame();

		if ( sim.runner.position.y < this.course.bounds.min.y - FALL_LIMIT ) this.restart();

	}

	drawCapsule() {

		const sim = this.sim, runner = sim.runner;
		this.capsule.visible = this.settings.capsule;
		this.capsule.position.copy( sim.position );
		this.capsule.rotation.set( 0, runner.yaw, 0 );
		this.capsule.scale.y = runner.capsule.halfHeight / CAPSULE.halfHeight;

	}

	drawMeters() {

		const sim = this.sim, runner = sim.runner, hud = ui.hud;
		const charging = sim.input.held( 'jump' ) && runner.grounded;
		hud.charge = charging ? runner.jumpCharge : 0;
		hud.full = charging && runner.jumpCharge >= 1;
		hud.easy = this.easy;
		hud.use = this.touch.on ? this.touch.useWord( sim ) : '';

	}

	drawHud() {

		if ( ! ui.options.debug ) return;
		const sim = this.sim, runner = sim.runner, moving = sim.motion.moves.instances.findLast( ( instance ) => ! instance.stopping );
		ui.hud.debug = [
			`state    ${sim.ragdoll.active ? 'limp' : runner.state}`,
			`speed    ${runner.speed.toFixed( 2 )} m/s   vy ${runner.velocity.y.toFixed( 2 )}`,
			`move     ${moving ? `${moving.move.name} ${moving.time.toFixed( 2 )}` : '-'}`,
			`mode     ${movementMode( runner )} · ${runner.pace}`,
			`easy     ${this.easy ? this.pilot.label || 'on' : 'off'}`,
			`input    ${this.deviceName}`,
			`physics  ${sim.engine}`,
			`replay   ${this.qa.status()}`,
		].join( '\n' );

	}

}

function dispose( root ) {

	root.traverse( ( node ) => {

		node.geometry?.dispose();
		for ( const material of [ node.material ].flat() ) material?.dispose();

	} );

}

export { Player };
