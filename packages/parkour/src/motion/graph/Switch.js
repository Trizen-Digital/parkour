import { ease } from '../easing.js';

/**
 * One of two poses by a yes-or-no question about the runner (on a pole? sliding?), blending to the other over a set
 * time when the answer changes.
 *
 * It takes its first answer at once. A side is only updated while it shows (weight above a millionth), so a switch is
 * also a gate: a state machine behind a side that has gone starts again when it comes back (StateMachine), which is
 * why these blend times are timing as much as looks.
 */
class Switch {

	/**
	 * @param {(inputs: object) => boolean} test
	 * @param {{ on: number, off: number }} times the blend to `whenTrue` and back to `whenFalse` (s)
	 * @param {object} whenTrue
	 * @param {object} whenFalse
	 */
	constructor( test, times, whenTrue, whenFalse ) {

		this.test = test;
		this.times = times;
		this.whenTrue = whenTrue;
		this.whenFalse = whenFalse;
		this.reset();

	}

	/** Forgets its answer (the next is taken at once) and starts both sides again. */
	reset() {

		/** The last answer, or null before the first. */
		this.answer = null;
		/** The true side's share. */
		this.weight = 0;
		/** The blend under way: `{ from, age, time }`, or null. */
		this.blend = null;
		this.whenTrue.reset();
		this.whenFalse.reset();

	}

	update( graph ) {

		const answer = Boolean( this.test( graph.inputs ) );

		if ( this.answer === null ) {

			this.answer = answer;
			this.weight = answer ? 1 : 0;

		} else if ( answer !== this.answer ) {

			this.answer = answer;
			this.blend = { from: this.weight, age: 0, time: answer ? this.times.on : this.times.off };

		}

		if ( this.blend ) {

			const blend = this.blend;
			blend.age += graph.dt;

			const alpha = ease( blend.age / Math.max( blend.time, 1e-8 ) );
			this.weight = blend.from + ( ( answer ? 1 : 0 ) - blend.from ) * alpha;
			if ( alpha >= 1 ) this.blend = null;

		}

		const shown = this.weight, hidden = 1 - shown;

		if ( shown <= 1e-6 ) return this.whenFalse.update( graph );
		if ( hidden <= 1e-6 ) return this.whenTrue.update( graph );
		return { kind: 'mix', a: this.whenTrue.update( graph ), b: this.whenFalse.update( graph ), weight: hidden };

	}

}

export { Switch };
