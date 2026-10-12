// The QA recorder: puts the live game's raw input on a tape, frame by frame, so the last seconds can be captured and
// replayed exactly.
//
// A tape starts at a respawn (the only way a run starts again) with the settings it is played with. Each frame adds
// the raw device state the simulation sampled and a trace row (the frame's hash, for checking a replay, and readings
// for the timeline). Whatever changes the run between frames goes on the tape as an event at the next frame: a
// respawn, the input cleared (the window lost focus), a setting changed (tuning, preferences, the window's shape).
// The tape keeps a little more than the seconds a capture takes, cut at a respawn so it always starts from one.

import { unpackPad } from '@trizendigital/parkour/input/deviceState.js';
import { FrameTrace, JointMeter } from '@trizendigital/parkour/replay/trace.js';
import { Tape, readSettings, settingsDiff } from '@trizendigital/parkour/replay/tape.js';

// How often (frames) the tape drops what is older than a capture needs.
const PRUNE_EVERY = 120;

class Recorder {

	/**
	 * @param {object} [options]
	 * @param {number} [options.keep] the seconds a capture takes
	 */
	constructor( { keep = 20 } = {} ) {

		this.keep = keep;
		this.recording = true;
		this.sim = null;
		this.raw = null;
		this.tape = null;
		// Events between frames, put on the tape when the next frame begins.
		this.pending = [];
		this.captured = false;
		this.inFrame = false;
		/** Whether Easy mode drives this frame (the timeline shows it). */
		this.easy = false;
		/** Called with the frame's number and row after each recorded frame. */
		this.onFrame = null;

	}

	/**
	 * Records a simulation from its next respawn.
	 * @param {Simulation} sim
	 * @param {DeviceState} raw the simulation's raw device state
	 */
	attach( sim, raw ) {

		this.sim = sim;
		this.raw = raw;
		this.tape = null;
		this.pending.length = 0;
		this.trace = new FrameTrace( sim );
		this.meter = new JointMeter( sim.figure );
		this.listen();

		// The input cleared between frames (focus lost, the pointer released) changes the run: it goes on the tape.
		const input = sim.input, clear = input.clear;
		input.clear = () => {

			if ( ! this.inFrame ) this.between( { clear: true } );
			clear.call( input );

		};

	}

	listen() {

		this.raw.record();
		this.sim.onStep = () => this.trace.step();

	}

	/**
	 * Goes on recording on a tape made elsewhere (a replay played up to a frame, to play on from there).
	 * @param {Tape} tape
	 */
	adopt( tape ) {

		this.listen();
		this.tape = tape;
		this.settings = tape.stateAt( tape.n ).settings;
		this.pending.length = 0;
		this.meter.reset();

	}

	/** How many seconds a capture now would hold. */
	get length() {

		return this.tape ? Math.min( this.keep, this.tape.duration ) : 0;

	}

	/**
	 * Starts the run again, between frames, and notes it on the tape (or starts a tape).
	 * @param {number|{position: number[]|Vector3, yaw: number}} [start] a spawn's index, or a place and heading
	 * @returns {{position: number[], yaw: number}} where it started
	 */
	respawn( start = 0 ) {

		const sim = this.sim, spawn = this.spawnOf( start );
		if ( this.inFrame ) throw new Error( 'a respawn is made between frames' );
		if ( this.recording && this.tape ) {

			this.between( { respawn: spawn } );
			sim.respawn( spawn );

		} else {

			// Presses made before the tape begins belong to no frame of it.
			this.raw.queued.length = 0;
			sim.respawn( spawn );
			if ( this.recording ) this.begin( spawn );

		}

		this.meter.reset();
		return spawn;

	}

	// A start as a tape writes it: a place and a heading.
	spawnOf( start ) {

		const spawn = typeof start === 'number' ? this.sim.world.spawn( start ) : start;
		const position = spawn.position;
		return { position: position.isVector3 ? position.toArray() : [ ...position ], yaw: spawn.yaw };

	}

	begin( spawn ) {

		this.settings = readSettings( this.sim );
		this.tape = new Tape( spawn, structuredClone( this.settings ) );
		this.pending.length = 0;

	}

	/** @param {boolean} on */
	setRecording( on ) {

		this.recording = on;
		if ( ! on ) this.tape = null;

	}

	// An event between frames, with the presses queued before it (they belong to the frame after it).
	between( event ) {

		if ( ! this.tape ) return;
		this.checkSettings();
		this.pending.push( { ...event, edges: this.raw.queued.splice( 0 ) } );

	}

	checkSettings() {

		const now = readSettings( this.sim ), diff = settingsDiff( this.settings, now );
		this.settings = now;
		if ( diff ) this.pending.push( { settings: diff, edges: this.raw.queued.splice( 0 ) } );

	}

	/** Before the simulation's frame: what happened since the last one goes on the tape. */
	beginFrame() {

		this.inFrame = true;
		this.captured = false;
		this.trace.reset();
		if ( ! this.tape ) return;
		this.checkSettings();
		for ( const event of this.pending.splice( 0 ) ) {

			if ( ! event.edges.length ) delete event.edges;
			this.tape.event( this.tape.n, event );

		}

	}

	/**
	 * Inside the frame, once the raw device state is set: records it.
	 * @param {number} dt
	 */
	capture( dt ) {

		const frame = this.raw.capture( dt );
		if ( frame.pad ) {

			// The pad as the tape holds it (this frame's values, copied), so the live run reads exactly what a replay
			// will.
			const input = this.sim.input, navigator = input.navigator, pad = unpackPad( frame.pad );
			input.navigator = { getGamepads: () => [ pad ] };
			this.navigator = navigator;

		}

		if ( ! this.tape ) return;
		this.tape.push( frame );
		this.captured = true;

	}

	/** After the simulation's frame: the frame's trace row. */
	endFrame() {

		this.inFrame = false;
		if ( this.navigator !== undefined ) {

			this.sim.input.navigator = this.navigator;
			this.navigator = undefined;

		}

		const tape = this.tape, sim = this.sim;
		if ( ! tape || ! this.captured ) return;
		sim.figure.root.updateMatrixWorld( true );
		sim.camera.updateMatrixWorld();
		const row = this.trace.frame();
		row.acc = this.meter.measure( sim.simDt );
		row.easy = this.easy;
		tape.rows.push( row );
		this.onFrame?.( tape.n - 1, row );
		if ( tape.n % PRUNE_EVERY === 0 ) tape.prune( this.keep + 1 );

	}

	/**
	 * The last seconds of the tape, from the respawn before them.
	 * @param {number} [seconds]
	 * @returns {object|null} a replay's body (start, settings, events, frames, duration, input, trace), its `range` (the
	 *   seconds asked for, as frames), `window` (the same, with times) and `base` (its first frame's number on the
	 *   live tape); null if the tape is too short
	 */
	take( seconds = this.keep ) {

		const tape = this.tape;
		if ( ! tape || tape.n < 2 ) return null;
		const end = tape.n - 1, first = Math.min( tape.frameAt( tape.duration - seconds ), end ), start = tape.startBefore( first );
		const body = tape.record( start, end );
		const t = tape.t, from = first - start, to = end - start;
		body.range = { from, to };
		body.window = { from, to, t0: + ( t[ first ] - t[ start ] ).toFixed( 4 ), t1: + ( t[ end + 1 ] - t[ start ] ).toFixed( 4 ) };
		body.base = tape.base + start;
		return body;

	}

}

export { Recorder };
