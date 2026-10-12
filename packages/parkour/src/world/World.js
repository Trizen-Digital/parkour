import { Queries } from '../physics/Queries.js';
import { catchVolumes } from './catchVolumes.js';

// Below this height (m) the runner has fallen out of a world and starts again at its first spawn, unless the world
// says otherwise.
const FLOOR = - 30;

// What each kind of thing to take hold of must carry: its vectors ({ x, y, z }) and its numbers.
const FEATURES = {
	poles: { vectors: [ 'bottom', 'top' ], numbers: [ 'radius' ] },
	pipes: { vectors: [ 'start', 'end', 'forward' ], numbers: [ 'radius' ] },
	ziplines: { vectors: [ 'start', 'end', 'forward' ], numbers: [ 'radius' ] },
	ladders: { vectors: [ 'start', 'end', 'forward' ], numbers: [ 'width' ] },
	ropes: { vectors: [ 'anchor', 'end' ], numbers: [ 'length' ] },
	doors: { vectors: [ 'position', 'normal', 'across', 'hinge' ], numbers: [ 'width', 'height', 'thickness' ] },
	switches: { vectors: [ 'position', 'normal' ], numbers: [] },
};

/**
 * A world description: everything the simulation needs to know about a world, as plain data. The demo makes one from
 * its courses (its world/fromCourse.js); a game with a world of its own makes one from that (AGENTS.md, Adapting a
 * world). Vectors are { x, y, z } (three.js Vector3s are), in metres, Y up; a yaw of 0 faces +Z.
 *
 * @typedef {Object} WorldDescription
 * @property {string} [name] What loading messages call it.
 * @property {{ position: Vector3, yaw: number }[]} spawns Where runs start: a capsule centre and a heading. The first
 *   is where a fall starts again.
 * @property {import( './solids.js' ).Solid[]} solids Boxes and convex hulls (boxSolid, hullSolid, prismSolid), in an
 *   order that never changes: the engines' answers depend on the order solids are added.
 * @property {{ id: string, bottom: Vector3, top: Vector3, radius: number }[]} [poles] Poles to climb; the solid with
 *   the same id carries the 'pole' tag.
 * @property {{ id: string, start: Vector3, end: Vector3, forward: Vector3, radius: number }[]} [pipes]
 * @property {{ id: string, start: Vector3, end: Vector3, forward: Vector3, radius: number }[]} [ziplines]
 * @property {{ id: string, start: Vector3, end: Vector3, forward: Vector3, width: number }[]} [ladders]
 * @property {{ id: string, anchor: Vector3, end: Vector3, length: number }[]} [ropes]
 * @property {Object[]} [doors] `{ id, position, normal, across, hinge, width, height, thickness }`
 * @property {Object[]} [switches] `{ id, kind: 'valve'|'button', position, normal, radius, size }`
 * @property {number} [floor] Below this height (m) the runner has fallen out; -30 unless given.
 */

/**
 * The simulation's view of a world: where runs start, the solids, the poles, pipes, ladders, ropes and ziplines the
 * runner can take, the catch volumes of the pipes, ziplines and ladders, and the doors and the switches by them. Made
 * from a world description; `build` then hands the solids to a physics engine, once, for the queries a run asks.
 * Nothing here changes during a run: whether a door stands open is the runner's (DoorsAndSwitches).
 */
class World {

	/**
	 * @param {WorldDescription} description
	 */
	constructor( description ) {

		check( description );

		const { name = 'the world', spawns, solids, poles = [], pipes = [], ziplines = [], ladders = [], ropes = [], doors = [], switches = [], floor = FLOOR } = description;

		this.name = name;
		this.spawns = spawns;
		this.solids = solids;
		this.poles = poles;
		this.pipes = pipes;
		this.ziplines = ziplines;
		this.ladders = ladders;
		this.ropes = ropes;
		this.doors = doors;
		this.switches = switches;
		this.floor = floor;
		this.catchVolumes = catchVolumes( pipes, ziplines, ladders );

		/** @type {Queries|null} the runner's, the figure's and the camera's questions about the solids, once built */
		this.queries = null;

		/** @type {import( '../physics/engine.js' ).QueryWorld|null} the catch volumes, a query world of their own */
		this.catchWorld = null;

	}

	/**
	 * Puts the solids and the catch volumes into an engine's query worlds.
	 *
	 * @param {import( '../physics/engine.js' ).PhysicsEngine} engine
	 * @return {World}
	 */
	build( engine ) {

		this.queries = new Queries( engine.createQueryWorld( this.solids ) );
		this.catchWorld = engine.createQueryWorld( this.catchVolumes );

		return this;

	}

	/** Frees the engine's query worlds, once nothing will ask them again. */
	dispose() {

		this.queries?.world.dispose();
		this.catchWorld?.dispose();
		this.queries = null;
		this.catchWorld = null;

	}

	/**
	 * Where a run starts: the world's first spawn, then each one after it, round again past the last.
	 *
	 * @param {number} [index]
	 * @return {{ position: Vector3, yaw: number }}
	 */
	spawn( index = 0 ) {

		const spawn = this.spawns[ index % this.spawns.length ];

		return { position: spawn.position.clone(), yaw: spawn.yaw };

	}

}

// A description that would fail later, deep in an engine or a step, fails here instead, naming what is wrong.
function check( description ) {

	const fail = ( where, what ) => {

		throw new Error( `World: ${ where }: ${ what }` );

	};

	const isVector = ( v ) => v !== null && typeof v === 'object' && [ v.x, v.y, v.z ].every( Number.isFinite );
	const isTriple = ( v ) => Array.isArray( v ) && v.length === 3 && v.every( Number.isFinite );

	if ( description === null || typeof description !== 'object' ) fail( 'the description', 'expected an object' );
	if ( description.prims && ! description.solids ) fail( 'the description', 'this is a course, not a world description: turn it into one first (the demo\'s fromCourse)' );
	if ( ! Array.isArray( description.spawns ) || description.spawns.length === 0 ) fail( 'spawns', 'at least one spawn is needed' );

	description.spawns.forEach( ( spawn, i ) => {

		if ( ! isVector( spawn?.position ) || typeof spawn.position.clone !== 'function' ) fail( `spawns[${ i }]`, 'position must be a Vector3' );
		if ( ! Number.isFinite( spawn.yaw ) ) fail( `spawns[${ i }]`, 'yaw must be a number (radians)' );

	} );

	if ( ! Array.isArray( description.solids ) ) fail( 'solids', 'expected an array of solids (boxSolid, hullSolid, prismSolid)' );

	description.solids.forEach( ( solid, i ) => {

		const where = `solids[${ i }]${ typeof solid?.id === 'string' ? ` (${ solid.id })` : '' }`;

		if ( typeof solid?.id !== 'string' ) fail( where, 'id must be a string' );
		if ( ! Number.isInteger( solid.groups ) ) fail( where, 'groups must be an integer (GROUPS bits)' );
		if ( ! Array.isArray( solid.tags ) ) fail( where, 'tags must be an array' );

		if ( solid.shape?.kind === 'box' ) {

			if ( ! isTriple( solid.shape.halfExtents ) || ! solid.shape.halfExtents.every( ( h ) => h > 0 ) ) fail( where, 'a box needs three positive half extents' );
			if ( ! isTriple( solid.position ) ) fail( where, 'a box needs a position, [ x, y, z ]' );

		} else if ( solid.shape?.kind === 'hull' ) {

			const points = solid.shape.points;
			if ( ! Array.isArray( points ) || points.length % 3 !== 0 || ! points.every( Number.isFinite ) ) fail( where, 'a hull\'s points are flat [ x, y, z, x, y, z, … ]' );
			if ( points.length < 12 ) fail( where, 'a hull needs at least four points' );

		} else {

			fail( where, 'shape must be a box or a hull (make solids with boxSolid, hullSolid or prismSolid)' );

		}

	} );

	for ( const [ kind, { vectors, numbers } ] of Object.entries( FEATURES ) ) {

		const list = description[ kind ];
		if ( list === undefined ) continue;
		if ( ! Array.isArray( list ) ) fail( kind, 'expected an array' );

		list.forEach( ( item, i ) => {

			const where = `${ kind }[${ i }]${ typeof item?.id === 'string' ? ` (${ item.id })` : '' }`;
			for ( const key of vectors ) if ( ! isVector( item?.[ key ] ) ) fail( where, `${ key } must be a Vector3` );
			for ( const key of numbers ) if ( ! Number.isFinite( item[ key ] ) ) fail( where, `${ key } must be a number` );

		} );

	}

	if ( description.floor !== undefined && ! Number.isFinite( description.floor ) ) fail( 'floor', 'must be a number (metres)' );

}

export { World };
