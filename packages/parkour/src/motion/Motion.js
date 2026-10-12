import { TakeLibrary } from './TakeLibrary.js';
import { markersCrossed } from './markers.js';
import { Moves } from './Moves.js';
import { RootMotion } from './RootMotion.js';
import { Graph } from './graph/Graph.js';
import { REST, eachClip } from './graph/recipes.js';
import { clamp } from '../math.js';

/**
 * The motion system: what the runner gets from the takes, and the pose recipe the figure is drawn from.
 *
 * Each step, after the runner's own step, it advances the one-shot moves, updates the pose graph from the runner's
 * pose inputs, and gathers the markers both crossed, in that order; the runner reacts to them at the start of its next
 * step. The sound cues they crossed are kept apart, for a game's sound: nothing in the run reads them. The runner plays moves (`moves`), and asks how long a move lasts and how far it carries the root. Nothing here
 * reads a bone: the figure poses itself from the recipe.
 */
class Motion {

	/**
	 * @param {object} [options]
	 * @param {string} [options.moves] where the take and move tables are
	 */
	constructor( { moves = './data/moves.json' } = {} ) {

		this.url = moves;

		/** The take and move tables, the moves playing, the pose graph and the root motion: made by load(). */
		this.takes = null;
		this.moves = null;
		this.graph = null;
		this.root = null;

		/** The last step's recipe. */
		this.recipe = REST;
		/** The markers the last step fired, in order: `{ type: 'marker', name, weight }`. */
		this.markers = [];
		/** The sound cues the last step fired, in order: `{ type: 'sound', name, weight }`. */
		this.sounds = [];
		// The markers' names waiting for the runner (takeMarkers).
		this.queue = [];

	}

	/**
	 * Loads the take and move tables.
	 * @param {(text: string) => void} [onProgress]
	 * @returns {Promise<Motion>}
	 */
	async load( onProgress = () => {} ) {

		onProgress( 'Loading the moves…' );
		this.takes = new TakeLibrary( await fetch( this.url ).then( ( response ) => response.json() ) );
		this.moves = new Moves( this.takes );
		this.graph = new Graph( this.takes, this.moves );
		this.root = new RootMotion( this.takes, this.moves );
		return this;

	}

	/** Starts afresh (a respawn): no move playing, no marker waiting, the graph from its start. */
	reset() {

		this.moves.instances = [];
		this.graph = new Graph( this.takes, this.moves, this.graph.random );
		this.recipe = REST;
		this.markers = [];
		this.sounds = [];
		this.queue = [];

	}

	/** The take a move plays, or null. */
	takeOf( name ) {

		return this.takes.moves.get( name )?.take ?? null;

	}

	/** A move's length in seconds at its own rate. */
	length( name ) {

		const move = this.takes.moves.get( name );

		return move.length / move.rate;

	}

	/** Whether a move carries the root (its take has a root track). */
	hasRootMotion( name ) {

		return Boolean( this.takes.takes.get( this.takeOf( name ) )?.root );

	}

	/**
	 * The markers fired since the runner last asked, by name, in order.
	 * @returns {string[]}
	 */
	takeMarkers() {

		return this.queue.splice( 0 );

	}

	/**
	 * The root's travel over the next `dt` of the move playing, without moving it on.
	 * @returns {{ translation: Vector3 }|null}
	 */
	rootMotion( dt ) {

		return this.root.extract( dt );

	}

	/**
	 * The root's travel through a move between two times on its clock before its own rate (a stunt's time times the
	 * rate it was started at): where a stunt goes when its move was cut short.
	 * @returns {Vector3}
	 */
	moveDelta( name, from, to ) {

		return this.root.moveDelta( this.takes.moves.get( name ), from, to );

	}

	/**
	 * How long a move takes to raise the root as far as it ever does (s, at the move's own rate): where a climb's take
	 * has the body up on what it climbs. 0 for a move whose root never rises.
	 * @returns {number}
	 */
	riseTime( name ) {

		const move = this.takes.moves.get( name ), track = this.takes.rootTrack( move.take );

		if ( ! track ) return 0;

		const [ from, to ] = move.span, times = track.times, values = track.values;
		let top = - Infinity;
		for ( let i = 0; i < times.length; i ++ ) if ( times[ i ] >= from && times[ i ] <= to ) top = Math.max( top, values[ i * 3 + 1 ] );

		const first = times.findIndex( ( time, i ) => time >= from && time <= to && values[ i * 3 + 1 ] >= top - 1e-4 );

		return first < 0 ? 0 : ( times[ first ] - from ) / move.rate;

	}

	/**
	 * How far through its rise a move's root is, `time` (s) into the move: the shares of its rise (`up`) and of its
	 * travel along (`on`) it has made of those it makes by `until` (its riseTime), each 0 to 1. A placement carried along
	 * them goes up and on as the take's body does.
	 * @returns {{ up: number, on: number }}
	 */
	rootShare( name, time, until ) {

		const travel = this.moveDelta( name, 0, Math.min( time, until ) ), whole = this.moveDelta( name, 0, until );
		const up = whole.y > 1e-6 ? clamp( travel.y / whole.y, 0, 1 ) : clamp( time / Math.max( until, 1e-9 ), 0, 1 );
		const on = whole.z > 1e-6 ? clamp( travel.z / whole.z, 0, 1 ) : up;

		return { up, on };

	}

	/**
	 * One step: the moves, then the graph, then the markers and sound cues they crossed.
	 * @param {number} dt
	 * @param {PoseInputs} inputs
	 * @returns {object} the step's recipe
	 */
	update( dt, inputs ) {

		const crossed = this.moves.update( dt );
		const recipe = this.graph.update( dt, inputs );

		crossed.push( ...this.graphMarkers( recipe ) );
		// The runner and the traces see the markers alone, so a sound cue never changes a run.
		const markers = crossed.filter( ( marker ) => marker.type === 'marker' );
		for ( const marker of markers ) this.queue.push( marker.name );

		this.markers = markers;
		this.sounds = crossed.filter( ( marker ) => marker.type === 'sound' );
		this.recipe = recipe;
		return recipe;

	}

	// The markers and sound cues the graph's clips crossed this step. A clip's markers fire at its share of the whole pose, a blend
	// passing on only its heaviest take's (one set of footfalls); a player's shares add up; a player whose clock did not
	// move since it last fired fires nothing.
	graphMarkers( recipe ) {

		const players = new Map();

		eachClip( recipe, ( clip, weight ) => {

			if ( ! clip.player || ! ( clip.to > clip.from ) ) return;
			players.set( clip.player, { clip, weight: weight + ( players.get( clip.player )?.weight || 0 ) } );

		}, true );

		const markers = [];

		for ( const [ player, { clip, weight } ] of players ) {

			if ( player.markedTo === clip.to ) continue;

			player.markedTo = clip.to;
			markers.push( ...markersCrossed( this.takes.takes.get( clip.take ), clip.from, clip.to, { weight, loop: clip.loop } ) );

		}

		return markers;

	}

}

export { Motion };
