/**
 * A course's route: a graph of stations (nodes: where the runner starts, stands, takes off, lands, hangs) and the
 * moves between them (links: a run, a jump, a vault, a wallrun…, each with the affordances it uses and the path it
 * takes). A course file can author one (`route: { nodes, links }`); otherwise `deriveRoute.js` works one out.
 *
 * The route answers where to go next from wherever the runner is: it finds the link the runner is on and searches
 * ahead for the quickest way on, carrying the runner's speed through each move (`routeMoves.js`). Runner Vision draws
 * the answer; the validator checks each link at the speed the route arrives at it with.
 */
import * as THREE from 'three/webgpu';
import { metrics as M } from './metrics.js';
import { speedAfterRun } from './reach.js';
import { jumpArc, moveTime, SPEED_AFTER, speedNeeded } from './routeMoves.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// The point of segment a–b nearest p (into `out`); returns how far along it is, 0–1.
function onSegment( p, a, b, out ) {

	_w.subVectors( b, a );
	const l2 = _w.lengthSq(), t = l2 > 1e-12 ? Math.max( 0, Math.min( 1, _v.subVectors( p, a ).dot( _w ) / l2 ) ) : 0;
	out.copy( a ).addScaledVector( _w, t );
	return t;

}

// A binary min-heap on `f`, the search's open list.
class Heap {

	constructor() {

		this.a = [];

	}

	push( x ) {

		const a = this.a;
		a.push( x );
		let i = a.length - 1;
		while ( i > 0 ) {

			const p = ( i - 1 ) >> 1;
			if ( a[ p ].f <= x.f ) break;
			a[ i ] = a[ p ];
			i = p;

		}

		a[ i ] = x;

	}

	pop() {

		const a = this.a, top = a[ 0 ], last = a.pop();
		if ( a.length ) {

			let i = 0;
			for ( ;; ) {

				const l = 2 * i + 1, r = l + 1;
				let m = i;
				if ( l < a.length && a[ l ].f < ( m === i ? last.f : a[ m ].f ) ) m = l;
				if ( r < a.length && a[ r ].f < ( m === i ? last.f : a[ m ].f ) ) m = r;
				if ( m === i ) break;
				a[ i ] = a[ m ];
				i = m;

			}

			a[ i ] = last;

		}

		return top;

	}

	get size() {

		return this.a.length;

	}

}

export class Route {

	/**
	 * @param {Course} course
	 * @param {{ nodes: Array, links: Array }} def Nodes `{ id, p, kind, ref }` and links `{ from, to, move, params,
	 * refs, path?, speed? }`. A ref is an affordance, its id, or `{ prim, kind, near }` (the prim's affordance of that
	 * collection or kind nearest a point).
	 * @param {Object} [options]
	 * @param {boolean} [options.derived] Worked out from the geometry rather than authored: it has no single line from
	 * start to finish, so the next moves are looked for nearby rather than planned (see `nextMoves`).
	 */
	constructor( course, def, { derived = false } = {} ) {

		this.course = course;
		this.derived = derived;
		this.nodes = [];
		this.links = [];
		this.byId = new Map();
		this.start = null;
		this.finish = null;
		for ( const n of def.nodes ?? [] ) this.addNode( n );
		for ( const l of def.links ?? [] ) this.addLink( l );
		this.start = this.nodes.find( ( n ) => n.kind === 'start' ) ?? null;
		this.finish = this.nodes.find( ( n ) => n.kind === 'finish' ) ?? null;
		this.setArrivalSpeeds();

	}

	addNode( n ) {

		const node = {
			id: n.id ?? `n${this.nodes.length}`,
			p: n.p?.isVector3 ? n.p.clone() : new THREE.Vector3().fromArray( n.p ),
			kind: n.kind ?? 'stand',
			affordance: this.resolve( n.ref ),
			region: n.region ?? null,
			out: [],
			in: [],
			index: this.nodes.length,
		};
		this.nodes.push( node );
		this.byId.set( node.id, node );
		return node;

	}

	// A link uses the affordances it names and those of the stations at its ends. Its path is authored, a jump's arc,
	// or a straight line.
	addLink( l ) {

		const from = typeof l.from === 'object' ? l.from : this.byId.get( l.from ), to = typeof l.to === 'object' ? l.to : this.byId.get( l.to );
		if ( ! from || ! to ) {

			console.warn( `route: link ${l.from} -> ${l.to} names a node that isn't there` );
			return null;

		}

		const params = { ...( l.params ?? {} ) };
		const affordances = [];
		for ( const r of [ ...( l.refs ?? [] ), from.affordance, to.affordance ] ) {

			const a = r?.collection ? r : this.resolve( r );
			if ( a && ! affordances.includes( a ) ) affordances.push( a );

		}

		const path = l.path ? l.path.map( ( q ) => q.isVector3 ? q.clone() : new THREE.Vector3().fromArray( q ) ) : this.pathFor( l.move, from.p, to.p, params );
		let length = 0;
		for ( let i = 1; i < path.length; i ++ ) length += path[ i ].distanceTo( path[ i - 1 ] );
		const link = {
			id: l.id ?? `l${this.links.length}`,
			from, to,
			move: l.move ?? 'run',
			params,
			speed: l.speed ?? speedNeeded( l.move, params ),
			affordances,
			path,
			length,
			index: this.links.length,
			violations: [],
			warnings: [],
		};
		this.links.push( link );
		from.out.push( link );
		to.in.push( link );
		return link;

	}

	// A jump, drop or springboard flies an arc at the speed it is planned at (at least a sprint, at most top speed).
	pathFor( move, a, b, params ) {

		if ( move === 'jump' || move === 'drop' || move === 'springboard' ) {

			const v = Math.max( params.speed ?? 0, speedNeeded( 'jump', params ).comfortable, M.speed.sprint );
			return jumpArc( a, b, Number.isFinite( v ) ? Math.min( v, M.speed.max ) : M.speed.max );

		}

		return [ a.clone(), b.clone() ];

	}

	resolve( ref ) {

		if ( ! ref ) return null;
		if ( ref.collection ) return ref;
		const c = this.course;
		if ( typeof ref === 'string' || typeof ref === 'number' ) return c.affordance( ref );
		const prim = c.prims.find( ( p ) => p.id === ref.prim );
		if ( ! prim ) return null;
		const list = prim.affordances.filter( ( a ) => ! ref.kind || a.collection === ref.kind || a.kind === ref.kind );
		if ( ! list.length ) return null;
		if ( ! ref.near ) return list[ 0 ];
		const p = new THREE.Vector3().fromArray( ref.near );
		let best = null, bd = Infinity;
		for ( const a of list ) {

			const d = distance( a, p );
			if ( d < bd ) {

				bd = d;
				best = a;

			}

		}

		return best;

	}

	// Follows the quickest way from the start to the finish (taking moves the speed is short for, at a cost) and gives
	// each link on it `speedIn`, the speed the runner arrives with: what the validator checks that link at.
	setArrivalSpeeds() {

		if ( ! this.start ) return;
		const path = this.search( this.start, 0, this.finish, { horizon: Infinity, strict: false } );
		let v = 0;
		for ( const step of path ) {

			step.link.speedIn = v;
			v = this.exitSpeed( step.link, v );

		}

	}

	/** The speed the runner leaves a link at, arriving at v: a run builds speed over its length first. */
	exitSpeed( link, v ) {

		const vin = link.move === 'run' ? speedAfterRun( v, link.length ) : v;
		return ( SPEED_AFTER[ link.move ] ?? SPEED_AFTER.run )( vin, link );

	}

	/**
	 * The quickest way on from a node, arriving at it at speed v0. Each link costs the time it takes at the speed it is
	 * reached at, plus 0.15 s for each m/s it loses, plus a minute when arriving too slow for it (`strict` skips those
	 * instead). With a goal it is an A* search to the goal; without, it explores `horizon` seconds ahead and ends at
	 * the node that best trades progress (along `heading` from `from`, or time) against time and speed kept.
	 * @param {Object} node
	 * @param {number} v0
	 * @param {Object|null} [goal]
	 * @param {Object} [options] `heading`, `from`, `horizon` (s), `strict`.
	 * @return {Array<{ link: Object, time: number, speed: number }>} The steps, first to last.
	 */
	search( node, v0, goal = null, { heading = null, from = null, horizon = 12, strict = true } = {} ) {

		const best = new Map(), open = new Heap();
		const h = ( n ) => goal ? n.p.distanceTo( goal.p ) / M.speed.max : 0;
		open.push( { node, g: 0, f: h( node ), v: v0, prev: null, link: null } );
		best.set( node, 0 );
		let end = null, endScore = - Infinity;
		while ( open.size ) {

			const cur = open.pop();
			if ( cur.g > ( best.get( cur.node ) ?? Infinity ) + 1e-9 ) continue;
			if ( goal && cur.node === goal ) {

				end = cur;
				break;

			}

			if ( ! goal && cur.prev ) {

				const along = heading ? _v.subVectors( cur.node.p, from ).dot( heading ) : cur.g;
				const score = along - 0.6 * cur.g + 0.3 * cur.v;
				if ( score > endScore ) {

					endScore = score;
					end = cur;

				}

			}

			if ( ! goal && cur.g > horizon ) continue;
			for ( const link of cur.node.out ) {

				const vin = cur.v, short = link.move !== 'run' && vin + 1e-6 < link.speed.min;
				if ( short && strict ) continue;
				const vout = this.exitSpeed( link, vin );
				const g = cur.g + moveTime( link, link.move === 'run' ? Math.max( vin, vout ) : vin ) + 0.15 * Math.max( 0, vin - vout ) + ( short ? 60 : 0 );
				if ( g >= ( best.get( link.to ) ?? Infinity ) ) continue;
				best.set( link.to, g );
				open.push( { node: link.to, g, f: g + h( link.to ), v: vout, prev: cur, link } );

			}

		}

		const steps = [];
		for ( let s = end; s && s.prev; s = s.prev ) steps.push( { link: s.link, time: s.g, speed: s.v } );
		return steps.reverse();

	}

	/**
	 * Where on the route a runner is: the link whose path passes nearest (height counts half, a link run against its
	 * direction counts 2 m per unit against, a move other than a run a little more until the runner is a quarter of
	 * the way along it), within `reach`; failing that, the nearest node, favouring those ahead.
	 * @return {{ link: Object|null, node: Object, t: number }|null} `node` is where the runner is heading, `t` how far
	 * along the link.
	 */
	locate( position, velocity, reach = 4 ) {

		const speed = Math.hypot( velocity.x, velocity.z );
		const hx = speed > 0.3 ? velocity.x / speed : 0, hz = speed > 0.3 ? velocity.z / speed : 0;
		let best = null, bs = Infinity;
		const q = new THREE.Vector3();
		for ( const link of this.links ) {

			const P = link.path;
			let along = 0;
			for ( let i = 1; i < P.length; i ++ ) {

				const t = onSegment( position, P[ i - 1 ], P[ i ], q );
				const seg = P[ i ].distanceTo( P[ i - 1 ] );
				const d = Math.hypot( q.x - position.x, ( q.y - position.y ) * 0.5, q.z - position.z );
				if ( d > reach ) {

					along += seg;
					continue;

				}

				const dx = P[ i ].x - P[ i - 1 ].x, dz = P[ i ].z - P[ i - 1 ].z, dl = Math.hypot( dx, dz );
				const against = dl > 1e-6 ? - ( hx * dx + hz * dz ) / dl : 0;
				const tt = link.length > 0 ? ( along + t * seg ) / link.length : 1;
				const mx = link.to.p.x - link.from.p.x, mz = link.to.p.z - link.from.p.z, ml = Math.hypot( mx, mz );
				const into = ml > 1e-6 ? ( ( position.x - link.from.p.x ) * mx + ( position.z - link.from.p.z ) * mz ) / ml : 1;
				const score = d + 2 * Math.max( 0, against ) + ( link.move === 'run' ? 0.3 : into < 0.25 ? 0.5 : 0 );
				if ( score < bs ) {

					bs = score;
					best = { link, node: link.to, t: tt };

				}

				along += seg;

			}

		}

		if ( best ) return best;
		let node = null, nd = Infinity;
		for ( const n of this.nodes ) {

			const d = n.p.distanceTo( position ), ahead = ( n.p.x - position.x ) * hx + ( n.p.z - position.z ) * hz;
			const score = d - 0.5 * ahead;
			if ( d < 25 && score < nd ) {

				nd = score;
				node = n;

			}

		}

		return node ? { link: null, node, t: 0 } : null;

	}

	/**
	 * The way on from where the runner is: the rest of the link it is on, then the quickest way to the finish (or, with
	 * no finish, the best way ahead in its direction of travel).
	 * @return {Array<{ node: Object, link: Object, speed: number }>}
	 */
	planSteps( position, velocity ) {

		const at = this.locate( position, velocity );
		if ( ! at ) return [];
		const v0 = Math.hypot( velocity.x, velocity.z );
		const steps = [];
		if ( at.link ) steps.push( { node: at.node, link: at.link, speed: this.exitSpeed( at.link, v0 ) } );
		const heading = v0 > 0.3 ? new THREE.Vector3( velocity.x / v0, 0, velocity.z / v0 ) : null;
		const rest = this.search( at.node, steps.length ? steps[ 0 ].speed : v0, this.finish, { heading, from: position } );
		for ( const s of rest ) steps.push( { node: s.link.to, link: s.link, speed: s.speed } );
		return steps;

	}

	/**
	 * The next place the runner does something other than run: where the next move starts and the affordances it
	 * uses.
	 * @param {Array} [steps] The plan, when the caller has it already.
	 * @return {{ point: THREE.Vector3, affordanceIds: Array<string>, node: string, link: string, distance: number,
	 * steps: Array }|null}
	 */
	nextTarget( position, velocity, steps = null ) {

		if ( this.derived ) {

			const [ l ] = this.nextMoves( position, velocity, null, 1 );
			return l ? { point: l.from.p, affordanceIds: l.affordances.map( ( a ) => a.id ), node: l.from.id, link: l.move, distance: l.from.p.distanceTo( position ), steps: [] } : null;

		}

		steps ??= this.planSteps( position, velocity );
		for ( let i = 0; i < steps.length; i ++ ) {

			const l = steps[ i ].link;
			if ( l.move === 'run' ) continue;
			// Already on the move: what it lands on; otherwise where it starts.
			const at = i === 0 ? l.to : l.from;
			return { point: at.p, affordanceIds: l.affordances.map( ( a ) => a.id ), node: at.id, link: l.move, distance: at.p.distanceTo( position ), steps };

		}

		const last = steps[ steps.length - 1 ];
		return last ? { point: last.node.p, affordanceIds: [], node: last.node.id, link: last.link.move, distance: last.node.p.distanceTo( position ), steps } : null;

	}

	/**
	 * The next `count` moves other than runs. On an authored route, from the plan. On a derived one, which offers a move
	 * at every edge and wall, the nearest moves ahead instead, one after another: starting within 25 m and 1.2 m of
	 * height, within 45° of the heading unless closer than 1.5 m, not leading back, not a drop or a move from a hang,
	 * and using something Runner Vision can tint.
	 * @return {Array<Object>} Links.
	 */
	nextMoves( position, velocity, steps = null, count = 2 ) {

		if ( ! this.derived ) {

			steps ??= this.planSteps( position, velocity );
			return steps.filter( ( s ) => s.link.move !== 'run' ).slice( 0, count ).map( ( s ) => s.link );

		}

		const out = [];
		const sp = Math.hypot( velocity.x, velocity.z );
		let p = position, hx = sp > 0.3 ? velocity.x / sp : 0, hz = sp > 0.3 ? velocity.z / sp : 0;
		while ( out.length < count ) {

			let best = null, bs = Infinity;
			for ( const l of this.links ) {

				if ( l.move === 'run' || l.move === 'drop' || l.from.kind === 'edge' || out.includes( l ) || ! l.affordances.some( ( a ) => a.usable ) ) continue;
				const dx = l.from.p.x - p.x, dz = l.from.p.z - p.z, d = Math.hypot( dx, dz );
				if ( d > 25 || Math.abs( l.from.p.y - p.y ) > 1.2 ) continue;
				const ahead = d > 1e-3 ? ( dx * hx + dz * hz ) / d : 1;
				if ( ( hx || hz ) && d > 1.5 && ahead < Math.SQRT1_2 ) continue;
				const mx = l.to.p.x - l.from.p.x, mz = l.to.p.z - l.from.p.z, ml = Math.hypot( mx, mz );
				if ( ( hx || hz ) && ml > 0.5 && ( mx * hx + mz * hz ) / ml < 0 ) continue;
				const score = d * ( 2 - ahead );
				if ( score < bs ) {

					bs = score;
					best = l;

				}

			}

			if ( ! best ) break;
			out.push( best );
			p = best.to.p;
			const mx = best.to.p.x - best.from.p.x, mz = best.to.p.z - best.from.p.z, ml = Math.hypot( mx, mz );
			if ( ml > 0.5 ) {

				hx = mx / ml;
				hz = mz / ml;

			}

		}

		return out;

	}

}

// A point that stands for an affordance, for picking the nearest of a prim's affordances to a reference.
function refPoint( a ) {

	switch ( a.collection ) {

		case 'edges':
		case 'lines': return a.a.clone().lerp( a.b, 0.5 );
		case 'walls': return a.origin.clone().addScaledVector( a.u, a.width / 2 ).setY( ( a.base + a.top ) / 2 );
		case 'objects': return a.p.clone();
		case 'slopes': return a.corners.reduce( ( s, c ) => s.add( c ), new THREE.Vector3() ).multiplyScalar( 0.25 );
		default: return a.box ? a.box.getCenter( new THREE.Vector3() ) : new THREE.Vector3();

	}

}

function distance( a, p ) {

	const q = new THREE.Vector3();
	switch ( a.collection ) {

		case 'edges':
		case 'lines': onSegment( p, a.a, a.b, q ); return q.distanceTo( p );
		case 'walls': {

			const s = Math.max( 0, Math.min( a.width, ( p.x - a.origin.x ) * a.u.x + ( p.z - a.origin.z ) * a.u.z ) );
			return Math.hypot( a.origin.x + a.u.x * s - p.x, Math.max( a.base, Math.min( a.top, p.y ) ) - p.y, a.origin.z + a.u.z * s - p.z );

		}

		default: return refPoint( a ).distanceTo( p );

	}

}
