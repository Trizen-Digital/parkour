/**
 * A course: the authored definition read into prims and affordances, the questions the course tools ask of its
 * geometry, its route, and the scene group that draws it.
 *
 * - A **prim** is one solid (a shape from `shapes.js` with roles such as `noRun`, `noClimb`, `out`, `decor`) or a
 *   placeholder for something with no solid of its own (an anchor, a volume, the door around its leaf).
 * - An **affordance** is something the runner can use, kept in one of six collections: `edges` (to hang from, climb
 *   onto or vault), `walls` (to run on or climb), `lines` (bars, pipes, cables, beams, ropes, ladders), `objects`
 *   (anchors, valves, buttons, springboards, doors), `slopes` and `volumes`. Lines, objects and volumes are authored
 *   (`prims.js`); edges, walls and slopes are found on the solids (`derive.js`).
 * - The **route** is a graph of where to stand and which move takes the runner on (`Route.js`): authored in the course
 *   file, or worked out from the geometry when it has none (`deriveRoute.js`).
 *
 * The simulation never reads a course directly: `world/fromCourse.js` turns its solids into the physics world. The
 * course's own queries (ground, ceiling, rays) serve the deriving, the validator, the generator and the editor tools.
 */
import * as THREE from 'three/webgpu';
import { DEG } from '@trizen/parkour/math.js';
import { metrics as METRICS } from './metrics.js';
import { derive } from './derive.js';
import { deriveRoute } from './deriveRoute.js';
import { getLook } from './look.js';
import { buildMeshes } from './mesh.js';
import { buildOverlay } from './overlay.js';
import { readPrim } from './prims.js';
import { Route } from './Route.js';
import { SpatialGrid } from './SpatialGrid.js';
import { Vision } from './Vision.js';

export class Course {

	/**
	 * Reads a course definition: its prims, then the affordances derived from them, then its meshes.
	 * @param {Object} def The course file's contents (`name`, `spawn`, `prims`, `lanes`, `route`, …).
	 * @param {Object} [options]
	 * @param {Object} [options.metrics] The level metrics the course is derived and checked against.
	 */
	constructor( def, { metrics = METRICS } = {} ) {

		this.def = def;
		this.name = def.name ?? 'course';
		this.metrics = metrics;
		this.walkableCos = Math.cos( metrics.slope.walk * DEG );
		this.group = new THREE.Group();
		this.group.name = `course ${this.name}`;

		this.prims = [];
		this.edges = [];
		this.walls = [];
		this.lines = [];
		this.objects = [];
		this.slopes = [];
		this.volumes = [];
		// Every affordance by its index. Index 0 stays empty: the look reads tint 0 as "nothing to tint".
		this.byIndex = [ null ];
		this.byId = new Map();

		const spawn = def.spawn ?? {};
		this.spawn = { position: new THREE.Vector3().fromArray( spawn.p ?? [ 0, 0, 0 ] ), yaw: ( spawn.yaw ?? 0 ) * DEG };
		this.bounds = new THREE.Box3();

		// Solids in 2 m cells; affordances, which a query looks for further afield, in 4 m ones.
		this.grid = new SpatialGrid( 2 );
		this.affordanceGrid = new SpatialGrid( 4 );

		// Query results are shared objects, valid until the next call of the same query: the deriving and the
		// validator ask hundreds of thousands of them.
		this.found = [];
		this.foundAffordances = [];
		this.ground = { y: 0, normal: new THREE.Vector3(), prim: null, walkable: true };
		this.hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), prim: null };
		this.tops = { lo: 0, hi: 0, normal: new THREE.Vector3() };
		this.rayNormal = new THREE.Vector3();
		this.rayDirection = new THREE.Vector3();

		// Posts, gantries and a pipe's wall look at the solids, so they are fitted once those are indexed, in the order
		// the prims came: what one fitting adds is there for the next (a gantry's post can be the wall a pipe finds).
		const fittings = [];
		for ( const d of def.prims ?? [] ) readPrim( this, d, fittings );
		for ( const prim of this.prims ) this.index( prim );
		for ( const fit of fittings ) fit();
		derive( this );
		for ( const a of this.byIndex ) if ( a ) this.affordanceGrid.add( a, a.min, a.max );

		this.look = getLook();
		this.look.assign( this );
		buildMeshes( this );
		this.overlay = null;
		this.routeCache = null;
		this.visionState = null;

	}

	/**
	 * Adds a prim. Collidable unless it has no shape or says `collide: false`; the roles `out` and `decor` keep a prim
	 * out of the deriving (nothing on the street below or on a post is for the runner).
	 * @param {string} type
	 * @param {Object} def The authored prim (its `id`, `roles`, `look`, `lookTop` and `collide` are honoured).
	 * @param {Shape|null} shape
	 * @param {Object} [options] `id`, `parent`, `derive` (find edges and walls on its sides), `roles`, `look`, `lookTop`,
	 * `collide`.
	 * @return {Object} The prim.
	 */
	addPrim( type, def, shape, { id, parent = null, derive = false, roles = [], look = null, lookTop = null, collide = true } = {} ) {

		const prim = {
			id: id ?? def.id ?? `${type}${this.prims.length}`,
			index: this.prims.length,
			type,
			def,
			roles: new Set( [ ...( def.roles ?? [] ), ...roles ] ),
			shape,
			look: def.look ?? look,
			lookTop: def.lookTop ?? lookTop,
			parent,
			derive,
			affordances: [],
			faces: [],
			_stamp: 0,
		};
		prim.collide = !! shape && ( def.collide ?? collide );
		if ( prim.roles.has( 'out' ) || prim.roles.has( 'decor' ) ) prim.derive = false;
		this.prims.push( prim );
		return prim;

	}

	/** Puts a prim's shape in the course's bounds and, when it collides, where the queries find it. */
	index( prim ) {

		if ( ! prim.shape ) return;
		this.bounds.expandByPoint( prim.shape.min ).expandByPoint( prim.shape.max );
		if ( prim.collide ) this.grid.add( prim, prim.shape.min, prim.shape.max );

	}

	/**
	 * Adds an affordance to a collection. Its id defaults to `<prim>:<kind><n>` (`roof3:edge0`), its tint (the slot the
	 * look highlights it by) to its index.
	 * @param {string} collection `edges`, `walls`, `lines`, `objects`, `slopes` or `volumes`.
	 * @param {Object} record The affordance: at least its `kind` and `prim`.
	 * @return {Object} The record, with `index`, `collection`, `id`, `tint`, `usable` and its bounds (`min`, `max`).
	 */
	addAffordance( collection, record ) {

		record.index = this.byIndex.length;
		record.collection = collection;
		const prim = record.prim, n = prim ? prim.affordances.filter( ( a ) => a.collection === collection ).length : this[ collection ].length;
		record.id ??= `${prim?.id ?? collection}:${collection.replace( /s$/, '' )}${n}`;
		record.tint ??= record.index;
		record.usable ??= true;
		this.byIndex.push( record );
		this.byId.set( record.id, record );
		this[ collection ].push( record );
		prim?.affordances.push( record );
		setBounds( record );
		return record;

	}

	/** Every affordance, in the order it was added. */
	get affordances() {

		return this.byIndex.slice( 1 );

	}

	/**
	 * @param {string|number} id An affordance's id or index.
	 * @return {Object|null}
	 */
	affordance( id ) {

		return typeof id === 'number' ? this.byIndex[ id ] ?? null : this.byId.get( id ) ?? null;

	}

	/**
	 * The affordances within a distance of a point.
	 * @param {Array<string>|string|null} kinds Collections or kinds to keep (`[ 'edges' ]`, `'bar'`); null for all.
	 * @param {THREE.Vector3} centre
	 * @param {number} radius
	 * @param {Array} [out]
	 * @return {Array}
	 */
	affordancesNear( kinds, centre, radius, out = [] ) {

		out.length = 0;
		const wanted = typeof kinds === 'string' ? [ kinds ] : kinds;
		const found = this.affordanceGrid.gather( centre.x - radius, centre.z - radius, centre.x + radius, centre.z + radius, this.foundAffordances );
		for ( let i = 0; i < found.length; i ++ ) {

			const a = found[ i ];
			if ( wanted && ! wanted.includes( a.collection ) && ! wanted.includes( a.kind ) ) continue;
			if ( distanceTo( a, centre ) <= radius ) out.push( a );

		}

		return out;

	}

	/** The collidable prims near a rectangle on the ground plane. Shared; valid until the next call. */
	primsNear( x0, z0, x1, z1 ) {

		return this.grid.gather( x0, z0, x1, z1, this.found );

	}

	/**
	 * The highest top at or below `yTop` under a point, or under a disc of radius `r` (its highest point).
	 * @param {number} x
	 * @param {number} z
	 * @param {number} yTop Tops above this are ignored; a sloped top that crosses it counts at `yTop`.
	 * @param {number} [yBottom] Tops below this are ignored.
	 * @param {number} [r]
	 * @return {{ y: number, normal: THREE.Vector3, prim: Object, walkable: boolean }|null} Shared; valid until the next
	 *   call.
	 */
	groundAt( x, z, yTop, yBottom = - Infinity, r = 0 ) {

		const found = this.primsNear( x - r, z - r, x + r, z + r ), tops = this.tops, ground = this.ground;
		let best = - Infinity, bestPrim = null;
		for ( let i = 0; i < found.length; i ++ ) {

			const prim = found[ i ], s = prim.shape;
			if ( ! prim.collide || s.min.y > yTop || s.max.y < yBottom || s.max.y <= best ) continue;
			if ( ! s.tops( x, z, r, tops ) ) continue;
			const y = tops.hi <= yTop ? tops.hi : tops.lo <= yTop ? yTop : NaN;
			if ( ! ( y >= yBottom ) || y <= best ) continue;
			best = y;
			bestPrim = prim;
			ground.normal.copy( tops.normal );

		}

		if ( ! bestPrim ) return null;
		ground.y = best;
		ground.prim = bestPrim;
		ground.walkable = ground.normal.y >= this.walkableCos;
		return ground;

	}

	/**
	 * The lowest underside at or above `yFrom` over a point (or a disc of radius `r`): Infinity under open sky.
	 * @return {number}
	 */
	ceilingAt( x, z, yFrom, r = 0 ) {

		const found = this.primsNear( x - r, z - r, x + r, z + r );
		let best = Infinity;
		for ( let i = 0; i < found.length; i ++ ) {

			const prim = found[ i ], s = prim.shape;
			if ( ! prim.collide || s.max.y <= yFrom || s.min.y >= best ) continue;
			const b = s.bottom( x, z, r );
			if ( b >= yFrom - 1e-6 && b < best ) best = b;

		}

		return best;

	}

	/** The first collidable prim with the point inside it, or null. */
	solidAt( x, y, z ) {

		const found = this.primsNear( x, z, x, z );
		for ( let i = 0; i < found.length; i ++ ) {

			const prim = found[ i ], s = prim.shape;
			if ( ! prim.collide || y < s.min.y || y > s.max.y || x < s.min.x || x > s.max.x || z < s.min.z || z > s.max.z ) continue;
			if ( s.sdf( x, y, z ) < 0 ) return prim;

		}

		return null;

	}

	/** The distance from a point to the nearest solid, up to `radius` (m). */
	distanceAt( x, y, z, radius = 2 ) {

		const found = this.primsNear( x - radius, z - radius, x + radius, z + radius );
		let best = radius;
		for ( let i = 0; i < found.length; i ++ ) if ( found[ i ].collide ) best = Math.min( best, found[ i ].shape.sdf( x, y, z ) );
		return best;

	}

	/**
	 * The nearest solid along a ray. It walks the grid cell by cell from the origin and stops once the next cell is
	 * further than the best hit.
	 * @param {THREE.Vector3} origin
	 * @param {THREE.Vector3} direction Need not be normalised.
	 * @param {number} [far]
	 * @return {{ distance: number, point: THREE.Vector3, normal: THREE.Vector3, prim: Object }|null} Shared; valid until
	 * the next call.
	 */
	raycast( origin, direction, far = Infinity ) {

		const d = this.rayDirection.copy( direction ).normalize(), hit = this.hit;
		this.rayBest = far;
		this.rayPrim = null;
		const grid = this.grid, c = grid.cell, stamp = ++ grid.stamp;
		for ( const prim of grid.big ) {

			prim._stamp = stamp;
			this.rayTest( prim, origin, d );

		}

		let ix = Math.floor( origin.x / c ), iz = Math.floor( origin.z / c );
		const sx = d.x > 0 ? 1 : - 1, sz = d.z > 0 ? 1 : - 1;
		const dtx = Math.abs( d.x ) > 1e-12 ? c / Math.abs( d.x ) : Infinity, dtz = Math.abs( d.z ) > 1e-12 ? c / Math.abs( d.z ) : Infinity;
		let tx = Math.abs( d.x ) > 1e-12 ? ( ( ix + ( d.x > 0 ? 1 : 0 ) ) * c - origin.x ) / d.x : Infinity;
		let tz = Math.abs( d.z ) > 1e-12 ? ( ( iz + ( d.z > 0 ? 1 : 0 ) ) * c - origin.z ) / d.z : Infinity;
		for ( let k = 0; k < 100000; k ++ ) {

			const list = grid.cellAt( ix, iz );
			if ( list ) for ( let i = 0; i < list.length; i ++ ) {

				const prim = list[ i ];
				if ( prim._stamp === stamp ) continue;
				prim._stamp = stamp;
				this.rayTest( prim, origin, d );

			}

			const next = Math.min( tx, tz );
			if ( next >= this.rayBest || next === Infinity ) break;
			if ( tx < tz ) {

				ix += sx;
				tx += dtx;

			} else {

				iz += sz;
				tz += dtz;

			}

		}

		if ( ! this.rayPrim ) return null;
		hit.distance = this.rayBest;
		hit.point.copy( origin ).addScaledVector( d, this.rayBest );
		hit.prim = this.rayPrim;
		return hit;

	}

	rayTest( prim, origin, d ) {

		if ( ! prim.collide ) return;
		const t = prim.shape.ray( origin, d, this.rayBest, this.rayNormal );
		if ( t < this.rayBest ) {

			this.rayBest = t;
			this.rayPrim = prim;
			this.hit.normal.copy( this.rayNormal );

		}

	}

	/** The course's route: the authored one, or one worked out from the geometry, made on first use. */
	get route() {

		if ( ! this.routeCache ) this.routeCache = this.def.route ? new Route( this, this.def.route ) : new Route( this, deriveRoute( this ), { derived: true } );
		return this.routeCache;

	}

	/**
	 * Runner Vision for a runner at `position` moving at `velocity`: tints the next moves (Classic) or lays the trail
	 * along the route ahead (Full), as the view asks.
	 * @return {Object|null} The next target on the route (see `Route.nextTarget`).
	 */
	vision( position, velocity, dt ) {

		this.visionState ??= new Vision( this );
		return this.visionState.update( position, velocity, dt );

	}

	/**
	 * Switches the look between the graybox and Runner Vision (`graybox`, `off`, `classic`, `full`; look.js).
	 * @param {string} mode
	 */
	setView( mode ) {

		this.look.setView( mode );
		if ( mode !== 'classic' && mode !== 'full' ) this.visionState?.clear();

	}

	/** Shows or hides the lines that mark the affordances and the volumes. */
	showOverlay( { affordances = true, volumes = false } = {} ) {

		if ( ! this.overlay && ( affordances || volumes ) ) {

			this.overlay = buildOverlay( this );
			this.group.add( this.overlay );

		}

		if ( this.overlay ) {

			this.overlay.getObjectByName( 'affordances' ).visible = affordances;
			this.overlay.getObjectByName( 'volumes' ).visible = volumes;

		}

	}

	/** Takes the course out of the scene and frees its geometry; the shared look stays. */
	dispose() {

		this.visionState?.clear();
		this.visionState?.dispose();
		this.group.removeFromParent();
		this.group.traverse( ( o ) => {

			if ( o.geometry ) o.geometry.dispose();
			if ( o.material && o.material !== this.look.material && o.material !== this.look.stripe && ! o.material.shared ) o.material.dispose?.();

		} );

	}

}

// The box an affordance occupies, for the affordance grid: a line widened by its radius (and a ladder by its width),
// an object by the 0.6 m the runner uses it from.
function setBounds( a ) {

	const min = a.min = new THREE.Vector3( Infinity, Infinity, Infinity ), max = a.max = new THREE.Vector3( - Infinity, - Infinity, - Infinity );
	const add = ( p, r = 0 ) => {

		min.x = Math.min( min.x, p.x - r ); min.y = Math.min( min.y, p.y - r ); min.z = Math.min( min.z, p.z - r );
		max.x = Math.max( max.x, p.x + r ); max.y = Math.max( max.y, p.y + r ); max.z = Math.max( max.z, p.z + r );

	};

	switch ( a.collection ) {

		case 'edges': add( a.a ); add( a.b ); break;
		case 'lines': add( a.a, a.r + ( a.ladder ? a.ladder.width / 2 : 0 ) ); add( a.b, a.r + ( a.ladder ? a.ladder.width / 2 : 0 ) ); break;
		case 'walls': add( a.origin ); add( a.origin.clone().addScaledVector( a.u, a.width ).setY( a.top ) ); break;
		case 'objects': add( a.p, 0.6 ); break;
		case 'slopes': for ( const c of a.corners ) add( c ); break;
		case 'volumes': add( a.box.min ); add( a.box.max ); break;

	}

}

const _a = new THREE.Vector3();

// The distance from a point to an affordance: to its segment (edges, lines), its face (walls), its point (objects) or
// its bounds (the rest).
function distanceTo( a, p ) {

	switch ( a.collection ) {

		case 'edges':
		case 'lines': {

			_a.subVectors( a.b, a.a );
			const l2 = _a.lengthSq(), t = l2 > 1e-12 ? Math.max( 0, Math.min( 1, ( ( p.x - a.a.x ) * _a.x + ( p.y - a.a.y ) * _a.y + ( p.z - a.a.z ) * _a.z ) / l2 ) ) : 0;
			return Math.hypot( a.a.x + _a.x * t - p.x, a.a.y + _a.y * t - p.y, a.a.z + _a.z * t - p.z );

		}

		case 'walls': {

			const dx = p.x - a.origin.x, dz = p.z - a.origin.z;
			const s = Math.max( 0, Math.min( a.width, dx * a.u.x + dz * a.u.z ) ), y = Math.max( a.base, Math.min( a.top, p.y ) );
			return Math.hypot( a.origin.x + a.u.x * s - p.x, y - p.y, a.origin.z + a.u.z * s - p.z );

		}

		case 'objects': return a.p.distanceTo( p );
		default: {

			const dx = Math.max( a.min.x - p.x, 0, p.x - a.max.x ), dy = Math.max( a.min.y - p.y, 0, p.y - a.max.y ), dz = Math.max( a.min.z - p.z, 0, p.z - a.max.z );
			return Math.hypot( dx, dy, dz );

		}

	}

}
