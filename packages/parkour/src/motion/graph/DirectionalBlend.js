import { springTowards } from '../easing.js';
import { blendWeights } from './blends.js';

/**
 * Takes placed on one or two axes (blends.js), mixed by where an input falls among them: the run leaning by how hard
 * it turns and how fast it goes, the hang looking where the stick points, the body's lean.
 *
 * Each step the input is eased (when the blend asks for it), the weights it calls for are found, and the weights
 * the blend shows ease toward those (critically damped, at the blend's `weightRate`; at once on entering). The
 * takes keep in step: they share one phase, which goes round once in the weighted mean of their cycle times, and
 * each is sampled that far through itself.
 */
class DirectionalBlend {

	/**
	 * @param {object} blend one of BLENDS
	 * @param {(inputs: object) => number[]} input where on its axes the blend is, a value per axis
	 * @param {TakeLibrary} library the takes: their lengths and strides set the samples' rates and the blend's cycle
	 */
	constructor( blend, input, library ) {

		this.blend = blend;
		this.input = input;

		/** The blend's nominal cycle (s): the length of the take it names. */
		this.length = library.takes.get( blend.length ).length;

		/**
		 * Each sample's rate: on a speed axis, a take with a stride plays at the rate that carries the stride at the
		 * sample's speed (its cycle then takes stride / speed seconds); any other plays at 1.
		 */
		this.rates = blend.samples.map( ( sample ) => {

			const take = library.takes.get( sample.take );

			return blend.speedAxis !== undefined && take.stride ? sample.at[ blend.speedAxis ] * take.length / take.stride : 1;

		} );

		/** One player per sample: the clock each sample's markers are kept apart by. */
		this.players = blend.samples.map( () => ( { owner: this } ) );

		this.reset();

	}

	/** Back to the start of the cycle, the weights taken afresh, for when its state is entered again. */
	reset() {

		/** How far round the cycle the takes are (counted on past 1). */
		this.phase = 0;
		/** The weight each sample shows, by sample index, in the order they first took part: `{ weight, rate }`. */
		this.weights = null;
		/** The eased input per axis, `{ value, rate }` (null before the first step, which starts it where it is). */
		this.smoothed = null;

	}

	update( graph ) {

		const blend = this.blend, dt = graph.dt, takes = graph.library.takes;
		const input = this.smooth( this.input( graph.inputs ).map( ( value ) => value || 0 ), dt );
		const targets = new Map( blendWeights( blend, input ).map( ( sample ) => [ sample.index, sample.weight ] ) );
		const entering = this.weights === null;

		this.weights ??= new Map();

		// Samples already in the mix keep their place; new ones join at the end. A sample on its way out eases to 0.
		let total = 0;
		for ( const index of new Set( [ ...this.weights.keys(), ...targets.keys() ] ) ) {

			const target = targets.get( index ) ?? 0, previous = this.weights.get( index );
			const next = entering ? { value: target, rate: 0 } : springTowards( previous?.weight || 0, previous?.rate || 0, target, dt, blend.weightRate );

			this.weights.set( index, { weight: next.value, rate: next.rate } );
			total += next.value;

		}

		const samples = [];
		let cycle = 0;
		for ( const [ index, { weight } ] of this.weights ) {

			if ( weight <= 1e-6 ) continue;

			const sample = blend.samples[ index ], share = weight / Math.max( total, 1e-8 );
			samples.push( { index, take: sample.take, weight: share } );
			cycle += ( share * takes.get( sample.take ).length ) / Math.max( this.rates[ index ], 1e-8 );

		}

		const from = this.phase, to = from + dt / Math.max( cycle, 1e-8 );
		this.phase = to;

		return {
			kind: 'blend',
			samples: samples.map( ( { index, take, weight } ) => {

				const length = takes.get( take ).length;

				return {
					weight,
					recipe: { kind: 'clip', take, time: ( to % 1 ) * length, from: from * length, to: to * length, loop: true, player: this.players[ index ] }
				};

			} ),
			markers: 'heaviest'
		};

	}

	/**
	 * How far the blend has to go round its cycle, in the blend's nominal cycle time (s): a state hands over by it.
	 */
	timeLeft() {

		return this.length - ( this.phase % 1 );

	}

	// The input eased on the axes that ask for it (critically damped, over `smoothing` seconds), kept on its axis.
	smooth( input, dt ) {

		const { smoothing, axes } = this.blend;

		this.smoothed ??= input.map( ( value ) => ( { value, rate: 0 } ) );

		return input.map( ( target, axis ) => {

			if ( ! ( smoothing[ axis ] > 0 ) ) return target;

			const state = this.smoothed[ axis ];
			Object.assign( state, springTowards( state.value, state.rate, target, dt, 1 / smoothing[ axis ] ) );

			if ( state.value > axes[ axis ].max ) {

				state.value = axes[ axis ].max;
				state.rate = Math.min( state.rate, 0 );

			} else if ( state.value < axes[ axis ].min ) {

				state.value = axes[ axis ].min;
				state.rate = Math.max( state.rate, 0 );

			}

			return state.value;

		} );

	}

}

export { DirectionalBlend };
