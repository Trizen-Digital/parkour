import { wrap } from './recipes.js';

/**
 * Plays one take from its start at its own speed (or at a rate read from the runner): once, holding its last pose at
 * the end, or round and round.
 *
 * A state hands over "when done" by how long its main clip has left (StateMachine). That is judged on the clock the
 * take was captured at: a take whose `pace` (in the take table) speeds it up still hands over at the same point of its
 * motion, so a 0.2 s cross-fade out of a take paced up by 1.25 starts 0.16 s before its end and runs 0.2 s.
 */
class ClipPlayer {

	/**
	 * @param {string} take
	 * @param {object} [options]
	 * @param {boolean} [options.loop] round and round, else once
	 * @param {(inputs: object) => number} [options.rate] how fast it plays, read each update (its own speed when left out)
	 * @param {number} [options.start] where it starts (s): with a rate of 0, a pose held
	 */
	constructor( take, { loop = false, rate = null, start = 0 } = {} ) {

		this.take = take;
		this.loop = loop;
		this.rate = rate;
		this.start = start;

		/** Where the take is (s): counted on past its length when it loops. */
		this.time = start;
		/** Where it was before its last update. */
		this.previousTime = start;

	}

	/** Back to the take's start, for when its state is entered again. */
	reset() {

		this.time = this.start;
		this.previousTime = this.start;

	}

	update( graph ) {

		const length = graph.library.takes.get( this.take ).length;
		const from = this.time;
		const rate = this.rate?.( graph.inputs );
		const dt = graph.dt * ( Number.isFinite( rate ) ? rate : 1 );
		const to = this.loop ? from + dt : Math.min( from + dt, length );

		this.previousTime = from;
		this.time = to;

		return { kind: 'clip', take: this.take, time: this.loop ? wrap( to, length ) : to, from, to, loop: this.loop, player: this };

	}

	/**
	 * How long the take has left on its capture's clock (s); none when it has just come round to its start.
	 * @param {Graph} graph
	 */
	timeLeft( graph ) {

		const { length, pace } = graph.library.takes.get( this.take );
		const looped = this.loop && Math.floor( this.time / length ) > Math.floor( this.previousTime / length );

		return looped ? 0 : ( length - ( this.loop ? wrap( this.time, length ) : this.time ) ) * pace;

	}

}

export { ClipPlayer };
