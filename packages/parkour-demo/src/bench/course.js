// The benchmark course: every station laid end to end along +z, each building its own floor and features in its own
// coordinates (x across, y up from its floor, z along from its entry), so a station's exit is the next one's entry and
// the run goes on from one to the next. Under it all lies a street, out of bounds, that ends a fall.
//
// The course is built in memory from the station catalogue (stations.js), so it always matches the scripts that drive
// it; `benchCourse()` gives the definition the game loads and where each station sits.

import { STATIONS } from './stations.js';
import { rampLength } from './script.js';

// The floors are this wide (m), centred on the station's line.
const WIDTH = 8;

// The street lies this far below the floors (m): a fall into a pit lands there, out of bounds.
const STREET = - 12;

// A spawn is a capsule centre: this far above the floor (m), as at every course's spawn.
const STANDING_HEIGHT = 0.9215;

// The fields of a course prim that are points.
const POINTS = [ 'p', 'a', 'b', 'min', 'max' ];

const r3 = ( x ) => Math.round( x * 1000 ) / 1000;

/** Builds one station's prims, from its own coordinates into the course's. */
class StationBuilder {

	/**
	 * @param {object} station
	 * @param {number} z0 where its entry is along the course (m)
	 */
	constructor( station, z0 ) {

		this.station = station;
		this.z0 = z0;
		this.prims = [];
		this.count = 0;

	}

	/** Any course prim, its points given in the station's coordinates. */
	add( prim ) {

		const out = { ...prim, id: `${this.station.id}/${prim.id ?? `${prim.type}${++ this.count}`}` };
		for ( const key of POINTS ) if ( Array.isArray( out[ key ] ) ) out[ key ] = [ r3( out[ key ][ 0 ] ), r3( out[ key ][ 1 ] ), r3( out[ key ][ 2 ] + this.z0 ) ];
		this.prims.push( out );
		return out.id;

	}

	/** A box by its corners. */
	box( min, max, extra = {} ) {

		return this.add( { type: 'box', min, max, ...extra } );

	}

	/** A floor from z0 to z1 with its top at y (a metre-thick slab, or down to `base`). */
	floor( z0, z1, { y = 0, x0 = - WIDTH / 2, x1 = WIDTH / 2, base = y - 1, ...extra } = {} ) {

		return this.box( [ x0, base, z0 ], [ x1, y, z1 ], extra );

	}

	/** A block standing on the floor across the line: `width` across, from z0, `depth` deep, `height` high. */
	block( z0, depth, height, { width = 3, x = 0, y = 0, ...extra } = {} ) {

		return this.box( [ x - width / 2, y, z0 ], [ x + width / 2, y + height, z0 + depth ], extra );

	}

	/** A slope rising along +z from z0 over `length` to `rise` above y (a wedge's `p` is the middle of its base). */
	ramp( z0, length, rise, { width = 3, x = 0, y = 0 } = {} ) {

		return this.add( { type: 'wedge', p: [ x, y, z0 + length / 2 ], size: [ width, rise, length ], yaw: 0 } );

	}

	/** A slope falling along +z from `rise` above y at z0 to y over `length`. */
	rampDown( z0, length, rise, { width = 3, x = 0, y = 0 } = {} ) {

		return this.add( { type: 'wedge', p: [ x, y, z0 + length / 2 ], size: [ width, rise, length ], yaw: 180 } );

	}

	/**
	 * A way up to a deck: a slope from z0 rising `height` (at script.js's RAMP_SLOPE), then the deck, solid down to the
	 * floor.
	 * @returns {number} where the deck starts along the station (m)
	 */
	climbTo( z0, height, deckLength, { width = 3, x = 0 } = {} ) {

		const run = rampLength( height );
		this.ramp( z0, run, height, { width, x } );
		this.box( [ x - width / 2, 0, z0 + run ], [ x + width / 2, height, z0 + run + deckLength ] );
		return z0 + run;

	}

	/** A way down from a deck `height` up ending at z0: a slope falling from z0. Returns where it ends. */
	descendFrom( z0, height, { width = 3, x = 0 } = {} ) {

		const run = rampLength( height );
		this.rampDown( z0, run, height, { width, x } );
		return z0 + run;

	}

}

/**
 * The course: the stations' prims end to end, the street under them, and where each station is.
 * @param {object[]} [stations] the catalogue (all of it by default)
 * @returns {{def: object, placed: object[]}} the course definition, and per station `{ station, index, z0, z1,
 *   entry }` (entry: a respawn's place and heading)
 */
function benchCourse( stations = STATIONS ) {

	const prims = [], placed = [];
	let z = 0;
	stations.forEach( ( station, index ) => {

		const builder = new StationBuilder( station, z );
		if ( station.ground !== false ) builder.floor( 0, station.length );
		station.build?.( builder );
		prims.push( ...builder.prims );
		placed.push( { station, index, z0: z, z1: z + station.length, entry: { position: [ 0, STANDING_HEIGHT, z ], yaw: 0 } } );
		z += station.length;

	} );

	prims.push( { type: 'box', id: 'street', min: [ - 60, STREET - 1, - 60 ], max: [ 60, STREET, z + 60 ], roles: [ 'out' ] } );
	const def = {
		name: 'bench',
		title: 'The benchmark',
		about: `Every move and trick the runner has, ${stations.length} stations end to end along +z, driven by the benchmark's autopilot (src/bench/).`,
		spawn: { p: [ 0, 0, 0 ], yaw: 0 },
		prims,
	};
	return { def, placed };

}

export { benchCourse, StationBuilder, STANDING_HEIGHT, WIDTH };
