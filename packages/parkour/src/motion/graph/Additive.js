import { clamp } from '../../math.js';
import { ease } from '../easing.js';

/**
 * An additive pose laid over a base: the crouch of a charging jump, the lean into braking, the dip of a landing.
 * Its weight is a number or read from the runner; a `toggle` fades it in and out over `fadeIn` / `fadeOut` seconds
 * as its answer changes (taking its first answer at once). The added pose is only updated while it has weight.
 */
class Additive {

	/**
	 * @param {object} base
	 * @param {object} add
	 * @param {object} [options]
	 * @param {number|((inputs: object) => number)} [options.weight]
	 * @param {(inputs: object) => boolean} [options.toggle]
	 * @param {number} [options.fadeIn] (s)
	 * @param {number} [options.fadeOut] (s)
	 */
	constructor( base, add, { weight = 1, toggle = null, fadeIn = 0, fadeOut = 0 } = {} ) {

		this.base = base;
		this.add = add;
		this.weight = weight;
		this.toggle = toggle;
		this.fadeIn = fadeIn;
		this.fadeOut = fadeOut;
		this.reset();

	}

	reset() {

		/** The toggle's fade: where it is, toward which end, from where and for how long; null before its first answer. */
		this.fade = null;
		this.base.reset();
		this.add.reset();

	}

	update( graph ) {

		let weight = typeof this.weight === 'function' ? this.weight( graph.inputs ) : this.weight;

		if ( this.toggle ) weight *= this.faded( this.toggle( graph.inputs ) ? 1 : 0, graph.dt );

		weight = clamp( weight, 0, 1 );
		const base = this.base.update( graph );

		return weight > 0 ? { kind: 'add', base, add: this.add.update( graph ), weight } : base;

	}

	// The toggle's share: straight toward its answer, over the fade for that way.
	faded( target, dt ) {

		if ( this.fade?.target !== target ) this.fade = { target, from: this.fade?.share ?? target, age: 0, share: 0 };

		const fade = this.fade;
		fade.age += dt;
		fade.share = fade.from + ( target - fade.from ) * ease( fade.age / Math.max( target ? this.fadeIn : this.fadeOut, 1e-8 ) );

		return fade.share;

	}

}

export { Additive };
