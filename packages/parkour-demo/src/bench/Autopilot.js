// The benchmark's autopilot: plays the stations one after another as a player would, through the raw device input
// only. Each frame it reads the run (where the runner is along the station, its state, whether it is on the ground,
// the view's heading), moves through the station's steps, and gives the frame's devices: the keys and mouse buttons
// held, their presses and releases, and the mouse's counts (turning the view to follow the station's line on foot, or
// a flick that points a trick in the air). It never touches the runner.
//
// It is deterministic: it reads only the run, and its own state is plain data (`state`), so the benchmark keeps a copy
// with every keyframe and the same run always gets the same presses. A station that goes wrong (an unplanned bail, a
// fall off the course, nothing done for too long) is written down as failed; after a moment to see it, the autopilot
// asks for a respawn at the next station's entry, which the run applies between frames like the QA recorder's
// respawns.

import { radians, wrapAngle } from '@trizendigital/parkour/math.js';
import { movementMode } from '@trizendigital/parkour/runner/states.js';
import { RUNS, ON_FOOT, VIEW } from './script.js';
import { STANDING_HEIGHT } from './course.js';

/** The benchmark's frame (s): one 120 Hz step a frame, a display at 120 Hz. */
const DT = 1 / 120;

// A key pressed for a tap stays down this long (s): one frame of a 60 Hz display.
const TAP = 1 / 60;

// The mouse counts of a trick flick, in the browser's sense (y down): over the 1.5-count gesture threshold and under
// the 25 of a wild swing.
const FLICKS = { up: [ 0, - 5 ], down: [ 0, 5 ], left: [ - 5, 0 ], right: [ 5, 0 ] };

// Turning the view to follow the line: the share of the heading's error turned each frame, at most the most a mouse
// turns it in a frame (150° a second before the look's gain of 2.5).
const STEER_SHARE = 0.25;
const LOOK_GAIN = 2.5;
const MOUSE_YAW_RATE = radians( 150 );
// The view aims at a point this far ahead along the line (m): the speed times STEER_AHEAD.time, within its bounds.
const STEER_AHEAD = { time: 0.6, min: 1.5, max: 4 };
// Mouse counts are kept to a hundredth.
const COUNTS = 100;

// A station is over when the runner is on its feet this close to its exit (m), or further on.
const EXIT_MARGIN = 2;
// A station fails when the runner falls this far below its floor (m), or has been at it this long (s).
const FALL_DEPTH = 2.5;
const STATION_LIMIT = 25;
// A step that lasts longer than this (s), or its own `limit`, fails the station.
const STEP_LIMIT = 8;
// After a failure the run goes on this long (s), to be seen, before the respawn at the next station.
const FAIL_PAUSE = 1.5;

class Autopilot {

	/**
	 * @param {Simulation} sim
	 * @param {object[]} placed the stations as the course placed them (course.js)
	 * @param {object} [options]
	 * @param {string} [options.view] 'third' or 'first': first person is pressed (C) at the start and after a respawn
	 */
	constructor( sim, placed, { view = 'third' } = {} ) {

		this.sim = sim;
		this.placed = placed;
		this.view = view;
		this.reset();

	}

	/** Back to the first station's start (the run respawns there). */
	reset() {

		this.state = {
			// The frame about to run, the station and the step in it, and the frames they started at.
			frame: 0, station: 0, step: 0, stationFrame: 0, stepFrame: 0,
			// The keys held in the last frame, and the presses still holding (key: last frame held).
			held: [], timed: {},
			// The station's record so far: the states and moves seen, and how it ended.
			seen: { states: [], moves: [] },
			// 'driving', 'failed' (waiting to respawn), or 'finished' (no stations left).
			phase: 'driving', failedAt: 0, reason: null,
			// First person is pressed once the runner stands after a start or a respawn.
			viewPressed: false,
		};
		this.startStep( this.placed[ 0 ]?.station.steps?.[ 0 ] );

	}

	get finished() {

		return this.state.phase === 'finished';

	}

	get current() {

		return this.placed[ this.state.station ] ?? null;

	}

	/**
	 * What the autopilot reads of the run: the runner in the station's coordinates, and the step's clock.
	 * @returns {object}
	 */
	read() {

		const sim = this.sim, runner = sim.runner, st = this.state, place = this.current;
		const moving = sim.motion.moves.instances.findLast( ( instance ) => ! instance.stopping );
		const mode = sim.ragdoll.active ? 'ragdoll' : movementMode( runner );
		return {
			x: runner.position.x,
			y: runner.position.y - STANDING_HEIGHT,
			z: runner.position.z - ( place?.z0 ?? 0 ),
			vy: runner.velocity.y,
			speed: runner.speed,
			state: runner.state,
			mode,
			grounded: runner.grounded,
			onFoot: ON_FOOT.has( runner.state ) && runner.grounded && ! sim.ragdoll.active,
			limp: sim.ragdoll.active,
			move: moving?.move?.name ?? null,
			stunt: runner.stunt?.name ?? null,
			viewYaw: sim.view.yaw,
			t: ( st.frame - st.stepFrame ) * DT,
			st: ( st.frame - st.stationFrame ) * DT,
			runner,
			sim,
		};

	}

	/**
	 * Judges what the last frame did, at the top of a frame: the station's steps move on, it ends, or it fails.
	 * @returns {{respawn: object|null, ended: object|null}} a respawn to make before the frame (the next station's
	 *   entry, after a failure), and the record of a station that has just ended
	 */
	decide() {

		const st = this.state;
		let ended = null, respawn = null;

		if ( st.phase === 'driving' ) {

			const s = this.read();
			this.notice( s );
			const verdict = this.judge( s );
			if ( verdict === 'done' ) ended = this.endStation( 'done' );
			else if ( verdict ) this.fail( verdict );
			else this.advanceSteps( s );

		}

		if ( st.phase === 'failed' && ( st.frame - st.failedAt ) * DT >= FAIL_PAUSE ) {

			ended = this.endStation( 'failed' );
			if ( st.phase === 'driving' ) {

				respawn = this.current.entry;
				st.viewPressed = false;

			}

		}

		return { respawn, ended };

	}

	/**
	 * The frame's devices, after decide().
	 * @param {object|null} respawn the respawn decide() asked for, made before this frame
	 * @returns {object} a raw frame (deviceState.js)
	 */
	press( respawn ) {

		const frame = this.devices( respawn );
		this.state.frame ++;
		return frame;

	}

	// The states and moves met on the way, for the station's expectations.
	notice( s ) {

		const seen = this.state.seen;
		const state = s.limp ? 'limp' : s.state;
		if ( ! seen.states.includes( state ) ) seen.states.push( state );
		for ( const name of [ s.move, s.stunt ] ) if ( name && ! seen.moves.includes( name ) ) seen.moves.push( name );

	}

	// 'done' when the station's end is reached; a reason when it has gone wrong; null while it goes on.
	judge( s ) {

		const station = this.current.station, st = this.state;
		const expectBail = ( typeof station.expect === 'function' ? station.expect( { view: this.view } ) : station.expect )?.bail === true;
		if ( s.limp && ! expectBail ) return 'bailed';
		if ( s.y < ( station.low ?? 0 ) - FALL_DEPTH ) return 'fell';
		if ( s.st > ( station.limit ?? STATION_LIMIT ) ) return 'stuck';
		const steps = station.steps ?? [];
		const step = steps[ st.step ];
		if ( step && s.t > ( step.limit ?? STEP_LIMIT ) ) return `stuck at step ${st.step + 1}${step.say ? ` (${step.say})` : ''}`;
		const lastStep = st.step >= steps.length;
		const done = station.done ? station.done( s ) : s.onFoot && s.z >= station.length - EXIT_MARGIN;
		return lastStep && done ? 'done' : null;

	}

	// Steps end when their condition holds; each lasts at least a frame, so its presses are made.
	advanceSteps( s ) {

		const st = this.state, steps = this.current.station.steps ?? [];
		while ( st.step < steps.length && st.frame > st.stepFrame ) {

			const step = steps[ st.step ];
			const until = step.until ?? ( step.for !== undefined ? ( q ) => q.t >= step.for - 1e-9 : () => true );
			if ( ! until( { ...s, t: ( st.frame - st.stepFrame ) * DT } ) ) break;
			st.step ++;
			st.stepFrame = st.frame;
			this.startStep( steps[ st.step ] );

		}

	}

	// A step's presses start with it.
	startStep( step ) {

		if ( ! step?.press ) return;
		for ( const [ key, seconds ] of Object.entries( step.press ) ) this.state.timed[ key ] = this.state.frame + Math.max( 1, Math.round( ( seconds ?? TAP ) / DT ) ) - 1;

	}

	fail( reason ) {

		const st = this.state;
		st.phase = 'failed';
		st.failedAt = st.frame;
		st.reason = reason;
		st.timed = {};

	}

	// Writes down how the station went and moves on to the next; a failure's next station starts with a respawn.
	endStation( how ) {

		const st = this.state, place = this.current, station = place.station;
		const record = {
			index: place.index, id: station.id,
			start: st.stationFrame, end: st.frame,
			result: how === 'done' ? this.expected( station, st.seen ) : 'fail',
			reason: how === 'done' ? this.missing( station, st.seen ) : st.reason,
			seen: { states: st.seen.states.slice(), moves: st.seen.moves.slice() },
		};

		st.station ++;
		st.step = 0;
		st.stationFrame = st.stepFrame = st.frame;
		st.seen = { states: [], moves: [] };
		st.reason = null;
		st.phase = st.station < this.placed.length ? 'driving' : 'finished';
		if ( st.phase === 'driving' ) this.startStep( this.current.station.steps?.[ 0 ] );
		return record;

	}

	// 'pass' when the station saw every state and move it expects, else 'missed'.
	expected( station, seen ) {

		return this.missing( station, seen ) ? 'missed' : 'pass';

	}

	missing( station, seen ) {

		const expect = ( typeof station.expect === 'function' ? station.expect( { view: this.view } ) : station.expect ) ?? {};
		const lacking = [
			...( expect.states ?? [] ).filter( ( name ) => ! seen.states.includes( name ) ),
			...( expect.moves ?? [] ).filter( ( move ) => ! seen.moves.some( ( name ) => typeof move === 'string' ? name === move : move.test( name ) ) ).map( String ),
		];
		if ( expect.bail && ! seen.states.includes( 'limp' ) ) lacking.push( 'limp' );
		return lacking.length ? `never ${lacking.join( ', ' )}` : null;

	}

	// The frame's devices: the keys the step holds and presses, the mouse steering or flicking.
	devices( respawn ) {

		const st = this.state, frame = st.frame;
		const step = st.phase === 'driving' ? this.current?.station.steps?.[ st.step ] ?? null : null;
		const keys = new Set();
		let mouse = [ 0, 0 ];

		if ( st.phase === 'driving' ) {

			const run = step ? step.run ?? 'sprint' : this.current.station.then ?? 'sprint';
			for ( const key of RUNS[ run ] ?? run ) keys.add( key );
			for ( const key of step?.hold ?? [] ) keys.add( key );
			for ( const [ key, until ] of Object.entries( st.timed ) ) {

				if ( frame <= until ) keys.add( key );
				else delete st.timed[ key ];

			}

			// First person is a press of the view key once the run has started (and again after a respawn).
			if ( this.view === 'first' && ! st.viewPressed && ! respawn ) {

				keys.add( VIEW );
				st.viewPressed = true;

			}

			if ( step?.flick && frame === st.stepFrame ) mouse = FLICKS[ step.flick ].slice();
			else mouse = [ this.steer( step ), 0 ];

		}

		// A respawn lets go of everything, as the page's devices are cleared.
		if ( respawn ) keys.clear();

		const held = [ ...keys ].sort();
		const before = new Set( st.held );
		const edges = [
			...st.held.filter( ( key ) => ! keys.has( key ) ).map( ( key ) => [ key, 'released' ] ),
			...held.filter( ( key ) => ! before.has( key ) ).map( ( key ) => [ key, 'pressed' ] ),
		];
		st.held = held;

		return {
			dt: DT,
			keys: held.filter( ( key ) => ! key.startsWith( 'Mouse' ) ),
			buttons: held.filter( ( key ) => key.startsWith( 'Mouse' ) ).map( ( key ) => Number( key.slice( 5 ) ) ),
			mouse: [ mouse[ 0 ], mouse[ 1 ], 0 ],
			edges,
			pad: null,
			enabled: true,
			editing: false,
		};

	}

	// Mouse counts turning the view toward the station's line ahead (or the step's heading), on foot only.
	steer( step ) {

		const sim = this.sim, runner = sim.runner;
		if ( step?.steer === false || sim.ragdoll.active || movementMode( runner ) !== 'ground' ) return 0;

		let yaw;
		if ( step?.face !== undefined ) {

			yaw = radians( step.face );

		} else {

			const place = this.current, z = runner.position.z - place.z0;
			const ahead = Math.min( STEER_AHEAD.max, Math.max( STEER_AHEAD.min, runner.speed * STEER_AHEAD.time ) );
			const line = step?.x ?? place.station.line ?? 0;
			const x = typeof line === 'function' ? line( z + ahead ) : line;
			yaw = Math.atan2( x - runner.position.x, ahead );

		}

		const sensitivity = sim.tuning.values.mouseSensitivity, perCount = radians( sensitivity ) * LOOK_GAIN;
		const most = MOUSE_YAW_RATE * DT * LOOK_GAIN;
		const turn = Math.max( - most, Math.min( most, wrapAngle( yaw - sim.view.yaw ) * STEER_SHARE ) );
		// The view turns against the mouse's x: a count to the right turns it toward -yaw.
		return Math.round( - turn / perCount * COUNTS ) / COUNTS;

	}

}

export { Autopilot, DT };
