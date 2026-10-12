import { ease } from '../easing.js';
import { wrap } from './recipes.js';

/**
 * Standing about: plays its takes one after another in a shuffled order, never the same one twice in a row, each
 * once through and cross-fading into the next from `fade` seconds before its end (judged on its capture's clock, as a
 * ClipPlayer hands over). The order comes from the graph's own random stream, so a run shows the same idles again
 * when it plays again.
 */
class IdleShuffle {

	/**
	 * @param {string[]} takes
	 * @param {object} [options]
	 * @param {number} [options.fade] the cross-fade from one take into the next (s)
	 */
	constructor( takes, { fade = 0.25 } = {} ) {

		this.takes = takes;
		this.fade = fade;
		this.reset();

	}

	/** A fresh shuffle, for when standing about starts again. */
	reset() {

		/** The order still to come (indices into `takes`, the next at the end). */
		this.bag = [];
		/** The take last drawn, which the next shuffle never starts with. */
		this.last = - 1;
		/** The take playing and the one to follow: `{ owner, take, time, startTime, previousTime, fadeAge }`. */
		this.current = null;
		this.next = null;

	}

	// The next take in the shuffle: a fresh bag once the last runs out, its first never the take just played.
	choose( graph ) {

		const random = graph.random, count = this.takes.length;

		if ( ! this.bag.length ) {

			this.bag = this.takes.map( ( _, index ) => index );
			for ( let index = count - 1; index > 0; index -- ) {

				const swap = Math.floor( random() * ( index + 1 ) );
				[ this.bag[ index ], this.bag[ swap ] ] = [ this.bag[ swap ], this.bag[ index ] ];

			}

			if ( count > 1 && this.bag.at( - 1 ) === this.last ) {

				const swap = Math.floor( random() * ( count - 1 ) );
				[ this.bag[ swap ], this.bag[ count - 1 ] ] = [ this.bag[ count - 1 ], this.bag[ swap ] ];

			}

		}

		const index = this.bag.pop();
		this.last = index;

		return { owner: this, take: this.takes[ index ], time: 0, startTime: 0, previousTime: 0, fadeAge: 0 };

	}

	update( graph ) {

		this.current ??= this.choose( graph );
		this.next ??= this.choose( graph );

		const current = this.current, next = this.next;
		const { length, pace } = graph.library.takes.get( current.take );
		const played = current.time - current.startTime;
		const cameRound = Math.floor( played / length ) > Math.floor( ( current.previousTime - current.startTime ) / length );
		const left = ( length - ( played % length ) ) * pace;
		let weight = 0;

		if ( next.fadeAge > 0 || left <= this.fade || cameRound ) {

			next.fadeAge += graph.dt;
			weight = ease( next.fadeAge / Math.max( this.fade, 1e-8 ) );

			// Faded in: the next take plays on from where it has got to, and another is drawn to follow it.
			if ( weight >= 1 ) {

				next.startTime = next.previousTime = next.time;
				this.current = next;
				this.next = this.choose( graph );
				weight = 0;

			}

		}

		const pose = this.sample( this.current, graph );

		return weight > 0 ? { kind: 'mix', a: pose, b: this.sample( this.next, graph ), weight } : pose;

	}

	sample( player, graph ) {

		const length = graph.library.takes.get( player.take ).length;
		const from = player.time;

		player.previousTime = from;
		player.time += graph.dt;

		return { kind: 'clip', take: player.take, time: wrap( player.time, length ), from, to: player.time, loop: true, player };

	}

}

export { IdleShuffle };
