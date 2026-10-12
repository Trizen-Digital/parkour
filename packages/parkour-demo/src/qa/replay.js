// Replays: a QA recording run again on a simulation, frame by frame, from its raw input.
//
// A replay runs on a simulation built on the recording's physics engine. It applies the recorded settings, respawns
// where the recording starts, then gives the simulation each
// recorded frame's raw device state and, between frames, the recorded events (a respawn, the input cleared, a
// setting). Each frame's hash is compared with the recording's: the first that differs is where the run came out
// differently (the code or the course changed since, or something in the run is not deterministic).

import { Group, PerspectiveCamera } from 'three/webgpu';
import { Simulation } from '@trizendigital/parkour/sim/Simulation.js';
import { World } from '@trizendigital/parkour/world/World.js';
import { fromCourse } from '../world/fromCourse.js';
import { backendOf } from '../engines.js';
import { DeviceState } from '@trizendigital/parkour/input/deviceState.js';
import { Course } from '../course/Course.js';
import { metrics } from '../course/metrics.js';
import { Tape, applySettings, decodeInput } from '@trizendigital/parkour/replay/tape.js';
import { FrameTrace, JointMeter } from '@trizendigital/parkour/replay/trace.js';

/**
 * A simulation of its own for replays: no page devices (it is fed only recorded input), saving nothing.
 * @param {object} definition the course
 * @param {object} [options]
 * @param {Figure} [options.figure] the timing-only figure by default
 * @param {Camera} [options.camera]
 * @param {string} [options.engine] the physics engine (a recording's: `engineOf( rec.settings )`)
 * @param {(text: string) => void} [options.progress]
 * @returns {Promise<Simulation>} with `holder`, a group outside the scene that keeps its figure when not on show
 */
async function replaySim( definition, { figure, camera = new PerspectiveCamera( 62, 16 / 9, 0.05, 3000 ), engine, progress } = {} ) {

	const course = new Course( definition, { metrics } );
	const world = new World( fromCourse( course ) );
	course.dispose();
	// A recording made before engines were named was made on Rapier.
	const sim = new Simulation( { world, camera, figure, engine: backendOf( engine ?? 'rapier' ), page: { storage: null, eventWindow: null, eventDocument: null, navigator: null } } );
	sim.holder = new Group();
	sim.holder.add( sim.figure.root );
	await sim.load( progress );
	return sim;

}

class Replay {

	/**
	 * Starts a recording on a simulation (its settings, its start).
	 * @param {Simulation} sim built on the recording's physics engine
	 * @param {object} rec a QA recording
	 * @param {object} [options]
	 * @param {boolean} [options.meter] measure the joints (needs a figure with bones)
	 * @param {DeviceState} [options.raw] the simulation's raw device state, if it has one already (the live game's)
	 */
	constructor( sim, rec, { meter = true, raw = null } = {} ) {

		this.sim = sim;
		this.rec = rec;
		this.frames = decodeInput( rec.input );
		this.events = new Map();
		for ( const event of rec.events ?? [] ) ( this.events.get( event.f ) ?? this.events.set( event.f, [] ).get( event.f ) ).push( event );
		// One raw device state per simulation: it takes over the input's key queue when made.
		this.raw = raw ?? ( sim.replayInput ??= new DeviceState( sim.input ) );
		this.trace = new FrameTrace( sim );
		this.meter = meter ? new JointMeter( sim.figure ) : null;

		applySettings( sim, rec.settings );
		sim.respawn( rec.start );
		this.raw.play();
		sim.onStep = () => this.trace.step();
		this.meter?.reset();
		/** The next frame to run. */
		this.f = 0;
		/** The first frame whose hash differs from the recording's, or null. */
		this.divergedAt = null;

	}

	get done() {

		return this.f >= this.frames.length;

	}

	/**
	 * Runs the next frame.
	 * @returns {object} the frame's trace row, with `f`, `acc` and `ok` (whether it matches the recording; null where
	 *   the recording has no hash)
	 */
	step() {

		const sim = this.sim, f = this.f ++;
		for ( const event of this.events.get( f ) ?? [] ) this.apply( event );
		const frame = this.frames[ f ];
		this.trace.reset();
		sim.frame( frame.dt, () => this.raw.apply( frame ) );

		sim.figure.root.updateMatrixWorld( true );
		sim.camera.updateMatrixWorld();
		const row = this.trace.frame();
		row.f = f;
		row.acc = this.meter ? this.meter.measure( sim.simDt ) : 0;
		const recorded = this.rec.trace?.hash?.[ f ];
		row.ok = recorded === undefined ? null : recorded === row.hash;
		if ( row.ok === false && this.divergedAt === null ) this.divergedAt = f;
		return row;

	}

	// An event between frames, as it happened in the recording.
	apply( event ) {

		for ( const [ key, edge ] of event.edges ?? [] ) this.raw.queueKey( key, edge );
		if ( event.settings ) applySettings( this.sim, event.settings );
		if ( event.respawn ) this.sim.respawn( event.respawn );
		if ( event.clear ) this.sim.input.clear();

	}

	/**
	 * Runs frames up to a frame.
	 * @param {number} [to]
	 * @param {(row: object) => void} [onFrame]
	 * @returns {number|null} divergedAt
	 */
	run( to = this.frames.length - 1, onFrame = null ) {

		while ( this.f <= to && ! this.done ) onFrame?.( this.step() );
		return this.divergedAt;

	}

	/** Gives the simulation its own input back. */
	end() {

		this.raw.stop();
		this.sim.onStep = null;

	}

}

/**
 * Play from here: runs a recording on the live game's simulation up to a frame, then hands the run to the player,
 * the recorder going on from the recording's tape, so a capture made later replays from the recording's start.
 * @param {{sim: Simulation, raw: DeviceState, recorder: Recorder}} live
 * @param {object} rec
 * @param {number} to the last frame to replay
 * @param {object} [options]
 * @param {(row: object) => void} [options.onFrame]
 * @param {(f: number) => Promise} [options.pause] awaited every 40 ms of work, so the page stays responsive
 * @returns {Promise<object[]>} the replayed rows
 */
async function takeOver( { sim, raw, recorder }, rec, to, { onFrame = null, pause = null } = {} ) {

	const replay = new Replay( sim, rec, { raw } ), rows = [];
	let started = performance.now();
	while ( replay.f <= to && ! replay.done ) {

		const row = replay.step();
		rows.push( row );
		onFrame?.( row );
		if ( pause && performance.now() - started > 40 ) {

			await pause( row.f );
			started = performance.now();

		}

	}

	replay.end();

	// Nothing the recording held carries over: the player presses afresh, and clicks to capture the pointer again.
	const input = sim.input;
	input.keys = new Set();
	input.mouseButtons = new Set();
	input.mouse = { x: 0, y: 0, wheel: 0 };
	input.enabled = false;
	recorder.adopt( Tape.from( rec, to, rows ) );
	return rows;

}

export { Replay, replaySim, takeOver };
