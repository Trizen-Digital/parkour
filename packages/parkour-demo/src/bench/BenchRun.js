// One benchmark run: the autopilot playing every station on one simulation (one physics engine, one view), recorded
// frame by frame so any moment of it can be shown again exactly.
//
// The run is worked out ahead of what is shown (`extend`): the autopilot decides each frame's devices, the simulation
// runs it, and the run keeps the frame's raw input, the respawns between frames, a hash of the frame (the QA traces'
// FrameTrace) and which station it was in. Every so often, and as each station starts, it keeps a keyframe: a snapshot
// of the simulation and a copy of the autopilot's state. Showing a moment (`seek`) puts back the keyframe before it and
// plays the recorded frames up to it, so a seek lands on exactly the state the run had there, wherever it came from.
// The same run is worked out the same way in node (tools/bench/run.mjs) and in the page (Bench.js).
//
// A keyframe can't be taken while the ragdoll has the body (its bodies live in the physics engine), so one falls due
// then is taken as soon as the runner is back on its feet.

import { DeviceState } from '@trizen/parkour/input/deviceState.js';
import { takeSnapshot, restoreSnapshot } from '@trizen/parkour/sim/snapshot.js';
import { FrameTrace } from '@trizen/parkour/replay/trace.js';
import { Autopilot, DT } from './Autopilot.js';
import { STANDING_HEIGHT } from './course.js';

// A keyframe at least this often (frames: 5 s), besides one as each station starts.
const KEY_EVERY = 600;

// Working out a ragdoll's frames may run past the time asked for, until the run can be kept again, up to this many
// frames.
const RAGDOLL_OVERRUN = 2400;

// The fingerprint samples the runner this often (frames: once a second).
const SAMPLE_EVERY = 120;

class BenchRun {

	/**
	 * @param {Simulation} sim loaded on the benchmark course (course.js), with no page devices
	 * @param {object[]} placed the stations as the course placed them
	 * @param {object} [options]
	 * @param {string} [options.view] 'third' or 'first'
	 */
	constructor( sim, placed, { view = 'third' } = {} ) {

		this.sim = sim;
		this.placed = placed;
		this.view = view;
		this.pilot = new Autopilot( sim, placed, { view } );
		// One raw device state per simulation, shared by the runs on it: each wraps the input's key queue as it is made.
		this.raw = sim.benchInput ??= new DeviceState( sim.input );
		this.trace = new FrameTrace( sim );

		// The recorded run, a column per field: the input (held keys as a mask over `keyNames`, mouse buttons as a
		// mask, the mouse's counts in hundredths), the edges and respawns by frame, and each frame's hash, station and
		// state (an index into `stateNames`).
		this.keyNames = [];
		this.keyMask = [];
		this.buttonMask = [];
		this.mouseX = [];
		this.mouseY = [];
		this.edges = new Map();
		this.respawns = new Map();
		this.hashes = [];
		this.stationOf = [];
		// Once a second, where the runner is (mm) and its state: what the fingerprint compares.
		this.samples = [];
		this.stateNames = [];
		this.stateOf = [];
		/** What each station did: `{ index, id, start, end, result, reason, seen }`, in order. */
		this.log = [];

		/** Frames worked out so far. */
		this.frames = 0;
		/** Frames the simulation has run: what is shown is the state after frame f − 1. */
		this.f = 0;
		/** Keyframes by frame, in order: `{ f, snapshot, pilot }`. */
		this.keyframes = [];
		// The latest state at the frontier to work on from (not kept as a keyframe), and whether a station started.
		this.head = null;
		this.stationStarted = true;
		/** Whether every station has been worked out. */
		this.complete = false;
		/** Set when the simulation ran a frame differently from how it was recorded (it should never be). */
		this.mismatch = null;

	}

	/** Starts the run at the first station: frame 0. */
	start() {

		this.attach();
		this.sim.respawn( this.placed[ 0 ].entry );
		this.pilot.reset();
		this.f = 0;
		return this;

	}

	/**
	 * Takes the simulation (another run on it had it): its input and traces are this run's again. What the simulation
	 * shows is the other run's until the next seek, which puts back a keyframe of this one.
	 */
	attach() {

		this.raw.play();
		this.sim.onStep = () => this.trace.step();
		this.f = - 1;
		return this;

	}

	/** The run's length so far (s). */
	get duration() {

		return this.frames * DT;

	}

	// ---- Working the run out

	/**
	 * Works out more of the run, then puts back what was shown. It stops after `ms` milliseconds (on a frame where the
	 * run can be kept), or once the run is complete.
	 * @param {number} ms
	 * @returns {number} the frames worked out
	 */
	extend( ms ) {

		if ( this.complete ) return 0;
		const shown = this.f;
		let back = null;
		if ( shown !== this.frames ) {

			// What is shown must come back afterwards: not while the ragdoll has the body.
			if ( this.sim.ragdoll.active ) return 0;
			back = takeSnapshot( this.sim );
			this.resume();

		}

		const before = this.frames, started = now();
		let overrun = 0;
		while ( ! this.complete ) {

			this.compute();
			const late = now() - started >= ms;
			if ( late && ! this.sim.ragdoll.active ) break;
			if ( late && ++ overrun > RAGDOLL_OVERRUN ) break;

		}

		if ( ! this.sim.ragdoll.active ) this.head = { f: this.f, snapshot: takeSnapshot( this.sim ), pilot: structuredClone( this.pilot.state ) };
		if ( back ) {

			restoreSnapshot( this.sim, back );
			this.f = shown;

		}

		return this.frames - before;

	}

	/** Works out the whole run (headless). */
	runToEnd( onStation = null ) {

		let logged = 0;
		while ( ! this.complete ) {

			this.compute();
			while ( onStation && logged < this.log.length ) onStation( this.log[ logged ++ ] );

		}

		return this.log;

	}

	// Puts the simulation and the autopilot at the frontier, to work on from there: the head kept by the last extend,
	// else the last keyframe and the frames from it worked out again (they must come out as recorded).
	resume() {

		const head = this.head?.f === this.frames ? this.head : this.keyframes.findLast( ( key ) => key.f <= this.frames );
		restoreSnapshot( this.sim, head.snapshot );
		this.pilot.state = structuredClone( head.pilot );
		this.f = head.f;
		while ( this.f < this.frames ) this.compute();

	}

	/** Works out one frame at the frontier (or again, behind it, checking it comes out the same). */
	compute() {

		const sim = this.sim, pilot = this.pilot, f = this.f, again = f < this.frames;
		if ( ! again && ! sim.ragdoll.active && ( this.stationStarted || f - ( this.keyframes.at( - 1 )?.f ?? - Infinity ) >= KEY_EVERY ) ) {

			this.keyframes.push( { f, snapshot: takeSnapshot( sim ), pilot: structuredClone( pilot.state ) } );
			this.stationStarted = false;

		}

		const { respawn, ended } = pilot.decide();
		if ( ended && ! again ) {

			this.log.push( ended );
			this.stationStarted = true;

		}

		const frame = pilot.press( respawn );
		if ( pilot.finished && ! again ) {

			// The last station has ended: the run is complete, and this frame is not part of it.
			this.complete = true;
			return;

		}

		if ( respawn ) sim.respawn( respawn );
		this.run( frame );

		if ( again ) {

			if ( this.hashes[ f ] !== this.lastHash && ! this.mismatch ) this.mismatch = { f, at: 'worked out again' };
			return;

		}

		this.record( f, frame, respawn );
		this.frames ++;

	}

	// Runs one frame of raw input on the simulation.
	run( frame ) {

		const sim = this.sim;
		this.trace.reset();
		sim.frame( frame.dt, () => this.raw.apply( frame ) );
		this.lastHash = this.trace.frame().hash;
		this.f ++;

	}

	record( f, frame, respawn ) {

		this.keyMask[ f ] = mask( frame.keys, this.keyNames );
		this.buttonMask[ f ] = frame.buttons.reduce( ( m, b ) => m | ( 1 << b ), 0 );
		this.mouseX[ f ] = Math.round( frame.mouse[ 0 ] * 100 );
		this.mouseY[ f ] = Math.round( frame.mouse[ 1 ] * 100 );
		if ( frame.edges.length ) this.edges.set( f, frame.edges );
		if ( respawn ) this.respawns.set( f, respawn );
		this.hashes[ f ] = this.lastHash;
		this.stationOf[ f ] = this.pilot.state.station;
		const state = this.sim.ragdoll.active ? 'limp' : this.sim.runner.state;
		let id = this.stateNames.indexOf( state );
		if ( id < 0 ) id = this.stateNames.push( state ) - 1;
		this.stateOf[ f ] = id;
		if ( f % SAMPLE_EVERY === 0 ) {

			const p = this.sim.runner.position;
			this.samples.push( Math.round( p.x * 1000 ), Math.round( p.y * 1000 ), Math.round( p.z * 1000 ), id );

		}

	}

	// ---- Showing it

	/**
	 * The recorded frame f's raw input.
	 * @param {number} f
	 * @returns {object} a raw frame (deviceState.js)
	 */
	frameAt( f ) {

		const keys = [], m = this.keyMask[ f ];
		for ( let i = 0; i < this.keyNames.length; i ++ ) if ( m & ( 1 << i ) ) keys.push( this.keyNames[ i ] );
		const buttons = [ 0, 1, 2 ].filter( ( b ) => this.buttonMask[ f ] & ( 1 << b ) );
		return { dt: DT, keys, buttons, mouse: [ this.mouseX[ f ] / 100, this.mouseY[ f ] / 100, 0 ], edges: this.edges.get( f ) ?? [], pad: null, enabled: true, editing: false };

	}

	/**
	 * Runs the next recorded frame (or works it out, at the frontier).
	 * @returns {boolean} false once the run is over
	 */
	step() {

		if ( this.f >= this.frames ) {

			if ( this.complete ) return false;
			this.compute();
			return true;

		}

		const f = this.f, respawn = this.respawns.get( f );
		if ( respawn ) this.sim.respawn( respawn );
		this.run( this.frameAt( f ) );
		if ( this.hashes[ f ] !== this.lastHash && ! this.mismatch ) this.mismatch = { f, at: 'played back' };
		return true;

	}

	/**
	 * Shows the state after frame f − 1 (f frames into the run), exactly: from the keyframe before it.
	 * @param {number} f
	 */
	seek( f ) {

		f = Math.max( 0, Math.min( f, this.frames ) );
		if ( f === this.f ) return;
		const key = this.keyframes.findLast( ( k ) => k.f <= f );
		// Going on from here is quicker than from the keyframe when the frame is a little ahead.
		if ( ! ( f > this.f && ( ! key || key.f <= this.f ) ) ) {

			restoreSnapshot( this.sim, key.snapshot );
			this.f = key.f;

		}

		while ( this.f < f ) this.step();

	}

	/**
	 * @param {number} f
	 * @returns {object|null} the station frame f is in, as placed, with its record once it has ended
	 */
	stationAt( f ) {

		const index = this.stationOf[ Math.min( f, this.frames - 1 ) ] ?? 0;
		return { place: this.placed[ index ], record: this.log[ index ] ?? null };

	}

	/** @returns {string} the runner's state at frame f */
	stateAt( f ) {

		return this.stateNames[ this.stateOf[ f ] ] ?? '';

	}

	/**
	 * Where a station started in this run, once the run has reached it.
	 * @param {number} index
	 * @returns {number|null} its first frame
	 */
	stationStart( index ) {

		if ( this.log[ index ] ) return this.log[ index ].start;
		return index === this.pilot.state.station && this.frames > 0 ? this.pilot.state.stationFrame : null;

	}

	/**
	 * What the run did frame by frame over a stretch, every `every` frames: the station, the runner's state and move,
	 * where it is in the station (m: y above its floor, z from its entry), its speeds, and the keys held. Shows each
	 * of those frames on the way, and goes back to what was shown.
	 * @param {number} f0
	 * @param {number} f1
	 * @param {number} [every]
	 * @returns {object[]}
	 */
	rows( f0, f1, every = 6 ) {

		const sim = this.sim, out = [], back = this.f;
		for ( let f = Math.max( 1, f0 ); f <= Math.min( f1, this.frames ); f += every ) {

			this.seek( f );
			const runner = sim.runner, place = this.placed[ this.stationOf[ f - 1 ] ], frame = this.frameAt( f - 1 );
			const moving = sim.motion.moves.instances.findLast( ( instance ) => ! instance.stopping );
			out.push( {
				f, t: + ( f * DT ).toFixed( 3 ), station: place.station.id,
				state: sim.ragdoll.active ? 'limp' : runner.state, move: moving ? `${moving.move.name}@${moving.time.toFixed( 2 )}` : '',
				x: + runner.position.x.toFixed( 3 ), y: + ( runner.position.y - STANDING_HEIGHT ).toFixed( 3 ), z: + ( runner.position.z - place.z0 ).toFixed( 3 ),
				v: + runner.speed.toFixed( 2 ), vy: + runner.velocity.y.toFixed( 2 ),
				keys: [ ...frame.keys, ...frame.buttons.map( ( b ) => `Mouse${b}` ) ].join( '+' ) + ( frame.mouse[ 0 ] || frame.mouse[ 1 ] ? ` mouse ${frame.mouse[ 0 ]},${frame.mouse[ 1 ]}` : '' ),
			} );

		}

		if ( back >= 0 ) this.seek( back );
		return out;

	}

	/**
	 * The run's fingerprint, to tell whether the page and node ran the same benchmark: each station's first and last
	 * frames and result, and once a second where the runner was (to the millimetre) and its state, folded into one
	 * (FNV-1a), as hex. The frames' own hashes can differ between the page and node in a last bit (Math.atan2 and
	 * Math.tan round differently in some versions of V8) where nothing the run does differs.
	 * @returns {string}
	 */
	fingerprint() {

		let h = 2166136261;
		const mix = ( x ) => h = Math.imul( h ^ x, 16777619 );
		for ( const record of this.log ) {

			mix( record.start );
			mix( record.end );
			mix( record.result === 'pass' ? 1 : record.result === 'missed' ? 2 : 3 );

		}

		for ( const x of this.samples ) mix( x );
		return ( h >>> 0 ).toString( 16 ).padStart( 8, '0' );

	}

	/** Lets go of the simulation's input. */
	end() {

		this.raw.stop();
		this.sim.onStep = null;

	}

}

// The keys as bits of a mask, each key's bit its place in `names` (added as it first appears).
function mask( keys, names ) {

	let m = 0;
	for ( const key of keys ) {

		let i = names.indexOf( key );
		if ( i < 0 ) i = names.push( key ) - 1;
		m |= 1 << i;

	}

	return m;

}

const now = () => globalThis.performance?.now() ?? Date.now();

export { BenchRun, KEY_EVERY };
