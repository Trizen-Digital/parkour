// Seeded random streams: the run's only chance (which dash vault, which idle shuffle, where a camera shake starts).
//
// Nothing in a run calls Math.random. Each stream draws from its own seeded state and a respawn resets them all, so
// a run plays again exactly from its raw input. Each stream has its own number in the seed, so draws from one never
// move another's. The numbers are fixed: changing one changes every run that draws from that stream.
const STREAMS = { vaultChoice: 1, idleChoice: 3, shakePhase: 4 };

class SeededRandom {

	/**
	 * @param {number} [seed] a 32-bit integer
	 */
	constructor( seed = 1 ) {

		this.seed = seed;
		this.state = {};
		this.reset();

	}

	/**
	 * Every stream back to its start for a seed.
	 * @param {number} [seed]
	 */
	reset( seed = this.seed ) {

		this.seed = seed;
		for ( const [ name, number ] of Object.entries( STREAMS ) ) {

			// Two odd multipliers (the golden ratio's and a hash's) spread neighbouring seeds and streams apart.
			this.state[ name ] = ( Math.imul( seed, 0x9e3779b1 ) + Math.imul( number, 0x85ebca77 ) ) >>> 0;

		}

	}

	/**
	 * The stream's next draw (a 32-bit mix of its state, Mulberry32).
	 * @param {string} name one of the streams
	 * @returns {number} in [0, 1)
	 */
	next( name ) {

		let t = this.state[ name ] = ( this.state[ name ] + 0x6d2b79f5 ) >>> 0;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	/**
	 * @param {string} name
	 * @returns {() => number} the stream's draws, for a part that only ever draws from one
	 */
	stream( name ) {

		return () => this.next( name );

	}

	/** @returns {object} the seed and every stream's state, for restore() */
	save() {

		return { seed: this.seed, state: { ...this.state } };

	}

	restore( saved ) {

		this.seed = saved.seed;
		Object.assign( this.state, saved.state );

	}

}

/**
 * The game's streams. One for the page: a QA replay run beside the live game saves and restores it around its run.
 */
const random = new SeededRandom();

export { random, SeededRandom };
