import { ease } from '../easing.js';
import { REST, eachClip } from './recipes.js';

// Transitions taken in one update at most: each is tried from the state the one before reached.
const MOST_TRANSITIONS = 3;

/**
 * One pose of a state machine, with the transitions out of it, tried in the order they were added.
 */
class State {

	/**
	 * @param {string} name
	 * @param {object|null} pose the node it shows (null: the rest pose)
	 * @param {object[]} players the clip players (or blends) a hand-over "when done" is judged by, first listed first
	 * @param {Object<string, State>} machine the machine's states, which transitions go to
	 */
	constructor( name, pose, players, machine ) {

		this.name = name;
		this.pose = pose;
		this.players = players;
		this.machine = machine;
		this.transitions = [];

		/** Its recipe from the update it was last shown in, and that update's number. */
		this.recipe = null;
		this.updatedAt = - Infinity;

	}

	/**
	 * A transition to `target`, cross-fading over `crossfade` seconds, taken when `test( inputs )` holds.
	 * @param {string} target
	 * @param {number} crossfade
	 * @param {(inputs: object) => boolean} test
	 * @param {object} [options]
	 * @param {(graph: Graph) => void} [options.onStart] called as the transition is taken
	 * @returns {State} this, for the next transition
	 */
	to( target, crossfade, test, { onStart = null } = {} ) {

		this.transitions.push( { target: this.state( target ), crossfade, test, onStart } );
		return this;

	}

	/**
	 * A transition to `target` taken when the state's main clip has no more than `crossfade` seconds left: the
	 * cross-fade starts already as far in as the clip has gone past that point, so it ends as the clip does.
	 * @returns {State} this
	 */
	toWhenDone( target, crossfade ) {

		this.transitions.push( { target: this.state( target ), crossfade, whenDone: true, onStart: null } );
		return this;

	}

	// A state of the same machine, by name.
	state( name ) {

		if ( ! this.machine[ name ] ) throw new Error( `${ this.name } has no state ${ name } to go to` );
		return this.machine[ name ];

	}

	reset() {

		this.pose?.reset();

	}

	update( graph ) {

		// A state shown twice in one update (on both sides of a cross-fade) is worked out once.
		if ( this.updatedAt !== graph.frame ) {

			this.recipe = this.pose ? this.pose.update( graph ) : REST;
			this.updatedAt = graph.frame;

		}

		return this.recipe;

	}

	/**
	 * How long the state's main clip has left (s): of its players, the one with most weight in the state's recipe of
	 * the update before. Never done when it was not shown then.
	 */
	timeLeft( graph ) {

		if ( this.updatedAt !== graph.frame - 1 ) return Infinity;

		const weights = new Map();
		eachClip( this.recipe, ( clip, weight ) => {

			const owner = clip.player?.owner ?? clip.player;
			if ( owner ) weights.set( owner, ( weights.get( owner ) || 0 ) + weight );

		} );

		let main = null, most = 0;
		for ( const player of this.players ) {

			const weight = weights.get( player ) || 0;
			if ( weight > most ) {

				main = player;
				most = weight;

			}

		}

		return main ? main.timeLeft( graph ) : Infinity;

	}

}

/**
 * States with transitions between them, cross-fading (smoothstep) from one to the next.
 *
 * - A machine that was not updated in the update before starts again at its initial state, which then holds for that
 *   first update: a switch away from its branch, or a move covering its layer fully, restarts it when it comes back.
 * - Each update tries the current state's transitions, in order, and takes the first that holds; then those of the
 *   state it reached, up to three in all.
 * - Entering a state starts its pose again, unless it is the current state or still shows in the cross-fade being
 *   left.
 * - A transition taken during a cross-fade fades from that cross-fade as it stands, which goes on underneath.
 */
class StateMachine {

	/**
	 * @param {string} name
	 * @param {Object<string, object>} states each state's pose: a node (its own player when it has a clip to judge),
	 *   `{ pose, players }`, or null for the rest pose
	 * @param {string} initial
	 */
	constructor( name, states, initial ) {

		this.name = name;
		this.states = {};

		for ( const [ stateName, entry ] of Object.entries( states ) ) {

			const { pose, players } = entry === null || entry.update ? { pose: entry, players: entry?.timeLeft ? [ entry ] : [] } : entry;
			this.states[ stateName ] = new State( stateName, pose, players, this.states );

		}

		this.initial = this.states[ initial ];
		this.current = this.initial;
		/** The cross-fade under way, `{ from, to, crossfade, age, weight }` (`from` a state or a cross-fade), or null. */
		this.fade = null;
		this.updatedAt = - Infinity;

	}

	/**
	 * The state named, to add its transitions.
	 * @returns {State}
	 */
	from( name ) {

		return this.states[ name ];

	}

	/** Starts again at the initial state when next updated. */
	reset() {

		this.updatedAt = - Infinity;

	}

	update( graph ) {

		const restart = this.updatedAt < graph.frame - 1;
		this.updatedAt = graph.frame;

		if ( restart ) {

			this.current = this.initial;
			this.fade = null;
			this.current.reset();

		} else {

			for ( let count = 0; count < MOST_TRANSITIONS && this.takeTransition( graph ); count ++ );

		}

		if ( ! this.fade ) return this.current.update( graph );

		const recipe = this.crossfade( this.fade, graph );
		if ( this.fade.weight >= 1 ) this.fade = null;
		return recipe;

	}

	// Takes the current state's first transition that holds, if any.
	takeTransition( graph ) {

		const state = this.current;
		let found = null, age = 0;

		for ( const transition of state.transitions ) {

			if ( transition.whenDone ) {

				age = transition.crossfade - state.timeLeft( graph );
				if ( age >= 0 ) found = transition;

			} else if ( transition.test( graph.inputs ) ) {

				age = 0;
				found = transition;

			}

			if ( found ) break;

		}

		if ( ! found ) return false;

		found.onStart?.( graph );

		const target = found.target;
		const showing = this.current === target || shareOf( this.fade, target ) > 0;

		this.fade = { from: this.fade ?? this.current, to: target, crossfade: found.crossfade, age, weight: 0 };
		this.current = target;
		if ( ! showing ) target.reset();

		return true;

	}

	// A cross-fade's recipe; each cross-fade in it ages one step. The state faded to is worked out first.
	crossfade( fade, graph ) {

		fade.age += graph.dt;
		fade.weight = ease( fade.age / Math.max( fade.crossfade, 1e-8 ), 'smoothstep' );

		const to = fade.to.update( graph );
		if ( fade.weight >= 1 ) return to;

		const from = fade.from instanceof State ? fade.from.update( graph ) : this.crossfade( fade.from, graph );
		return { kind: 'mix', a: from, b: to, weight: fade.weight };

	}

}

// How much a state shows in a cross-fade, as of its last update.
function shareOf( fade, state ) {

	if ( ! fade ) return 0;

	const from = fade.from instanceof State ? Number( fade.from === state ) : shareOf( fade.from, state );

	return from * ( 1 - fade.weight ) + Number( fade.to === state ) * fade.weight;

}

export { StateMachine };
