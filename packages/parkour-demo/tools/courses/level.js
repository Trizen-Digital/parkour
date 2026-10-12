// A level being written from its plan, as the demo's levels are laid out (tools/courses/foundry.js, tutorial.js): plan
// places [ x, z ] in metres, heights as the tops of things, and each piece becomes the course prims that build it
// (src/course/prims.js reads them). Blocks stand on the street unless they stand on something; the street under it
// all is out of bounds.
//
// Plan rectangles are [ x0, z0, x1, z1 ]; a yaw is in degrees, 0 facing +z (90 faces +x).

const r3 = ( x ) => Math.round( x * 1000 ) / 1000;
const v3 = ( a ) => a.map( r3 );
const DEG = Math.PI / 180;

// A wedge rises toward +z turned by its yaw: the way a chute runs down, as the yaw that rises against it.
const RISING = { '-x': 90, '+x': 270, '-z': 0, '+z': 180 };

// A ladder or a drainpipe stands this far (m) out from its wall: its middle, METRICS's 0.10-0.25 m off the wall.
const OFF_WALL = 0.15;

// Parapets round the edge of the map: tall and thick (m), out of bounds (no ledge on them, no wall run off them).
const PARAPET_HEIGHT = 1.3;
const PARAPET_THICKNESS = 0.3;

// A slide-under bar: its depth and thickness, and its posts' radius (m), as test_basic's.
const UNDER_BAR = 0.25;
const POST_RADIUS = 0.08;

// A climbable pole's radius (m): thin enough for the world to make it a pole (fromCourse: 0.25 m or less).
const POLE_RADIUS = 0.08;

// A zipline is caught this far over its take-off edge (METRICS: 2.0-2.6 m), and starts this far back over the roof.
const CATCH = 2.3;
const ZIP_BACK = 0.6;

class Level {

	/**
	 * @param {object} options
	 * @param {string} options.name
	 * @param {string} options.about
	 * @param {number} options.street the street's height: blocks stand on it, and it is out of bounds
	 */
	constructor( { name, about, street } ) {

		this.street = street;
		this.def = { name, about, spawn: null, spawns: [], prims: [] };
		// The blocks' tops by place, for the parapets to stand on.
		this.decks = [];

	}

	add( prim ) {

		this.def.prims.push( prim );
		return prim.id;

	}

	/** A block from the street (or `from`) up to its top. */
	block( id, [ x0, z0, x1, z1 ], top, { from = this.street, roles } = {} ) {

		this.decks.push( { r: [ x0, z0, x1, z1 ], top } );
		return this.add( { type: 'box', id, min: v3( [ x0, from, z0 ] ), max: v3( [ x1, top, z1 ] ), roles } );

	}

	/** A walkway on legs at its top: a slab, and a leg at each corner down to `on`. */
	gantry( id, [ x0, z0, x1, z1 ], top, { on = 0, slab = 0.4, leg = 0.4, inset = 0.3 } = {} ) {

		this.decks.push( { r: [ x0, z0, x1, z1 ], top } );
		this.add( { type: 'box', id, min: v3( [ x0, top - slab, z0 ] ), max: v3( [ x1, top, z1 ] ) } );
		const xs = [ x0 + inset, x1 - inset - leg ], zs = [ z0 + inset, z1 - inset - leg ];
		xs.forEach( ( x, i ) => zs.forEach( ( z, j ) => this.add( { type: 'box', id: `${id}_leg${i}${j}`, min: v3( [ x, on, z ] ), max: v3( [ x + leg, top - slab, z + leg ] ) } ) ) );
		return id;

	}

	/** A slope from `lo` up to `hi` across its rectangle, running down toward `dir` ('-x', '+x', '-z', '+z'). */
	chute( id, [ x0, z0, x1, z1 ], { hi, lo, dir } ) {

		const alongX = dir.endsWith( 'x' ), w = alongX ? z1 - z0 : x1 - x0, l = alongX ? x1 - x0 : z1 - z0;
		return this.add( { type: 'wedge', id, p: v3( [ ( x0 + x1 ) / 2, lo, ( z0 + z1 ) / 2 ] ), size: v3( [ w, hi - lo, l ] ), yaw: RISING[ dir ] } );

	}

	/** A bar to slide under, `h` over the floor at `on`, from a to b, on a post at each end. */
	slideUnder( id, [ ax, az ], [ bx, bz ], { on = 0, h = 1 } = {} ) {

		const alongX = Math.abs( bx - ax ) > Math.abs( bz - az ), half = UNDER_BAR / 2;
		for ( const [ end, [ x, z ] ] of [ [ 'l', [ ax, az ] ], [ 'r', [ bx, bz ] ] ] ) this.add( { type: 'cylinder', id: `${id}_post_${end}`, p: v3( [ x, on, z ] ), r: POST_RADIUS, h: r3( h + UNDER_BAR ) } );
		const min = alongX ? [ Math.min( ax, bx ), on + h, az - half ] : [ ax - half, on + h, Math.min( az, bz ) ];
		const max = alongX ? [ Math.max( ax, bx ), on + h + UNDER_BAR, az + half ] : [ ax + half, on + h + UNDER_BAR, Math.max( az, bz ) ];
		return this.add( { type: 'box', id, min: v3( min ), max: v3( max ), look: 'face' } );

	}

	/** A wall (a billboard, a hoarding, a railing) from `from` up to its top. */
	wall( id, [ x0, z0, x1, z1 ], top, { from = this.street, roles } = {} ) {

		return this.add( { type: 'box', id, min: v3( [ x0, from, z0 ] ), max: v3( [ x1, top, z1 ] ), roles } );

	}

	/** A fence or a box to vault, `h` tall on the floor at `on`. */
	fence( id, r, h, { on = 0 } = {} ) {

		return this.wall( id, r, on + h, { from: on } );

	}

	/** A springboard step on the floor at `on`, facing along its yaw. */
	springboard( id, [ x, z ], yaw, { on = 0 } = {} ) {

		return this.add( { type: 'springboard', id, form: 'step', p: v3( [ x, on, z ] ), size: [ 2, 0.6, 0.6 ], yaw } );

	}

	/** A round post (a tank top, a bollard) or a square one, from `from` up to `top`. */
	post( id, [ x, z ], { r, top, from = this.street, square = false } ) {

		if ( square ) return this.add( { type: 'box', id, min: v3( [ x - r, from, z - r ] ), max: v3( [ x + r, top, z + r ] ) } );
		return this.add( { type: 'cylinder', id, p: v3( [ x, from, z ] ), r, h: r3( top - from ) } );

	}

	/** A balance beam whose top runs from a to b at `h`. */
	beam( id, [ ax, az ], [ bx, bz ], h, width ) {

		return this.add( { type: 'beam', id, a: v3( [ ax, h, az ] ), b: v3( [ bx, h, bz ] ), width, thickness: 0.15 } );

	}

	/** A swing bar from a to b at `h`, on posts. */
	bar( id, [ ax, az ], [ bx, bz ], h ) {

		return this.add( { type: 'bar', id, a: v3( [ ax, h, az ] ), b: v3( [ bx, h, bz ] ), posts: true } );

	}

	/** A ladder on a wall at [ x, z ] (the wall's face), facing out along its yaw, from `from` up to `to`. */
	ladder( id, [ x, z ], yaw, from, to ) {

		const [ ox, oz ] = this.offWall( yaw );
		return this.add( { type: 'ladder', id, p: v3( [ x + ox, from, z + oz ] ), h: r3( to - from ), yaw, width: 0.5 } );

	}

	/** A drainpipe on a wall at [ x, z ] (the wall's face), its wall behind it against its yaw, from `from` up to `to`. */
	pipe( id, [ x, z ], yaw, from, to ) {

		const [ ox, oz ] = this.offWall( yaw );
		return this.add( { type: 'pipe', id, a: v3( [ x + ox, from, z + oz ] ), b: v3( [ x + ox, to, z + oz ] ), r: 0.06, n: v3( [ Math.sin( yaw * DEG ), 0, Math.cos( yaw * DEG ) ] ) } );

	}

	offWall( yaw ) {

		return [ Math.sin( yaw * DEG ) * OFF_WALL, Math.cos( yaw * DEG ) * OFF_WALL ];

	}

	/** A pole to catch and slide down, from `from` up to `to`. */
	pole( id, [ x, z ], from, to ) {

		return this.add( { type: 'cylinder', id, p: v3( [ x, from, z ] ), r: POLE_RADIUS, h: r3( to - from ) } );

	}

	/** A door at [ x, z ] on the floor at `on`, facing along its yaw; `wall` builds the wall round it. */
	door( id, [ x, z ], yaw, { on = 0, height = 2.2, wall } = {} ) {

		return this.add( { type: 'door', id, p: v3( [ x, on, z ] ), yaw, width: 1, height, wall } );

	}

	/** A valve wheel or a button on a wall at [ x, y, z ], facing out along its yaw. */
	valve( id, p, yaw ) {

		return this.add( { type: 'valve', id, p: v3( p ), yaw, r: 0.2 } );

	}

	button( id, p, yaw ) {

		return this.add( { type: 'button', id, p: v3( p ), yaw } );

	}

	/**
	 * A zipline caught `CATCH` over its take-off edge ([ x, z ] on the edge of a roof `top` high), down to its low end
	 * [ x, z, height ], with a gantry at each end. It starts `ZIP_BACK` before the edge, over the roof, where its high
	 * gantry stands.
	 */
	zip( id, [ ex, ez ], top, [ lx, lz, lh ] ) {

		const run = Math.hypot( lx - ex, lz - ez ), slope = ( top + CATCH - lh ) / run, ux = ( lx - ex ) / run, uz = ( lz - ez ) / run;
		const a = [ ex - ux * ZIP_BACK, top + CATCH + slope * ZIP_BACK, ez - uz * ZIP_BACK ];
		return this.add( { type: 'cable', id, a: v3( a ), b: v3( [ lx, lh, lz ] ), anchors: true } );

	}

	/** The course's spawn, on the floor at `on`. */
	spawn( [ x, z ], yaw, on = 0 ) {

		this.def.spawn = { p: v3( [ x, on, z ] ), yaw };

	}

	/** A named spawn (a checkpoint), on the floor at `on`. */
	flag( id, [ x, z ], yaw, on = 0 ) {

		this.def.spawns.push( { id, p: v3( [ x, on, z ] ), yaw } );

	}

	/**
	 * Parapets along lines round the map's edge ([ x0, z0, x1, z1 ], along x or along z), on whatever deck is under
	 * each stretch (none over a void), just inside `bounds`. At a corner the line along x takes the corner, so no two
	 * overlap (overlapping faces in one plane flicker).
	 */
	parapets( lines, [ bx0, bz0, bx1, bz1 ] ) {

		lines.forEach( ( [ x0, z0, x1, z1 ], i ) => {

			const alongX = z0 === z1, fixed = alongX ? z0 : x0;
			const inward = alongX ? ( fixed >= ( bz0 + bz1 ) / 2 ? - 1 : 1 ) : ( fixed >= ( bx0 + bx1 ) / 2 ? - 1 : 1 );
			const inner = fixed + inward * PARAPET_THICKNESS, probe = fixed + inward * PARAPET_THICKNESS / 2;
			let [ s0, s1 ] = alongX ? [ Math.min( x0, x1 ), Math.max( x0, x1 ) ] : [ Math.min( z0, z1 ), Math.max( z0, z1 ) ];
			if ( ! alongX && ( fixed === bx0 || fixed === bx1 ) ) {

				if ( s0 === bz0 ) s0 += PARAPET_THICKNESS;
				if ( s1 === bz1 ) s1 -= PARAPET_THICKNESS;

			}

			// The line cut where the decks under it change.
			const cuts = new Set( [ s0, s1 ] );
			for ( const { r } of this.decks ) for ( const s of alongX ? [ r[ 0 ], r[ 2 ] ] : [ r[ 1 ], r[ 3 ] ] ) if ( s > s0 && s < s1 ) cuts.add( s );
			const stops = [ ...cuts ].sort( ( a, b ) => a - b );

			for ( let k = 0; k + 1 < stops.length; k ++ ) {

				const mid = ( stops[ k ] + stops[ k + 1 ] ) / 2, [ px, pz ] = alongX ? [ mid, probe ] : [ probe, mid ];
				const under = this.decks.filter( ( { r } ) => px > r[ 0 ] && px < r[ 2 ] && pz > r[ 1 ] && pz < r[ 3 ] );
				if ( ! under.length ) continue;
				const base = Math.max( ...under.map( ( d ) => d.top ) );
				const [ a, b ] = [ stops[ k ], stops[ k + 1 ] ];
				const rect = alongX ? [ a, Math.min( fixed, inner ), b, Math.max( fixed, inner ) ] : [ Math.min( fixed, inner ), a, Math.max( fixed, inner ), b ];
				this.wall( `parapet${i}_${k}`, rect, base + PARAPET_HEIGHT, { from: base, roles: [ 'out' ] } );

			}

		} );

	}

	/**
	 * A stretch of the level's route, which the course validator checks and npm run reach drives: a node where it
	 * starts ([ x, floor, z ]), then a node per step `{ move, to, kind, ref, refs, params }`, each linked from the one
	 * before. Refs name an affordance: `{ prim, kind }`, and `near` a point for an edge or a wall.
	 */
	route( name, start, steps ) {

		const R = this.def.route ??= { nodes: [], links: [] };
		let from = `${name}.0`;
		R.nodes.push( { id: from, p: v3( start ), kind: 'stand' } );
		steps.forEach( ( s, k ) => {

			const id = `${name}.${k + 1}`;
			R.nodes.push( { id, p: v3( s.to ), kind: s.kind ?? 'stand', ref: s.ref } );
			R.links.push( { from, to: id, move: s.move, params: s.params ?? {}, refs: s.refs } );
			from = id;

		} );

	}

	/** The street under everything, out of bounds, and a kill volume just above it; returns the course definition. */
	done() {

		const s = this.street;
		this.add( { type: 'box', id: 'street', min: [ - 300, s - 1, - 300 ], max: [ 300, s, 300 ], roles: [ 'out' ] } );
		this.add( { type: 'volume', id: 'fall', kind: 'kill', min: [ - 300, s - 0.5, - 300 ], max: [ 300, s + 0.5, 300 ] } );
		if ( ! this.def.spawns.length ) delete this.def.spawns;
		// The route last, after the prims it names.
		const { route, ...rest } = this.def;
		return route ? { ...rest, route } : rest;

	}

}

export { Level };
