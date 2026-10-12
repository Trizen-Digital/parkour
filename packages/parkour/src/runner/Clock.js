// A time within this much of now counts as now (s): step times are sums of 1/120 in floating point, so a time set
// some steps ahead and the step that reaches it can differ in the last bits.
const SLACK = 1e-8;

/**
 * The runner's clock: one place for everything it times. Its time is the runner's (seconds since the respawn), and
 * three kinds of thing are kept on it by name:
 *
 * - **timers** (`after`): a callback some seconds from now, fired by `run()` at the start of the runner's step;
 * - **holds** (`hold`): something held back, or held open, until a time — a lock, a cooldown, a window;
 * - **periods** (`every`): a check made on a beat, asked each step how many beats have come.
 *
 * A name is one thing at a time: setting it again replaces it. Each system names its own and cancels them when it
 * resets. Only `run()` fires timers, once a step; the time can also move without it (while the ragdoll has the body
 * the runner's step does not run, so its timers wait, but what is held still reads right).
 */
class Clock {

	constructor() {

		/** Now (s). */
		this.time = 0;
		// When the step being run began: the time of the run before.
		this.stepStart = 0;
		// Pending timers by name: { at, order, callback }; order breaks ties between timers due at the same time.
		this.timers = new Map();
		this.order = 0;
		// Holds by name: the time each ends.
		this.holds = new Map();
		// Periods by name: { interval, next }.
		this.periods = new Map();

	}

	/**
	 * Calls back `seconds` from now, replacing a pending timer of the same name. A timer set while the clock runs
	 * waits for the next run, so 0 means at the start of the next step.
	 * @param {number} seconds
	 * @param {string} name
	 * @param {Function} callback called with the arguments given to `run()`
	 */
	after( seconds, name, callback ) {

		this.timers.set( name, { at: this.time + seconds, order: this.order ++, callback } );

	}

	/** True while a timer of this name is waiting to fire. */
	pending( name ) {

		return this.timers.has( name );

	}

	/**
	 * Forgets whatever goes by these names: a pending timer, a hold or a period. A system cancels its own when it
	 * resets.
	 * @param {...string} names
	 */
	cancel( ...names ) {

		for ( const name of names ) {

			this.timers.delete( name );
			this.holds.delete( name );
			this.periods.delete( name );

		}

	}

	/** Forgets every timer, hold and period (a teleport starts them all again). */
	clear() {

		this.timers.clear();
		this.holds.clear();
		this.periods.clear();

	}

	/**
	 * Holds `name` for `seconds` from now (Infinity: until released), replacing any hold of that name, longer or
	 * shorter.
	 */
	hold( name, seconds ) {

		this.holds.set( name, this.time + seconds );

	}

	/** True while `name` is held. */
	held( name ) {

		const end = this.holds.get( name );

		return end !== undefined && this.time + SLACK < end;

	}

	/** Ends holds now. */
	release( ...names ) {

		for ( const name of names ) this.holds.delete( name );

	}

	/** The time a hold ends: now, if it is not held. */
	readyAt( name ) {

		return this.held( name ) ? this.holds.get( name ) : this.time;

	}

	/**
	 * A check on a beat: how many beats of `interval` have come since the last ask (0 most steps, 1 when one has come,
	 * more after a long wait). The first ask begins the beat, counting the step it is made in: a beat begun in a step
	 * began with it. Cancel the name to begin again.
	 * @param {string} name
	 * @param {number} interval s
	 * @returns {number}
	 */
	every( name, interval ) {

		let period = this.periods.get( name );

		if ( ! period ) {

			period = { interval, next: this.stepStart + interval };
			this.periods.set( name, period );

		}

		let beats = 0;

		while ( period.next <= this.time + SLACK ) {

			period.next += period.interval;
			beats ++;

		}

		return beats;

	}

	/**
	 * Moves on to `time` (the end of the step about to run) and fires every timer due by then, earliest first (in the
	 * order they were set, when due together). A timer cancelled or replaced by an earlier callback does not fire.
	 * @param {number} time s
	 * @param {...*} args passed to each callback
	 */
	run( time, ...args ) {

		this.stepStart = this.time;
		this.time = time;

		const due = [ ...this.timers ]
			.filter( ( [ , timer ] ) => timer.at <= time + SLACK )
			.sort( ( [ , a ], [ , b ] ) => a.at - b.at || a.order - b.order );

		for ( const [ name, timer ] of due ) {

			if ( this.timers.get( name ) !== timer ) continue;

			this.timers.delete( name );
			timer.callback( ...args );

		}

	}

}

export { Clock };
