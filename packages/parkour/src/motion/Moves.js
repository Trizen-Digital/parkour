import { ease } from './easing.js';
import { markersCrossed } from './markers.js';

// A move playing with less weight than this has gone.
const GONE = 1e-6;

/**
 * One-shot moves: a span of a take played once into a layer of the pose graph (graph/Layer.js), over whatever the
 * graph shows there. One move plays at a time: a new one blends in as the one before blends out, over the new one's
 * blend-in. A move blends itself out as it nears its end (one that holds at its end waits on its last pose until
 * stopped), and fires its take's markers as it crosses them.
 *
 * Each move playing is an instance: `{ move, time, age, weight, rate, stopping, … }`, `time` in the move's own
 * seconds (0 … its length), `rate` the speed it plays at.
 */
class Moves {

	/**
	 * @param {TakeLibrary} library
	 */
	constructor( library ) {

		this.library = library;
		/** The moves playing and blending out, oldest first. */
		this.instances = [];

	}

	/**
	 * Plays a move from its start; whatever plays blends out as it blends in.
	 * @param {string} name
	 * @param {object} [options]
	 * @param {number} [options.rate] times the move's own rate
	 * @param {(event: { move: string, interrupted: boolean }) => void} [options.onBlendOut] called as it starts blending
	 *   out, interrupted or at its end
	 * @returns {object|null} the instance, or null for a move that does not exist
	 */
	play( name, { rate = 1, onBlendOut = null } = {} ) {

		const move = this.library.moves.get( name );

		if ( ! move ) return null;

		for ( const instance of this.instances ) this.fadeOut( instance, move.blendIn, true, move.blendInCurve );

		const instance = { move, time: 0, age: 0, weight: 0, rate: rate * move.rate, stopping: false, stopAge: 0, stopWeight: 1, blendOut: 0, blendOutCurve: undefined, onBlendOut };
		this.instances.push( instance );

		return instance;

	}

	/** The move playing (not blending out), or null. */
	playing() {

		return this.instances.findLast( ( instance ) => ! instance.stopping )?.move || null;

	}

	/** Whether a move is playing (not blending out). */
	busy() {

		return this.instances.some( ( instance ) => ! instance.stopping );

	}

	/**
	 * Blends out the moves of a name, or (no name) every move.
	 * @param {string} [name]
	 * @param {number} [time] the blend-out (s); each move's own by default
	 */
	stop( name, time ) {

		for ( const instance of this.instances ) {

			if ( ! name || instance.move.name === name ) this.fadeOut( instance, time ?? instance.move.blendOut, true );

		}

	}

	/**
	 * Re-times the move of a name playing (not blending out): on from `time` on its own clock (the markers it skips do
	 * not fire), at `rate` times its own speed. A stride straight after another picks up the step the last one has got
	 * to, at the speed that still lands it on time.
	 * @param {string} name
	 * @param {object} [options]
	 * @param {number} [options.time]
	 * @param {number} [options.rate]
	 * @returns {object|null} the instance, or null when no move of the name is playing
	 */
	retime( name, { time, rate } = {} ) {

		const instance = this.instances.findLast( ( item ) => ! item.stopping && item.move.name === name );

		if ( ! instance ) return null;

		if ( time !== undefined ) instance.time = Math.min( Math.max( 0, time ), instance.move.length );
		if ( rate !== undefined ) instance.rate = rate * instance.move.rate;

		return instance;

	}

	// Starts an instance blending out from the weight it has, over `time` along `curve` (straight by default).
	fadeOut( instance, time, interrupted, curve ) {

		if ( instance.stopping ) return;

		instance.stopping = true;
		instance.stopWeight = instance.weight;
		instance.blendOut = time;
		instance.blendOutCurve = curve;
		instance.onBlendOut?.( { move: instance.move.name, interrupted } );

	}

	/**
	 * Advances every move one step: its weight, then its time.
	 * @param {number} dt
	 * @returns {Array<object>} the markers and sound cues the moves crossed, each at its move's weight
	 */
	update( dt ) {

		const crossed = [];

		for ( const instance of this.instances ) {

			const move = instance.move;
			instance.age += dt;

			if ( ! instance.stopping ) {

				instance.weight = ease( instance.age / Math.max( move.blendIn, 1e-8 ), move.blendInCurve );

			} else {

				instance.stopAge += dt;
				instance.weight = instance.stopWeight * ( 1 - ease( instance.stopAge / Math.max( instance.blendOut, 1e-8 ), instance.blendOutCurve ) );

			}

			const to = Math.min( move.length, instance.time + Math.max( 0, dt * instance.rate ) );
			crossed.push( ...this.markersBetween( instance, instance.time, to ) );
			instance.time = to;

			// Near its end a move blends out over the time it has left, once that is no more than its blend-out; one that
			// holds at its end waits there until stopped, and then blends out over its blend-out.
			const left = ( move.length - instance.time ) / Math.max( instance.rate, 1e-8 );

			if ( ! instance.stopping && left <= ( move.holdAtEnd ? 0 : move.blendOut ) ) {

				this.fadeOut( instance, move.holdAtEnd ? move.blendOut : Math.max( left, 0 ), false );

			}

		}

		this.instances = this.instances.filter( ( instance ) => ! instance.stopping || instance.weight > GONE );

		return crossed;

	}

	/**
	 * A layer's pose: the moves playing into it over `source`. Moves share the layer by weight (scaled down together
	 * when they add up to more than all of it) and the source gets what is left; an additive move (the landing dip)
	 * is laid on top, and a move masked to the upper body over that, the source going on beneath it. The source is only
	 * worked out while it shows (as it does under a masked move), or always with `alwaysUpdateSource`.
	 * @param {string} name
	 * @param {object|(() => object)} [source] the recipe beneath, or what makes it
	 * @param {boolean} [alwaysUpdateSource]
	 * @returns {object} a recipe
	 */
	layer( name, source = { kind: 'rest' }, alwaysUpdateSource = false ) {

		const over = [], added = [], masked = [];
		let total = 0, overWeight = 0;

		for ( const instance of this.instances ) {

			const move = instance.move;
			if ( move.layer !== name || instance.weight <= GONE || instance.time > this.spanLength( move ) ) continue;

			// The runner follows a move's root, so the figure takes it as root motion (its root bone stays put).
			const sample = { recipe: { kind: 'clip', take: move.take, time: this.takeTime( move, instance.time ), rootMotion: true }, weight: instance.weight };

			if ( move.mask ) {

				masked.push( { ...sample, mask: move.mask } );
				continue;

			}

			total += instance.weight;

			if ( this.library.takes.get( move.take ).additive ) {

				added.push( sample );

			} else {

				over.push( sample );
				overWeight += instance.weight;

			}

		}

		const beneath = () => ( typeof source === 'function' ? source() : source );
		const mask = ( recipe ) => masked.reduce( ( base, sample ) => ( { kind: 'mask', base, over: sample.recipe, weight: Math.min( 1, sample.weight ), mask: sample.mask } ), recipe );

		if ( ! total ) return mask( beneath() );

		const scale = total > 1 ? total : 1;
		for ( const sample of [ ...over, ...added ] ) sample.weight /= scale;

		const left = Math.max( 0, 1 - overWeight / scale );
		const shown = left > GONE || alwaysUpdateSource || masked.length ? beneath() : { kind: 'rest' };
		if ( left > GONE ) over.push( { recipe: shown, weight: left } );

		let recipe = overWeight ? { kind: 'blend', samples: over } : shown;
		for ( const sample of added ) recipe = { kind: 'add', base: recipe, add: sample.recipe, weight: sample.weight };

		return mask( recipe );

	}

	// How long a move's span of its take lasts: the take plays at its own speed, so take seconds too.
	spanLength( move ) {

		return move.span[ 1 ] - move.span[ 0 ];

	}

	// The take time a move's time is at.
	takeTime( move, time ) {

		return move.span[ 0 ] + Math.min( Math.max( 0, time ), this.spanLength( move ) );

	}

	// The take's markers and sound cues crossed as a move goes from one of its times to another, within its span.
	markersBetween( instance, from, to ) {

		const move = instance.move;
		const a = Math.max( from, 0 ), b = Math.min( to, this.spanLength( move ) );

		if ( b <= a ) return [];

		return markersCrossed( this.library.takes.get( move.take ), move.span[ 0 ] + a, move.span[ 0 ] + b, { weight: instance.weight } );

	}

}

export { Moves };
