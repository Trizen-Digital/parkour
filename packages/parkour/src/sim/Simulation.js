// The simulation: one run of the game, stepped at a fixed 120 Hz whatever the frame rate.
//
// It owns what a run is made of (the course's queries, the input, the runner, the motion, the figure, the view, the
// follow camera, the ragdoll and the random streams) and advances them in one fixed order, so the same raw input
// always makes the same run: the golden traces, the QA replays and the Easy pilot's look-ahead all rest on that.
// A frame samples the input once and turns the view, runs as many 1/120 s steps as its time covers (the runner on
// its feet, or the ragdoll), then draws the runner between its last two steps and moves the camera. Anything that
// changes a run comes in through raw device input, or between frames (a respawn, a setting). The physics engine is
// part of what a run is: the same input on another engine makes another run.

import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { Tuning } from './tuning.js';
import { random } from './random.js';
import { clamp } from '../math.js';
import { ease } from '../motion/easing.js';
import { markStatic, takeSnapshot, restoreSnapshot } from './snapshot.js';
import { ACTIONS } from '../data/actions.js';
import { Input } from '../input/Input.js';
import { Mover } from '../physics/Mover.js';
import { Ragdoll } from '../physics/Ragdoll.js';
import { Motion } from '../motion/Motion.js';
import { Figure } from '../figure/Figure.js';
import { Runner } from '../runner/Runner.js';
import { PoseInputs } from '../runner/PoseInputs.js';
import { ViewControl } from '../camera/ViewControl.js';
import { FollowCamera } from '../camera/FollowCamera.js';

/** The simulation step (s). */
const STEP = 1 / 120;

// A frame longer than this (s) counts as this long: after a stall (a tab in the background, a breakpoint) the run
// goes on from where it was instead of leaping ahead.
const LONGEST_FRAME = 0.05;

// At most this many steps in one frame (the longest frame needs 6). Should the run ever fall further behind, it drops
// the backlog rather than catching up in a burst.
const MOST_STEPS = 8;

// The input's fields that belong to the page, not to the run: the devices and their listeners, the pointer capture
// and the player's preferences. A respawn keeps them as they are.
const PAGE_FIELDS = new Set( [ 'canvas', 'eventDocument', 'navigator', 'listeners', 'enabled', 'fallbackCapture', 'pointerInside', 'onCaptureChange', 'preferences' ] );

class Simulation {

	// The backend the run's engine is loaded from: a private field, so a snapshot never walks it.
	#backend;

	/**
	 * @param {object} options
	 * @param {World} options.world the course to run on
	 * @param {PerspectiveCamera} [options.camera] the camera the follow camera moves (the page's, or one of its own)
	 * @param {HTMLCanvasElement} [options.canvas] where the pointer is captured
	 * @param {object} [options.page] where the input listens and the settings are saved (`storage`, `eventWindow`,
	 *   `eventDocument`, `navigator`; each null for a simulation fed only raw device state, as a replay is); the page's
	 *   globals by default
	 * @param {Figure} [options.figure] the body drawn and posed (a RiggedFigure, as the demo's Y Bot); a timing-only
	 *   stand-in by default
	 * @param {Motion} [options.motion] the motion, made with where its move table is (`new Motion( { moves } )`);
	 *   `./data/moves.json` by default
	 * @param {import( '../physics/engine.js' ).Backend} options.engine the physics engine the run is built on: a backend
	 *   package's (@trizendigital/parkour-box3d, @trizendigital/parkour-rapier)
	 */
	constructor( { world, camera = new PerspectiveCamera( 75, 1, 0.025, 450 ), canvas = null, page = {}, figure = new Figure(), motion = new Motion(), engine } ) {

		if ( typeof engine?.load !== 'function' || typeof engine.name !== 'string' ) throw new Error( 'Simulation: options.engine must be a physics engine backend, e.g. the default export of @trizendigital/parkour-box3d' );

		this.world = world;
		/** The physics engine's name ('box3d', 'rapier'): replays record it and run again on it. */
		this.engine = engine.name;
		this.#backend = engine;
		this.camera = camera;
		this.tuning = new Tuning( page.storage );
		this.input = new Input( canvas, this.tuning, page );
		this.motion = motion;
		this.figure = figure;
		this.view = new ViewControl( this.tuning );
		this.random = random;

		// Made by load(): they need the course's solids in a physics engine and the motion's tables.
		this.queries = null;
		this.mover = null;
		this.followCamera = null;
		this.ragdoll = null;
		this.runner = null;
		this.poseInputs = null;

		/** Paused: frames still sample the input and move the camera, but no step runs. */
		this.paused = false;
		/** Simulated time not yet stepped (s), less than a step. */
		this.accumulator = 0;
		/** Where the runner is drawn: between its last two steps, by the time left in the accumulator. */
		this.position = new Vector3();
		/** Steps run in the last frame. */
		this.steps = 0;
		/** The time the run advanced in the last frame (s): slow motion scales it; 0 while paused. */
		this.simDt = 0;
		/** How far slow motion has eased in (s of frame time, up to the tuning's slowMotionEase), and that as a share
		 * along a smoothstep: 0 at full speed, 1 at the tuning's slow-motion scale. */
		this.slowMotionTime = 0;
		this.slowMotion = 0;
		/** The runner's events in the last frame (state changes, camera events). */
		this.frameEvents = [];
		/** The sound cues the motion fired in the last frame's steps, in order (`{ type: 'sound', name, weight }`). */
		this.frameSounds = [];
		/** A place to come back to (setMark / backToMark). */
		this.mark = null;
		// The run as load() left it: a respawn starts again from here.
		this.asLoaded = null;

		/** Called with the input each frame, after the simulation's own keys: the page's keys (HUD, Easy, QA). */
		this.onKeys = null;
		/** Called after every step (the traces). */
		this.onStep = null;

	}

	/**
	 * Builds the course's solids in a physics engine, loads the motion tables and the figure, and makes the runner, the
	 * follow camera and the ragdoll.
	 * @param {(text: string) => void} [progress] told what is loading
	 * @returns {Promise<Simulation>}
	 */
	async load( progress = () => {} ) {

		progress( `Building ${this.world.name}'s solids…` );
		const engine = await this.#backend.load();
		this.world.build( engine );
		this.queries = this.world.queries;
		this.mover = new Mover( this.queries );
		this.followCamera = new FollowCamera( this.camera, this.tuning, this.queries, this.input );
		await this.motion.load( progress );
		await this.figure.load( this.motion.takes, progress );

		progress( 'Building the ragdoll…' );
		this.ragdoll = new Ragdoll( { engine, solids: this.world.solids, tuning: this.tuning, motion: this.motion, figure: this.figure } );
		this.runner = new Runner( this.tuning, this.queries, this.mover, this.motion, this.world );
		this.poseInputs = new PoseInputs( this.runner, this.motion );
		this.figure.setQueries( this.queries );

		// The graph starts from the runner as it stands before its first step.
		this.poseInputs.update( STEP, this.input );
		this.view.reset( this.runner.yaw );
		this.followCamera.reset( this.runner.position, this.runner.yaw );
		this.position.copy( this.runner.position );

		// What no run changes: the course with its engine, the settings, the data tables, the figure's clips, ragdoll
		// description and foot, grip and clearance settings, and the page.
		const motion = this.motion, figure = this.figure, input = this.input;
		for ( const part of [
			this.world, this.tuning, ACTIONS,
			motion.takes,
			figure.clips, figure.ragdoll, figure.feet?.settings, figure.grips?.settings, figure.clearance?.settings,
			input.canvas, input.eventDocument, input.navigator,
		] ) markStatic( part );

		// The pose sampler holds only caches, but it points at the foot placement, whose easing is the run's.
		markStatic( figure.sampler, { deep: false } );
		this.asLoaded = takeSnapshot( this );
		return this;

	}

	/**
	 * Frees what the run holds in the physics engine (the course's query worlds and the ragdoll's world) and the input's
	 * listeners; the simulation does not run again. box3d keeps only so many worlds alive at once, so whatever replaces
	 * a simulation disposes of the one it replaces.
	 */
	dispose() {

		this.ragdoll?.dispose();
		this.world.dispose();
		this.input.dispose();

	}

	/**
	 * Starts the run again: everything as the simulation loaded (the page's devices, the player's preferences and the
	 * camera's aspect stay as they are), the runner at a start. A respawn is the only way a run starts again: QA tapes
	 * record it between frames.
	 * @param {number|{position: number[], yaw: number}} [start] a spawn's index in the world, or a place and heading
	 */
	respawn( start = 0 ) {

		const spawn = typeof start === 'number' ? this.world.spawn( start ) : { position: new Vector3().fromArray( start.position ), yaw: start.yaw };
		this.ragdoll.stop();
		this.restoreAsLoaded();
		this.input.setMode( 'play' );
		this.runner.teleport( spawn );
		this.view.reset( this.runner.yaw );
		this.followCamera.reset( this.runner.position, this.runner.yaw );
		this.motion.reset();
		this.figure.resetBody();
		this.accumulator = 0;
		this.random.reset();
		this.position.copy( this.runner.position );

	}

	// The snapshot taken at load put back, all but the page: what the devices hold now, the player's preferences and
	// the window's shape stay.
	restoreAsLoaded() {

		const input = this.input, camera = this.camera;
		const page = Object.fromEntries( Object.entries( input ).filter( ( [ key, value ] ) => PAGE_FIELDS.has( key ) || typeof value === 'function' ) );
		const held = { keys: [ ...input.keys ], buttons: [ ...input.mouseButtons ], mouse: { ...input.mouse }, preferences: { ...input.preferences.values } };
		const aspect = camera.aspect;

		restoreSnapshot( this, this.asLoaded );
		Object.assign( input, page );
		input.keys = new Set( held.keys );
		input.mouseButtons = new Set( held.buttons );
		input.mouse = held.mouse;
		input.preferences.values = held.preferences;
		camera.aspect = aspect;
		camera.updateProjectionMatrix();

	}

	/** Remembers where the runner stands and faces, to come back to. */
	setMark() {

		this.mark = { position: this.runner.position.clone(), yaw: this.runner.yaw };

	}

	/**
	 * Puts the runner back on the mark (on its feet, if the ragdoll had the body). Unlike a respawn, the run goes on.
	 * @returns {boolean} whether there was a mark
	 */
	backToMark() {

		if ( ! this.mark ) return false;
		this.ragdoll.stop();
		this.input.setMode( 'play' );
		this.runner.teleport( this.mark );
		this.view.reset( this.mark.yaw );
		this.followCamera.reset( this.mark.position, this.mark.yaw );
		return true;

	}

	/**
	 * Advances the run by one rendered frame.
	 * @param {number} dt the frame's time (s)
	 * @param {(input: Input) => void} [beforeSample] puts the frame's raw device state into the input before it is
	 *   sampled: a replay's frame, the Easy pilot's keys
	 */
	frame( dt, beforeSample = null ) {

		dt = Math.min( dt, LONGEST_FRAME );
		if ( dt <= 0 ) return;
		const input = this.input, runner = this.runner, tuning = this.tuning.values;

		// The body as the last step left it, not as the last frame drew it between steps: the steps and the ragdoll read
		// only a step's pose.
		this.figure.showStep();

		beforeSample?.( input );
		input.sample( dt );

		// The simulation's own keys act once a frame, before any step, and the runner never sees their edges.
		if ( input.pressed( 'pause' ) ) this.paused = ! this.paused;
		if ( input.pressed( 'setMark' ) ) this.setMark();
		if ( input.pressed( 'backToMark' ) ) this.backToMark();
		this.onKeys?.( input );
		input.consumeSystemEdges();

		// The aim turns once a frame, by the frame's look; every step of the frame steers by it.
		this.view.look( input, runner );

		// Slow motion eases in and out over the tuning's slowMotionEase, in the frame's own time, so the run slows and
		// speeds up along a smoothstep rather than at once.
		const easeTime = tuning.slowMotionEase;
		this.slowMotionTime = clamp( this.slowMotionTime + ( runner.slowMotion ? dt : - dt ), 0, easeTime );
		this.slowMotion = easeTime > 0 ? ease( this.slowMotionTime / easeTime, 'smoothstep' ) : runner.slowMotion ? 1 : 0;
		const simDt = dt * ( 1 + ( tuning.slowMotionScale - 1 ) * this.slowMotion );
		const running = ! this.paused;
		if ( running ) this.accumulator += simDt;
		this.frameSounds = [];

		let steps = 0;
		while ( this.accumulator >= STEP && steps < MOST_STEPS ) {

			if ( this.ragdoll.active ) this.stepRagdoll( input );
			else this.stepRunner( input );
			this.figure.keepStep();

			this.onStep?.( this );
			// A press counts in the first step of the frame only.
			input.consumeEdges();
			this.accumulator -= STEP;
			steps ++;

		}

		if ( steps === MOST_STEPS ) this.accumulator %= STEP;
		this.steps = steps;

		// Drawn between the last two steps, so motion is smooth at any frame rate; paused, at the last step.
		const alpha = running ? this.accumulator / STEP : 1;
		this.position.copy( runner.previousPosition ).lerp( runner.position, alpha );
		if ( ! this.ragdoll.active ) this.figure.root.position.copy( this.position );
		// The body drawn between its last two steps too (in slow motion a step lasts several frames), before the camera
		// places itself: in first person it rides the head as drawn.
		this.figure.drawBetween( alpha );
		this.view.update( simDt, runner );
		this.followCamera.update( simDt, this.view, runner, this.position, this.figure );
		this.frameEvents = runner.events.slice();
		this.simDt = running ? simDt : 0;
		runner.events.length = 0;

	}

	// The runner on its feet. Markers the motion fires in this step reach the runner at the start of the next, and the
	// runner's root motion for this step was taken from the move before the motion advanced it.
	stepRunner( input ) {

		const runner = this.runner, poseInputs = this.poseInputs;
		runner.step( STEP, input, this.view.yaw );
		poseInputs.update( STEP, input );
		const pose = { tilt: poseInputs.tilt, firstPerson: runner.firstPerson, sliding: runner.state === 'sliding', grip: poseInputs.grip, onGround: poseInputs.onGround, handsOnLedge: poseInputs.handsOnLedge };
		const recipe = this.motion.update( STEP, poseInputs );
		this.frameSounds.push( ...this.motion.sounds );
		this.figure.step( STEP, recipe, runner.position, runner.yaw, pose );

		// The bail hands the body to the ragdoll, thrown with the runner's velocity, and the limp controls take over.
		if ( runner.state === 'bailing' ) {

			runner.sprinting = false;
			this.ragdoll.start( runner.velocity );
			input.setMode( 'limp' );

		}

	}

	// The ragdoll has the body: the runner's clocks run on and it follows the body, so the camera, the traces and the
	// get-up all go from where the body lies.
	stepRagdoll( input ) {

		const runner = this.runner;
		runner.time += STEP;
		runner.stateTime += STEP;
		runner.previousPosition.copy( runner.position );
		const body = this.ragdoll.step( STEP, input, this.view.yaw );
		runner.position.copy( body.position );
		runner.velocity.copy( body.velocity );
		runner.yaw = body.yaw;

		if ( runner.bail.getUp( input ) ) {

			this.ragdoll.stop();
			input.setMode( 'play' );

		}

	}

}

export { Simulation, STEP };
