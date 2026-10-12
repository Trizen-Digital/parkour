/**
 * Working out a route for a course that has none authored: where the runner can stand, and the moves that link those
 * places. The validator then checks each link against the metrics, and Runner Vision follows the route.
 *
 * 1. **Walkable regions**: points on a 0.5 m grid over every walkable top where the runner fits upright, joined into
 *    regions wherever two neighbours are no more than a step apart.
 * 2. **Stations and moves**, from what the deriving found: a jump (or else a drop) off each edge, a vault or a
 *    wallclimb at each wall, a slide under (or a crouch through) each low solid, a wallrun along chained walls, a climb
 *    up each pipe and ladder, a swing on each bar, a ride down each zipline, a walk along each beam, a door, a
 *    springboard, a slide down each slide slope.
 * 3. **Runs**: within a region, each station is joined to its nearest neighbour in each of eight directions when the
 *    straight line between them stays on the ground.
 *
 * Every move is planned at the speed a run-up there allows (`reach.js`), so a derived route asks only what the course
 * gives room for.
 */
import * as THREE from 'three/webgpu';
import { metrics as M } from './metrics.js';
import { gapReach, landingKind, obstacleClass, speedAfterRun, vaultLanding } from './reach.js';

// The walkable grid's spacing (m).
const CELL = 0.5;
const STEP = M.runner.step;
// Runs from a station go to its nearest neighbour in each of this many directions.
const DIRECTIONS = 8;

// Walkable ground as cells joined into regions: two places in one region are walked between without a move.
class WalkableRegions {

	constructor( course ) {

		this.course = course;
		this.cells = new Map();
		this.parent = [];
		this.list = [];

	}

	key( ix, iz ) {

		return ( ix + 32768 ) * 65536 + ( iz + 32768 );

	}

	// Whether the runner stands upright at a point: nothing at the knees, the chest or the head, and a ceiling no lower
	// than the runner over a disc round it.
	fits( x, y, z ) {

		const c = this.course;
		return ! c.solidAt( x, y + 0.3, z ) && ! c.solidAt( x, y + 1.0, z ) && ! c.solidAt( x, y + 1.6, z ) &&
			c.ceilingAt( x, z, y + 0.05, 0.25 ) - y >= M.runner.height;

	}

	build() {

		const c = this.course;
		for ( const prim of c.prims ) {

			// A door leaf's 5 cm top is no floor.
			if ( ! prim.collide || ! prim.shape || prim.roles.has( 'out' ) || prim.type === 'leaf' ) continue;
			const s = prim.shape, slope = prim.slope;
			if ( slope && slope.kind !== 'walk' ) continue;
			if ( ! slope && ! s.flat ) continue;
			const top = s.max.y;
			for ( let x = Math.ceil( s.min.x / CELL ) * CELL; x <= s.max.x; x += CELL ) {

				for ( let z = Math.ceil( s.min.z / CELL ) * CELL; z <= s.max.z; z += CELL ) {

					const g = c.groundAt( x, z, top + 0.02, s.min.y - 0.01 );
					if ( ! g || g.prim !== prim || ! g.walkable || ! this.fits( x, g.y, z ) ) continue;
					this.add( x, g.y, z );

				}

			}

		}

		// Neighbours (across and diagonally) join when they are a step apart and the runner fits between them.
		for ( const cell of this.list ) {

			for ( const [ dx, dz ] of [ [ 1, 0 ], [ 0, 1 ], [ 1, 1 ], [ 1, - 1 ] ] ) {

				const near = this.cells.get( this.key( cell.ix + dx, cell.iz + dz ) );
				if ( ! near ) continue;
				for ( const o of near ) {

					if ( Math.abs( o.y - cell.y ) > STEP ) continue;
					const mx = ( cell.x + o.x ) / 2, mz = ( cell.z + o.z ) / 2, my = Math.max( cell.y, o.y );
					const g = c.groundAt( mx, mz, my + STEP, Math.min( cell.y, o.y ) - STEP );
					if ( ! g || ! this.fits( mx, g.y, mz ) ) continue;
					this.union( cell.i, o.i );

				}

			}

		}

		for ( const cell of this.list ) cell.region = this.find( cell.i );
		return this;

	}

	// A cell; one grid point can hold several at different heights (a deck over a street), not two at one height.
	add( x, y, z ) {

		const ix = Math.round( x / CELL ), iz = Math.round( z / CELL ), k = this.key( ix, iz );
		let at = this.cells.get( k );
		if ( ! at ) this.cells.set( k, at = [] );
		if ( at.some( ( o ) => Math.abs( o.y - y ) < 0.05 ) ) return;
		const cell = { x, y, z, ix, iz, i: this.list.length, region: - 1 };
		at.push( cell );
		this.list.push( cell );
		this.parent.push( cell.i );

	}

	find( i ) {

		while ( this.parent[ i ] !== i ) i = this.parent[ i ] = this.parent[ this.parent[ i ] ];
		return i;

	}

	union( a, b ) {

		const ra = this.find( a ), rb = this.find( b );
		if ( ra !== rb ) this.parent[ ra ] = rb;

	}

	// The region of the nearest cell within a cell's reach of a point and `dy` of its height, or -1.
	at( p, dy = 0.6 ) {

		let best = - 1, bd = Infinity;
		const ix = Math.round( p.x / CELL ), iz = Math.round( p.z / CELL );
		for ( let a = - 1; a <= 1; a ++ ) {

			for ( let b = - 1; b <= 1; b ++ ) {

				for ( const cell of this.cells.get( this.key( ix + a, iz + b ) ) ?? [] ) {

					const d = Math.hypot( cell.x - p.x, cell.z - p.z ) + Math.abs( cell.y - p.y );
					if ( Math.abs( cell.y - p.y ) <= dy && d < bd ) {

						bd = d;
						best = cell.region;

					}

				}

			}

		}

		return best;

	}

}

/**
 * A route for a course, from its geometry.
 * @param {Course} course
 * @return {{ nodes: Array, links: Array }} In the form a course file's `route` takes (nodes' `ref` and links' `refs`
 * are the affordances themselves).
 */
export function deriveRoute( course ) {

	const c = course, regions = new WalkableRegions( c ).build();
	const nodes = [], links = [];

	// A station; plain standing places within 0.6 m of one in the same region are that one.
	const station = ( p, kind = 'stand', affordance = null, region = regions.at( p ) ) => {

		if ( region >= 0 && kind === 'stand' && ! affordance ) {

			const same = nodes.find( ( n ) => n.region === region && n.kind === 'stand' && ! n.ref && n.p.distanceTo( p ) < 0.6 );
			if ( same ) return same;

		}

		const n = { id: `n${nodes.length}`, p: p.clone(), kind, region };
		if ( affordance ) n.ref = affordance;
		nodes.push( n );
		return n;

	};

	const link = ( from, to, move, params = {}, refs = [] ) => {

		if ( ! from || ! to || from === to ) return null;
		const l = { from: from.id, to: to.id, move, params, refs };
		links.push( l );
		return l;

	};

	const ground = ( p, top, bottom = - Infinity ) => c.groundAt( p.x, p.z, top, bottom )?.y ?? null;
	const onRegion = ( p ) => regions.at( p ) >= 0 && regions.fits( p.x, p.y, p.z );
	const V = ( x, y, z ) => new THREE.Vector3( x, y, z );

	station( c.spawn.position, 'start' );
	for ( const v of c.volumes ) {

		if ( v.kind !== 'trigger' || ! /finish/i.test( v.name ?? '' ) ) continue;
		const p = v.box.getCenter( V() );
		p.y = v.box.min.y;
		station( p, 'finish', v );

	}

	// Off each edge: a running jump to whatever is across (one per 4 m of edge), at the speed the run-up behind it
	// builds; when nothing is in reach, a drop to the ground below, if it lands safely with room to run on.
	for ( const e of c.edges ) {

		if ( e.drop <= STEP + 0.05 || e.length < 0.4 ) continue;
		const pieces = Math.max( 1, Math.round( e.length / 4 ) );
		let jumped = false;
		for ( let k = 0; k < pieces; k ++ ) {

			const q = e.a.clone().lerp( e.b, ( k + 0.5 ) / pieces );
			const back = q.clone().addScaledVector( e.n, - Math.min( 0.6, e.depth / 2 ) );
			if ( regions.at( back, 0.1 ) < 0 ) continue;
			const behind = runwayBehind( c, q, e.n, e.y );
			const v = behind < M.jump.runUp.length ? 0 : speedAfterRun( M.speed.sprint, behind - M.jump.runUp.length );
			const across = landingAcross( c, q, e.n, e.y, regions );
			if ( ! across ) continue;
			const reach = gapReach( v, across.rise );
			if ( ! reach || across.gap > reach.clearlyOut ) continue;
			const to = across.at.clone().addScaledVector( e.n, 1.0 );
			if ( ! regions.fits( to.x, to.y, to.z ) ) continue;
			const take = station( back, 'takeoff', e );
			const land = station( to, 'land', across.edge );
			link( take, land, 'jump', { gap: round( across.gap ), rise: round( across.rise ), speed: round( v ) }, [ across.edge ].filter( Boolean ) );
			jumped = true;

		}

		if ( jumped ) continue;
		const q = e.a.clone().lerp( e.b, 0.5 ), back = q.clone().addScaledVector( e.n, - Math.min( 0.6, e.depth / 2 ) );
		if ( regions.at( back, 0.1 ) < 0 ) continue;
		const out = q.clone().addScaledVector( e.n, 0.8 );
		const g = ground( out, e.y - STEP );
		if ( g === null ) continue;
		const fall = e.y - g;
		if ( landingKind( fall ) === 'fatal' || ! onRegion( V( out.x, g, out.z ) ) ) continue;
		if ( runwayBehind( c, V( out.x, g, out.z ), e.n.clone().negate(), g, M.jump.landing.min + 0.5 ) < M.jump.landing.min ) continue;
		const to = V( out.x, g, out.z ).addScaledVector( e.n, 0.7 );
		if ( ! regions.fits( to.x, g, to.z ) || ! regions.fits( out.x, g, out.z ) ) continue;
		link( station( back, 'takeoff', e ), station( to, 'land' ), 'drop', { fall: round( fall ), gap: 0 } );

	}

	// At each wall with an edge on top and a run-up in front: what the obstacle classes say a runner does at speed.
	for ( const w of c.walls ) {

		const mid = w.origin.clone().addScaledVector( w.u, w.width / 2 );
		const front = mid.clone().addScaledVector( w.n, 1.4 ).setY( w.base );
		if ( w.hanging ) continue;
		const topEdge = c.affordancesNear( [ 'edges' ], V( mid.x, w.top, mid.z ), 0.3 ).find( ( e ) => e.n.dot( w.n ) > 0.9 && Math.abs( e.y - w.top ) < 0.05 );
		if ( ! onRegion( front ) || w.width < 0.8 || ! topEdge ) continue;
		const cls = obstacleClass( w.height, topEdge.depth, M.obstacle.run + 0.5 );
		if ( ! cls.move || cls.move === 'step' || cls.move === 'stepUp' ) continue;
		if ( runwayBehind( c, mid.clone().setY( w.base ), w.n.clone().negate(), w.base, M.jump.runUp.length + 0.5 ) < M.jump.runUp.length ) continue;
		const a = station( front, 'stand' );
		const top = mid.clone().addScaledVector( w.n, - Math.min( 0.8, topEdge.depth / 2 ) ).setY( w.top );
		const params = { height: round( w.height ), depth: round( topEdge.depth ), move: cls.move };
		if ( /Over/.test( cls.move ) && /vault/i.test( cls.move ) ) {

			const behind = mid.clone().addScaledVector( w.n, - topEdge.depth - 1.4 );
			const g = ground( behind, w.base + 0.5, w.base - 3 );
			if ( g === null || ! onRegion( behind.setY( g ) ) ) continue;
			const clear = runwayBehind( c, behind.clone().addScaledVector( w.n, 1.4 ), w.n, g, 2 ) - 0.1;
			if ( ! vaultLanding( { rise: g - w.base, clear } ).landing ) continue;
			link( a, station( behind, 'land' ), 'vault', params, [ topEdge ] );

		} else if ( /vault/i.test( cls.move ) ) {

			if ( onRegion( top ) ) link( a, station( top, 'land' ), 'vault', params, [ topEdge ] );

		} else if ( cls.move === 'wallclimbOver' ) {

			if ( topEdge.climbable && onRegion( top ) ) link( a, station( top, 'land' ), 'wallclimb', params, [ topEdge ] );

		} else if ( cls.move === 'wallclimbHang' && topEdge.hangable ) {

			const hang = station( mid.clone().setY( w.top ), 'edge', topEdge, - 1 );
			link( a, hang, 'wallclimb', params );
			if ( topEdge.climbable && onRegion( top ) ) link( hang, station( top, 'land' ), 'climbUp', {} );

		}

	}

	// Under each level box held off the ground: a slide under it (or a crouch through, when it is too high to need the
	// slide), both ways across each of its axes.
	for ( const prim of c.prims ) {

		const s = prim.shape;
		if ( ! prim.collide || ! s?.flat || prim.roles.has( 'out' ) ) continue;
		const g = ground( s.c, s.min.y - 0.05 );
		if ( g === null ) continue;
		const clear = s.min.y - g;
		if ( clear < M.slide.under.max - 0.01 || clear >= M.runner.height ) continue;
		const move = clear + 1e-3 < M.slide.crouch ? 'slideUnder' : 'crouch';
		const affordances = prim.affordances.filter( ( a ) => a.collection === 'walls' || a.collection === 'edges' );
		for ( const [ axis, half ] of [ [ s.ux, s.h.x ], [ s.uz, s.h.z ] ] ) {

			const pa = s.c.clone().addScaledVector( axis, half + 1.5 ).setY( g ), pb = s.c.clone().addScaledVector( axis, - half - 1.5 ).setY( g );
			if ( ! onRegion( pa ) || ! onRegion( pb ) || ! passageClear( c, pa, pb ) ) continue;
			const a = station( pa, 'stand' ), b = station( pb, 'stand' );
			link( a, b, move, { clear: round( clear ) }, affordances.slice( 0, 1 ) );
			link( b, a, move, { clear: round( clear ) }, affordances.slice( 0, 1 ) );

		}

	}

	// Along each chain of runnable walls that carries the runner over a change in the ground (a gap or a drop under
	// it), both ways: a wallrun from one end to the other, when those ends are in different regions.
	for ( const w of c.walls ) {

		if ( ! w.runnable || w.prev || ! w.next ) continue;
		const chain = [];
		for ( let x = w; x && chain.length < 32; x = x.next ) chain.push( x );
		const high = chain.filter( ( x ) => x.base > chain[ 0 ].base + 0.5 || x.base < chain[ 0 ].base - 0.5 );
		if ( ! high.length ) continue;
		for ( const dir of [ 1, - 1 ] ) {

			const first = dir > 0 ? chain[ 0 ] : chain[ chain.length - 1 ], last = dir > 0 ? chain[ chain.length - 1 ] : chain[ 0 ];
			const p0 = first.origin.clone().addScaledVector( first.u, dir > 0 ? 0.8 : first.width - 0.8 ).addScaledVector( first.n, 0.9 ).setY( first.base );
			const p1 = last.origin.clone().addScaledVector( last.u, dir > 0 ? last.width - 0.8 : 0.8 ).addScaledVector( last.n, 0.9 ).setY( last.base );
			if ( ! onRegion( p0 ) || ! onRegion( p1 ) || regions.at( p0 ) === regions.at( p1 ) ) continue;
			const gap = high.reduce( ( s, x ) => s + x.width, 0 );
			link( station( p0, 'wall', first ), station( p1, 'land' ), 'wallrun', { height: round( first.top - first.base ), gap: round( gap ), angle: 20 }, chain );

		}

	}

	for ( const l of c.lines ) {

		if ( l.kind === 'pipe' || l.kind === 'ladder' ) {

			// Up from its foot to the top behind it.
			const n = l.kind === 'pipe' ? l.pipe.n : l.ladder.n;
			if ( ! n ) continue;
			const foot = l.a.y < l.b.y ? l.a : l.b, top = l.a.y < l.b.y ? l.b : l.a;
			const g = ground( foot.clone().addScaledVector( n, 0.6 ), foot.y + 1.5 );
			const atTop = top.clone().addScaledVector( n, - 1.0 );
			const gt = ground( atTop, top.y + 0.5, top.y - 1 );
			if ( g === null || gt === null ) continue;
			const a = station( foot.clone().addScaledVector( n, 0.6 ).setY( g ), 'line', l );
			const b = station( atTop.setY( gt ), 'land' );
			link( a, b, l.kind, { height: round( top.y - g ) } );

		} else if ( l.kind === 'bar' ) {

			// Swung across from either side, landing on the nearest ground 3–4.5 m past it.
			const mid = l.a.clone().lerp( l.b, 0.5 ), along = l.b.clone().sub( l.a ).setY( 0 ).normalize(), across = V( - along.z, 0, along.x );
			for ( const s of [ 1, - 1 ] ) {

				const fwd = across.clone().multiplyScalar( s );
				const from = mid.clone().addScaledVector( fwd, - 1.4 ), g0 = ground( from, mid.y - 1.5, mid.y - 3.2 );
				if ( g0 === null || ! onRegion( from.setY( g0 ) ) ) continue;
				for ( const d of [ 4, 3.5, 4.5, 3 ] ) {

					const to = mid.clone().addScaledVector( fwd, d ), g1 = ground( to, mid.y - 0.5, mid.y - 4.5 );
					if ( g1 !== null && onRegion( to.setY( g1 ) ) ) {

						link( station( from, 'takeoff', l ), station( to, 'land' ), 'swing', { height: round( mid.y - g0 ) } );
						break;

					}

				}

			}

		} else if ( l.kind === 'cable' ) {

			// Ridden from under its high end to past its low end.
			const { high, low } = l.cable, dir = low.clone().sub( high ).setY( 0 ).normalize();
			const take = high.clone().addScaledVector( dir, 1.5 ), g0 = ground( take, high.y - 1.5, high.y - 3 );
			const land = low.clone().addScaledVector( dir, 2 ), g1 = ground( land, low.y - 1, low.y - 4 );
			if ( g0 === null || g1 === null ) continue;
			link( station( take.setY( g0 ), 'takeoff', l ), station( land.setY( g1 ), 'land' ), 'zipline', { slope: round( l.cable.slope ) } );

		} else if ( l.kind === 'beam' ) {

			// Walked end to end, both ways.
			const dir = l.b.clone().sub( l.a ).setY( 0 ).normalize(), top = Math.max( l.a.y, l.b.y );
			const pa = l.a.clone().addScaledVector( dir, - 0.6 ).setY( top ), pb = l.b.clone().addScaledVector( dir, 0.6 ).setY( top );
			if ( ! onRegion( pa ) || ! onRegion( pb ) ) continue;
			const a = station( pa, 'line', l ), b = station( pb, 'line', l );
			link( a, b, 'beam', { width: l.beam.width, length: round( l.a.distanceTo( l.b ) ) } );
			link( b, a, 'beam', { width: l.beam.width, length: round( l.a.distanceTo( l.b ) ) } );

		}

	}

	for ( const o of c.objects ) {

		if ( o.kind === 'door' ) {

			// Through it, both ways.
			const a = o.p.clone().addScaledVector( o.n, 1.2 ), b = o.p.clone().addScaledVector( o.n, - 1.2 );
			if ( ! onRegion( a ) || ! onRegion( b ) ) continue;
			const sa = station( a, 'object', o ), sb = station( b, 'object', o );
			link( sa, sb, 'door', {} );
			link( sb, sa, 'door', {} );

		} else if ( o.kind === 'springboard' ) {

			// Run at it, and across to whatever it reaches (2 m further than a plain jump).
			const before = o.p.clone().addScaledVector( o.n, - 1.6 ).setY( o.p.y - o.height );
			const g = ground( before, before.y + STEP, before.y - 1 );
			if ( g === null ) continue;
			const across = landingAcross( c, o.p.clone().addScaledVector( o.n, 0.2 ), o.n, o.p.y - o.height, regions, 2.0 );
			if ( ! across ) continue;
			link( station( before.setY( g ), 'takeoff', o ), station( across.at.clone().addScaledVector( o.n, 1.2 ), 'land', across.edge ), 'springboard', { gap: round( across.gap ), rise: round( across.rise ), step: o.height } );

		} else {

			// Anything else is somewhere to stand in front of.
			const at = o.p.clone().addScaledVector( o.n, 0.8 ), g = ground( at, o.p.y, o.p.y - 2 );
			if ( g !== null ) station( at.setY( g ), 'object', o );

		}

	}

	// Down each slide slope, from just under its top to its foot.
	for ( const s of c.slopes ) {

		if ( s.kind !== 'slide' ) continue;
		const down = V( s.down.x, 0, s.down.z ).normalize();
		const top = s.corners[ 2 ].clone().lerp( s.corners[ 3 ], 0.5 ).addScaledVector( down, - 0.6 );
		const foot = s.corners[ 0 ].clone().lerp( s.corners[ 1 ], 0.5 ).addScaledVector( down, 1.5 );
		const gt = ground( top, s.top + 0.3, s.top - 0.3 ), gf = ground( foot, s.bottom + 0.3, s.bottom - 0.5 );
		if ( gt === null || gf === null ) continue;
		link( station( top.setY( gt ), 'takeoff', s ), station( foot.setY( gf ), 'land' ), 'slide', { angle: round( s.angle ) } );

	}

	const byRegion = new Map();
	for ( const n of nodes ) {

		if ( n.region < 0 ) continue;
		if ( ! byRegion.has( n.region ) ) byRegion.set( n.region, [] );
		byRegion.get( n.region ).push( n );

	}

	const runs = new Set();
	for ( const list of byRegion.values() ) {

		for ( const n of list ) {

			const near = list.filter( ( o ) => o !== n ).sort( ( a, b ) => a.p.distanceTo( n.p ) - b.p.distanceTo( n.p ) );
			const taken = new Set();
			for ( const o of near ) {

				if ( taken.size >= DIRECTIONS ) break;
				const direction = Math.floor( ( Math.atan2( o.p.x - n.p.x, o.p.z - n.p.z ) + Math.PI ) / ( 2 * Math.PI ) * DIRECTIONS ) % DIRECTIONS;
				if ( taken.has( direction ) || ! runClear( c, n.p, o.p, regions ) ) continue;
				taken.add( direction );
				for ( const [ a, b ] of [ [ n, o ], [ o, n ] ] ) {

					const key = `${a.id}>${b.id}`;
					if ( runs.has( key ) ) continue;
					runs.add( key );
					link( a, b, 'run' );

				}

			}

		}

	}

	return { nodes, links };

}

const round = ( x ) => Math.round( x * 1000 ) / 1000;

// The first landing across a gap from a point at height y, looking along n as far as a jump at top speed could go: a
// top at least half a metre above the gap's floor (the lowest ground seen so far) and no more than 6 m below the
// take-off, level within 15 cm for 80 cm, with walkable ground half a metre past its start. Returns the gap to it, its
// rise, where it starts and the edge there, or null. `extra` reaches further, for a springboard.
function landingAcross( c, q, n, y, regions, extra = 0 ) {

	const max = gapReach( M.speed.max, - 5 ).clearlyOut + extra;
	const at = ( d ) => c.groundAt( q.x + n.x * d, q.z + n.z * d, y + 1.05, y - 40 )?.y ?? - Infinity;
	let floor = at( 0.1 ), start = null, h0 = null;
	for ( let d = 0.1; d <= max; d += 0.05 ) {

		const g = at( d );
		if ( g < floor + 0.5 || g < y - 6 ) {

			floor = Math.min( floor, g );
			start = null;
			continue;

		}

		if ( start === null || Math.abs( g - h0 ) > 0.15 ) {

			start = d;
			h0 = g;

		} else if ( d - start >= 0.8 ) {

			const at = new THREE.Vector3( q.x + n.x * start, h0, q.z + n.z * start );
			if ( regions.at( at.clone().addScaledVector( n, 0.5 ) ) < 0 ) return null;
			const edge = c.affordancesNear( [ 'edges' ], at, 0.4 ).find( ( e ) => e.n.dot( n ) < - 0.9 && Math.abs( e.y - h0 ) < 0.05 ) ?? null;
			return { gap: start, rise: h0 - y, at, edge };

		}

	}

	return null;

}

// How far the ground runs back from a point against n, level within a step and clear to the chest, up to `max`.
function runwayBehind( c, q, n, y, max = 45 ) {

	let d = 0.1;
	for ( ; d < max; d += 0.25 ) {

		const x = q.x - n.x * d, z = q.z - n.z * d;
		const g = c.groundAt( x, z, y + STEP, y - STEP );
		if ( ! g || c.solidAt( x, g.y + 0.5, z ) || c.solidAt( x, g.y + 1.2, z ) ) break;

	}

	return d;

}

// Whether a low passage from a to b has ground all the way and nothing within 25 cm of a point 40 cm up: room to
// slide or crouch through.
function passageClear( c, a, b ) {

	const L = Math.hypot( b.x - a.x, b.z - a.z ), n = Math.max( 1, Math.ceil( L / 0.25 ) );
	let y = a.y;
	for ( let i = 1; i < n; i ++ ) {

		const t = i / n, x = a.x + ( b.x - a.x ) * t, z = a.z + ( b.z - a.z ) * t;
		const g = c.groundAt( x, z, y + STEP, y - STEP );
		if ( ! g || c.distanceAt( x, g.y + 0.4, z, 0.5 ) < 0.25 ) return false;
		y = g.y;

	}

	return true;

}

// Whether the runner walks straight from a to b: ground a step at a time, upright all the way, ending at b's height.
function runClear( c, a, b, regions ) {

	const L = Math.hypot( b.x - a.x, b.z - a.z ), n = Math.max( 1, Math.ceil( L / 0.5 ) );
	let y = a.y;
	for ( let i = 1; i < n; i ++ ) {

		const t = i / n, x = a.x + ( b.x - a.x ) * t, z = a.z + ( b.z - a.z ) * t;
		const g = c.groundAt( x, z, y + STEP, y - STEP );
		if ( ! g || ! regions.fits( x, g.y, z ) ) return false;
		y = g.y;

	}

	return Math.abs( y - b.y ) <= STEP + 0.05;

}
