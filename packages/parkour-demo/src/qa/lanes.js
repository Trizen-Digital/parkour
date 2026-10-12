// Lanes: a family course's test runs, driven as a player would.
//
// A family course (test_jumps, test_ledges, …) lays out lanes, each a run-up to one feature with what to press and
// how far before it (`press`, `at`). The LaneDriver holds W (and Shift for a full run), taps the lane's key once the
// feature is that close (or lets go of everything, for a stop), and judges the lane made when the runner catches on (a
// ledge, a bar, a wall run, …) or lands half a metre past the feature without a bail. The lanes tool runs every lane
// by hand and in Easy mode with it; the QA console and the tests drive single lanes.

import { radians } from '@trizendigital/parkour/math.js';

/** The states that mean the lane's move took. */
const SUCCESS_STATES = new Set( [ 'hanging', 'catchingLedge', 'climbingUp', 'onBar', 'onRope', 'onPole', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'wallRunning' ] );

// The keys a lane's press means.
const PRESS_KEYS = { up: 'Space', down: 'KeyX', interact: 'KeyE' };

// The capsule's centre stands this far above the floor, as at every spawn.
const STANDING_HEIGHT = 0.9215;

// Landed this far past the feature (m) counts as made.
const PAST = 0.5;

/**
 * Where a lane starts.
 * @param {object} lane a course's lane (`start` on the floor, `yaw` in degrees)
 * @returns {{position: number[], yaw: number}} for Simulation.respawn()
 */
function laneStart( lane ) {

	return { position: [ lane.start[ 0 ], lane.start[ 1 ] + STANDING_HEIGHT, lane.start[ 2 ] ], yaw: radians( lane.yaw ?? 0 ) };

}

class LaneDriver {

	/**
	 * @param {object} lane
	 * @param {object} [options]
	 * @param {number} [options.early] press this much further (m) before the feature than the lane says
	 * @param {number} [options.frames] give up after this many frames
	 * @param {number} [options.tap] how many frames a press is held
	 */
	constructor( lane, { early = 0, frames = 60 * 7, tap = 2 } = {} ) {

		this.lane = lane;
		this.early = early;
		this.limit = frames;
		this.tap = tap;
		const yaw = radians( lane.yaw ?? 0 );
		this.forward = [ Math.sin( yaw ), Math.cos( yaw ) ];
		this.feature = lane.feature;
		this.key = PRESS_KEYS[ lane.press ] ?? null;
		this.held = lane.drive === 'stand' ? [] : [ 'KeyW', ...( lane.drive === 'full' ? [ 'ShiftLeft' ] : [] ) ];
		this.frame = 0;
		this.pressedAt = null;
		this.caught = null;
		this.bailed = false;
		this.done = false;

	}

	// How far the feature is ahead of a point, along the lane (m).
	ahead( position ) {

		return ( this.feature[ 0 ] - position.x ) * this.forward[ 0 ] + ( this.feature[ 2 ] - position.z ) * this.forward[ 1 ];

	}

	/**
	 * The keys for the next frame.
	 * @param {Runner} runner
	 * @returns {{keys: string[], edges: Array<[string, string]>}} the keys held, and the presses and releases to queue
	 */
	next( runner ) {

		const f = this.frame, lane = this.lane;
		if ( this.pressedAt === null && ( this.key || lane.press === 'stop' ) && this.ahead( runner.position ) <= ( lane.at ?? 0 ) + this.early ) this.pressedAt = f;

		const edges = [];
		let keys = this.held;
		if ( lane.press === 'stop' ) {

			if ( this.pressedAt !== null ) keys = [];

		} else if ( this.key && this.pressedAt !== null ) {

			const since = f - this.pressedAt;
			if ( since === 0 ) edges.push( [ this.key, 'pressed' ] );
			if ( since === this.tap ) edges.push( [ this.key, 'released' ] );
			if ( since < this.tap ) keys = [ ...keys, this.key ];

		}

		return { keys, edges };

	}

	/**
	 * Judges the frame just run.
	 * @param {Simulation} sim
	 * @returns {boolean} whether the lane is over
	 */
	after( sim ) {

		const runner = sim.runner;
		this.frame ++;
		if ( SUCCESS_STATES.has( runner.state ) && this.caught === null ) this.caught = runner.state;
		if ( runner.state === 'bailing' || sim.ragdoll.active ) this.bailed = true;
		this.done = this.bailed || this.caught !== null || ( runner.grounded && - this.ahead( runner.position ) > PAST ) || this.frame >= this.limit;
		return this.done;

	}

	/**
	 * @param {Simulation} sim
	 * @returns {object} `made`, `caught` (the state it caught on, or null), `bailed`, `past` (m beyond the feature), `y`,
	 *   `pressedAt`, `frames`
	 */
	result( sim ) {

		const runner = sim.runner, past = - this.ahead( runner.position );
		return {
			made: ! this.bailed && ( this.caught !== null || past > PAST ),
			caught: this.caught,
			bailed: this.bailed,
			past: Math.round( past * 100 ) / 100,
			y: Math.round( runner.position.y * 100 ) / 100,
			pressedAt: this.pressedAt,
			frames: this.frame,
		};

	}

}

export { LaneDriver, laneStart, SUCCESS_STATES };
