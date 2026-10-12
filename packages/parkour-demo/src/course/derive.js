/**
 * Deriving what a course's solids afford from their geometry alone, so a level is built from plain boxes and wedges
 * and the edges, walls and slopes follow from where they stand.
 *
 * Every side of an upright box (and the back face of a wedge) is probed in 10 cm columns: is the edge clear above,
 * is the side open or against another solid, how far down is the ground. Runs of open columns with a drop under them
 * become **edges**, measured (how deep the top is behind them, the headroom over it, how much face there is under
 * them to brace against) and classed by the ledge metrics. Runs of columns with the same face become **faces**: a
 * face taller than a step is a **wall** (to run along, or to climb when tall enough), one of vaulting height is a
 * vault face. Each wedge is a **slope**. Edges are then chained round corners and walls along their length, and each
 * prim gets roles that say what it turned out to be (`top`, `edge`, `ledge`, `narrow`, `wall`, `vault`, `slope`,
 * `slide`).
 */
import * as THREE from 'three/webgpu';
import { ledge, slopeKind } from './reach.js';
import { Box, Wedge } from './shapes.js';

// Spacing of the probe columns along a side (m).
const COLUMN_STEP = 0.1;
// How far off a side, and above or below its top, a probe looks: past the seam between two boxes, short of anything
// a hand would not reach.
const PROBE = 0.05;
// The deepest a top is measured behind its edge; deeper counts as this.
const DEPTH_MAX = 4;
// The most face measured under an edge.
const FACE_MAX = 3;
// Spacing of the ledge measurements along an edge.
const EDGE_SAMPLE = 0.5;
// Columns whose ground differs by up to this belong to one edge (a step in the street does not split a roof's edge).
const SAME_GROUND = 0.25;
// Probes either side of a point under a top, so two boxes that meet exactly read as one surface.
const SEAM = 2e-4;

/**
 * Finds the edges, walls and slopes on a course's derived prims and gives each prim its roles.
 * @param {Course} course
 */
export function derive( course ) {

	const derived = [];
	for ( const prim of course.prims ) {

		if ( ! prim.derive ) continue;
		if ( prim.shape instanceof Wedge ) deriveWedge( course, prim );
		else if ( prim.shape instanceof Box && prim.shape.flat ) deriveBox( course, prim );
		else continue;
		derived.push( prim );

	}

	linkCorners( course );
	linkWalls( course );

	// An edge too short to hang from on its own is still hung from when it carries on round a corner or past a seam.
	const min = course.metrics.ledge.hang.length;
	for ( const e of course.edges ) {

		if ( ! e.hangable || e.length >= min || e.prev?.hangable || e.next?.hangable ) continue;
		e.hangable = false;
		e.usable = e.vault;

	}

	for ( const prim of derived ) {

		const roles = prim.roles;
		if ( prim.shape instanceof Wedge ) {

			roles.add( 'slope' );
			if ( prim.slope.kind === 'slide' ) roles.add( 'slide' );

		} else roles.add( 'top' );
		for ( const a of prim.affordances ) {

			if ( a.collection === 'walls' ) roles.add( 'wall' );
			if ( a.collection !== 'edges' ) continue;
			roles.add( 'edge' );
			if ( a.hangable ) roles.add( 'ledge' );
			if ( a.narrow ) roles.add( 'narrow' );

		}

		if ( prim.faces.some( ( f ) => f.kind === 'vault' ) ) roles.add( 'vault' );

	}

}

// An upright box: its four sides. When a side is vaulted, the whole box lights up as one obstacle: its edges and vault
// faces share one tint, and a thin box's top is coloured as part of the vault.
function deriveBox( course, prim ) {

	const s = prim.shape, top = s.c.y + s.h.y, bottom = s.c.y - s.h.y;
	for ( const [ axis, sign, off, halfWidth ] of [ [ s.ux, 1, s.h.x, s.h.z ], [ s.ux, - 1, s.h.x, s.h.z ], [ s.uz, 1, s.h.z, s.h.x ], [ s.uz, - 1, s.h.z, s.h.x ] ] ) {

		const n = axis.clone().multiplyScalar( sign ).setY( 0 ).normalize();
		const dir = new THREE.Vector3( n.z, 0, - n.x );
		const a0 = s.c.clone().addScaledVector( n, off ).addScaledVector( dir, - halfWidth );
		a0.y = top;
		readSide( course, prim, { n, dir, a0, length: 2 * halfWidth, top, bottom, edges: ! prim.roles.has( 'noClimb' ) } );

	}

	const vault = prim.faces.find( ( f ) => f.kind === 'vault' && f.aff );
	if ( vault ) {

		prim.tint = vault.aff;
		for ( const a of prim.affordances ) if ( a.collection === 'edges' ) a.tint = prim.tint;
		for ( const f of prim.faces ) if ( f.kind === 'vault' ) f.aff = prim.tint;
		prim.vaultTop = Math.min( s.h.x, s.h.z ) * 2 <= course.metrics.obstacle.thin;

	}

}

// A wedge: a slope, classed by its angle, and its upright back face (which can be a wall but has no edge to hang from).
function deriveWedge( course, prim ) {

	const s = prim.shape, m = course.metrics, { c, h, ux, uz } = s;
	const corner = ( x, z ) => c.clone().addScaledVector( ux, x * h.x ).addScaledVector( uz, z * h.z ).setY( c.y + z * h.y );
	prim.slope = course.addAffordance( 'slopes', {
		kind: slopeKind( s.angle, m ),
		prim,
		angle: s.angle,
		down: s.down.clone(),
		n: s.normal.clone(),
		corners: [ corner( - 1, - 1 ), corner( 1, - 1 ), corner( 1, 1 ), corner( - 1, 1 ) ],
		top: c.y + h.y,
		bottom: c.y - h.y,
		width: 2 * h.x,
		length: 2 * Math.hypot( h.y, h.z ),
	} );
	const n = uz.clone(), dir = new THREE.Vector3( n.z, 0, - n.x );
	const a0 = c.clone().addScaledVector( n, h.z ).addScaledVector( dir, - h.x );
	a0.y = c.y + h.y;
	readSide( course, prim, { n, dir, a0, length: 2 * h.x, top: c.y + h.y, bottom: c.y - h.y, edges: false } );

}

// One side of a solid: `a0` is its corner at the top, `dir` runs along it for `length`, `n` faces out.
function readSide( course, prim, { n, dir, a0, length, top, bottom, edges } ) {

	const count = Math.max( 1, Math.ceil( length / COLUMN_STEP - 1e-6 ) ), ds = length / count;
	const columns = [];
	for ( let i = 0; i < count; i ++ ) columns.push( probeColumn( course, n, dir, a0, ( i + 0.5 ) * ds, top, bottom, true ) );
	const side = { course, prim, n, dir, a0, length, top, bottom };

	if ( edges ) {

		for ( const [ i0, i1 ] of runsOf( columns, ( c ) => c.edge, sameGround ) ) {

			// The run's ends lie between its outer columns and their neighbours: found by bisection, to the millimetre.
			const first = columns[ i0 ];
			const like = ( c ) => c.edge && sameGround( c, first );
			const s0 = i0 === 0 ? 0 : refineBoundary( side, columns[ i0 - 1 ].s, columns[ i0 ].s, like );
			const s1 = i1 === count - 1 ? length : refineBoundary( side, columns[ i1 + 1 ].s, columns[ i1 ].s, like );
			addEdges( side, s0, s1, columns.slice( i0, i1 + 1 ) );

		}

	}

	const sameFace = ( c, p ) => c.covered === p.covered && Math.abs( c.base - p.base ) <= 0.1 && Math.abs( c.faceTop - p.faceTop ) <= 0.1;
	for ( const [ i0, i1 ] of runsOf( columns, () => true, sameFace ) ) {

		const s0 = i0 === 0 ? 0 : ( columns[ i0 - 1 ].s + columns[ i0 ].s ) / 2;
		const s1 = i1 === count - 1 ? length : ( columns[ i1 ].s + columns[ i1 + 1 ].s ) / 2;
		addFace( side, s0, s1, columns.slice( i0, i1 + 1 ) );

	}

}

// What one point along a side shows: whether something sits on the edge there (`buried`), whether another solid is
// against the side (`covered`), the ground in front and the drop to it, and the face's foot (`base`) and, where the
// side is covered, how high it shows above the base (`faceTop`). An edge is clear on top, open in front and higher
// than a step.
function probeColumn( course, n, dir, a0, s, top, bottom, full = false ) {

	const qx = a0.x + dir.x * s, qz = a0.z + dir.z * s, ox = qx + n.x * PROBE, oz = qz + n.z * PROBE;
	const buried = !! course.solidAt( qx, top + PROBE, qz );
	const covered = !! course.solidAt( ox, top - PROBE, oz );
	const g = course.groundAt( ox, oz, top - PROBE );
	const ground = g ? g.y : - Infinity;
	const drop = top - ground, base = Math.max( ground, bottom );
	let faceTop = top;
	if ( covered && full ) {

		faceTop = base;
		for ( let y = base + PROBE; y < top - PROBE; y += 0.1 ) {

			if ( course.solidAt( ox, y, oz ) ) break;
			faceTop = Math.min( top, y + PROBE );

		}

	}

	return { s, buried, covered, ground, drop, base, faceTop, edge: ! buried && ! covered && drop > course.metrics.runner.step };

}

const sameGround = ( c, p ) => c.ground === p.ground || Math.abs( c.ground - p.ground ) <= SAME_GROUND;

// The runs [ first, last ] of consecutive items that pass `include` and are `same` as the one before.
function runsOf( items, include, same ) {

	const out = [];
	let start = - 1;
	for ( let i = 0; i <= items.length; i ++ ) {

		const ok = i < items.length && include( items[ i ] ) && ( start < 0 || same( items[ i ], items[ i - 1 ] ) );
		if ( ok && start < 0 ) start = i;
		else if ( ! ok && start >= 0 ) {

			out.push( [ start, i - 1 ] );
			start = i < items.length && include( items[ i ] ) ? i : - 1;

		}

	}

	return out;

}

// Where along a side, between a column outside a run and one inside it, the run starts.
function refineBoundary( { course, n, dir, a0, top, bottom }, outside, inside, like ) {

	for ( let k = 0; k < 9; k ++ ) {

		const mid = ( outside + inside ) / 2;
		if ( like( probeColumn( course, n, dir, a0, mid, top, bottom ) ) ) inside = mid;
		else outside = mid;

	}

	return toMm( ( outside + inside ) / 2 );

}

const toMm = ( x ) => Math.round( x * 1000 ) / 1000;

// The edges along one run of edge columns: measured every half metre, and split wherever what the ledge allows
// changes (hang, climb onto, stand on, braced, narrow, and the depth band), so each edge is one kind of ledge.
function addEdges( side, s0, s1, columns ) {

	const { course, prim, n, dir, a0, top } = side, m = course.metrics;
	const length = s1 - s0;
	if ( length < 0.05 ) return;
	const count = Math.max( 2, Math.ceil( length / EDGE_SAMPLE ) + 1 ), inset = Math.min( 0.05, length / 4 );
	const samples = [];
	for ( let k = 0; k < count; k ++ ) {

		const s = s0 + inset + ( length - 2 * inset ) * k / ( count - 1 );
		const column = columns.reduce( ( best, c ) => Math.abs( c.s - s ) < Math.abs( best.s - s ) ? c : best );
		const q = measureLedge( course, a0.x + dir.x * s, a0.z + dir.z * s, n, top, column.drop );
		q.s = s;
		q.drop = column.drop;
		q.flags = ledge( q, m );
		q.key = [ 'hangable', 'climbable', 'standable', 'braced', 'narrow' ].map( ( k ) => q.flags[ k ] ? 1 : 0 ).join( '' ) + depthBand( q.depth, m );
		samples.push( q );

	}

	for ( const [ k0, k1 ] of runsOf( samples, () => true, ( a, b ) => a.key === b.key ) ) {

		const sa = k0 === 0 ? s0 : ( samples[ k0 - 1 ].s + samples[ k0 ].s ) / 2;
		const sb = k1 === count - 1 ? s1 : ( samples[ k1 ].s + samples[ k1 + 1 ].s ) / 2;
		const part = samples.slice( k0, k1 + 1 ), min = ( k ) => Math.min( ...part.map( ( q ) => q[ k ] ) );
		const median = ( k ) => part.map( ( q ) => q[ k ] ).sort( ( x, y ) => x - y )[ ( part.length - 1 ) >> 1 ];
		const flags = part[ 0 ].flags;
		const a = a0.clone().addScaledVector( dir, sa ), b = a0.clone().addScaledVector( dir, sb );
		const e = course.addAffordance( 'edges', {
			kind: 'edge', prim, a, b, dir: dir.clone(), n: n.clone(), y: top, length: sb - sa,
			depth: median( 'depth' ), headroom: median( 'headroom' ), drop: min( 'drop' ), face: median( 'face' ),
			hangable: flags.hangable, climbable: flags.climbable, standable: flags.standable, braced: flags.braced, narrow: flags.narrow, facing: flags.facing,
			prev: null, next: null, cornerA: null, cornerB: null,
		} );
		// Vaulted when the drop in front is vaulting height: over a stepped-up obstacle, under a wallclimb.
		e.vault = e.drop >= m.obstacle.bands[ 1 ].to && e.drop < m.obstacle.bands[ 3 ].to;
		e.usable = e.hangable || e.vault;
		e.span = [ sa, sb ];

	}

}

// What a hand on an edge finds, at one point along it:
// - depth: how far the top runs back (until it ends, or a wall rises from it), to the millimetre;
// - wallBehind: when a wall ends it, how much higher that wall's top is;
// - headroom: the clearance over the top, a little way in;
// - face: how far down a face to brace the feet on stays within reach under the edge, in 10 cm steps.
function measureLedge( course, x, z, n, top, drop ) {

	const under = ( d ) => course.solidAt( x - n.x * d, top - PROBE, z - n.z * d );
	const onTop = ( d ) => {

		if ( ! under( d - SEAM ) && ! under( d + SEAM ) ) return 'off';
		if ( course.solidAt( x - n.x * d, top + PROBE, z - n.z * d ) ) return 'wall';
		return 'on';

	};

	let good = 0, bad = Infinity, why = 'deep';
	for ( let d = PROBE; d <= DEPTH_MAX + 1e-9; d += PROBE ) {

		const r = onTop( d );
		if ( r === 'on' ) {

			good = d;
			continue;

		}

		bad = d;
		why = r;
		break;

	}

	if ( bad < Infinity ) {

		for ( let k = 0; k < 10; k ++ ) {

			const mid = ( good + bad ) / 2;
			if ( onTop( mid ) === 'on' ) good = mid;
			else bad = mid;

		}

	}

	const depth = bad < Infinity ? toMm( ( good + bad ) / 2 ) : DEPTH_MAX;
	let wallBehind = 0;
	if ( why === 'wall' ) {

		const d = depth + 0.1, g = course.groundAt( x - n.x * d, z - n.z * d, Infinity );
		wallBehind = g ? g.y - top : 0;

	}

	const inset = Math.min( 0.3, depth / 2 );
	const headroom = course.ceilingAt( x - n.x * inset, z - n.z * inset, top + 0.01 ) - top;

	// Rays back toward the face from just outside the edge: a braced hang needs the face within the gap a foot reaches.
	const gap = course.metrics.ledge.braced.gap;
	rayFrom.set( x + n.x * PROBE, top, z + n.z * PROBE );
	rayDirection.set( - n.x, 0, - n.z );
	let face = 0;
	for ( let k = 1; k * 0.1 <= Math.min( drop, FACE_MAX ) + 1e-6; k ++ ) {

		rayFrom.y = top - ( k - 0.5 ) * 0.1;
		if ( ! course.raycast( rayFrom, rayDirection, PROBE + gap ) ) break;
		face = k * 0.1;

	}

	return { depth, wallBehind, headroom, face };

}

const rayFrom = new THREE.Vector3(), rayDirection = new THREE.Vector3();

// Which depth band a top falls in: a hang, a narrow ledge, a top to climb onto, a thin obstacle, a deep one.
function depthBand( depth, m ) {

	const t = [ m.ledge.hang.depth, m.ledge.narrow.depth[ 1 ], m.ledge.climb.depth, m.obstacle.thin, m.obstacle.deep ];
	return t.filter( ( x ) => depth >= x ).length;

}

// One face along a side, and the wall it makes when it is taller than a step. Its kind colours it in the graybox:
// `wall` (climbable), `vault` (vaulted over or onto from the ground in front), `noRun`, or a plain `face`. A vault
// face's affordance is the edge over it, so the face lights up with it.
function addFace( side, s0, s1, columns ) {

	const { course, prim, n, dir, a0, top, bottom } = side, m = course.metrics;
	const covered = columns[ 0 ].covered;
	const base = Math.max( ...columns.map( ( c ) => c.base ) ), faceTop = Math.min( ...columns.map( ( c ) => c.faceTop ) ), height = faceTop - base;
	const mid = ( s0 + s1 ) / 2;
	const edge = prim.affordances.find( ( a ) => a.collection === 'edges' && a.n.dot( n ) > 0.99 && a.span[ 0 ] <= mid && a.span[ 1 ] >= mid );
	// A thin obstacle is vaulted up to the high-vault band; anything deeper only until it is a wall to climb.
	const wallMin = Math.min( m.wall.climb.height.max, m.wall.run.height.max );
	const thin = edge ? edge.depth <= m.obstacle.thin : false;
	const grounded = columns.every( ( c ) => c.base - c.ground <= m.runner.step );
	const out = a0.clone().addScaledVector( dir, mid ).addScaledVector( n, 1.0 );
	const approach = course.groundAt( out.x, out.z, base + m.runner.step, base - m.runner.step ) !== null;
	const vault = ! covered && grounded && approach && height >= m.obstacle.bands[ 1 ].to && height < ( thin ? m.obstacle.bands[ 3 ].to : wallMin ) && ! prim.roles.has( 'stairs' );
	let kind = 'face', aff = 0;
	if ( height > m.runner.step && ! prim.roles.has( 'noRun' ) ) {

		const w = course.addAffordance( 'walls', {
			kind: 'wall', prim, origin: a0.clone().addScaledVector( dir, s0 ).setY( base ), u: dir.clone(), n: n.clone(),
			width: s1 - s0, base, top: faceTop, height,
			runnable: height >= m.wall.run.height.max, climbable: height >= m.wall.climb.height.max,
			vault,
			// A wall that stops short of the ground (an overhang) is not run up to from below.
			hanging: ! grounded,
			prev: null, next: null,
		} );
		// Runner Vision never turns a wall red (METRICS, Colours).
		w.usable = false;
		if ( w.climbable ) {

			kind = 'wall';
			aff = w.index;

		}

	}

	if ( vault ) {

		kind = 'vault';
		aff = edge ? edge.index : aff;

	}

	if ( prim.roles.has( 'noRun' ) ) kind = 'noRun';
	if ( prim.roles.has( 'stairs' ) ) kind = 'face';
	prim.faces.push( { n, dir, a0, s0, s1, top, bottom, base, faceTop, kind, aff } );

}

// Chains walls end to end: the next wall in the same plane, with the same top, starting where this one ends.
function linkWalls( course ) {

	const walls = course.walls;
	for ( const w of walls ) {

		const ex = w.origin.x + w.u.x * w.width, ez = w.origin.z + w.u.z * w.width;
		for ( const v of walls ) {

			if ( v === w || v.prev || w.u.dot( v.u ) < 0.999 || Math.abs( v.top - w.top ) > 0.05 ) continue;
			const off = ( v.origin.x - w.origin.x ) * w.n.x + ( v.origin.z - w.origin.z ) * w.n.z;
			const gap = Math.hypot( v.origin.x - ex, v.origin.z - ez );
			if ( Math.abs( off ) > 0.01 || gap > 0.02 ) continue;
			w.next = v;
			v.prev = w;
			break;

		}

	}

}

// Chains edges at the same height end to end, for the shimmy: straight on across a gap a hand bridges, or round a
// corner where two edges meet. `cornerB` (this edge's end) and the next edge's `cornerA` say which way the corner
// turns: round an outside corner the shimmy carries on, into an inside one it stops.
function linkCorners( course ) {

	const gap = course.metrics.ledge.shimmy.gap;
	const edges = course.edges;
	for ( const e of edges ) {

		let best = null, bd = Infinity, type = null;
		for ( const f of edges ) {

			if ( f === e || Math.abs( f.y - e.y ) > 0.05 ) continue;
			const d = e.b.distanceTo( f.a );
			if ( d > gap + 0.01 || d >= bd ) continue;
			if ( e.dir.dot( f.dir ) > 0.99 ) {

				const off = Math.abs( ( f.a.x - e.b.x ) * e.n.x + ( f.a.z - e.b.z ) * e.n.z );
				if ( off > 0.05 ) continue;
				best = f; bd = d; type = null;

			} else if ( d <= 0.06 ) {

				best = f; bd = d;
				type = e.dir.x * f.dir.z - e.dir.z * f.dir.x < 0 ? 'outside' : 'inside';

			}

		}

		if ( best && ! best.prev ) {

			e.next = best;
			best.prev = e;
			e.cornerB = best.cornerA = type;

		}

	}

}
