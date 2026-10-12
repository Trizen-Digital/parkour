/**
 * Line overlays for building and checking courses: what the deriving found (edges, walls, lines, objects, slopes) and
 * the volumes; the route with the validator's findings; and the reach envelope round a point (how far a jump goes at a
 * speed, by landing height, and the obstacle bands overhead).
 */
import * as THREE from 'three/webgpu';
import { gapReach } from './reach.js';

// Affordance colours: edges by what they allow (braced and free hangs, narrow ledges, climb-onto, plain), corners
// (outside, inside), walls (runnable, climbable), lines and objects by family, slopes, volumes by kind.
const COL = {
	braced: 0xf2c12e, free: 0xef7b2a, narrow: 0x3fd0e0, climb: 0xffffff, edge: 0x9a9da0,
	outside: 0x3fa34d, inside: 0xd8282b,
	wall: 0x2f6fd0, climbWall: 0x8fb3ea,
	swing: 0xc8479b, climbLine: 0x3fa34d, balance: 0x1fa3a0,
	object: 0xd8282b, slide: 0x7fc4e8, walk: 0xffffff,
	kill: 0xd8282b, trigger: 0x3fa34d, nomove: 0x8c8f91,
};

// Gathers coloured line segments into one LineSegments.
class Lines {

	constructor() {

		this.pos = [];
		this.col = [];

	}

	line( a, b, hex ) {

		const c = _c.set( hex );
		this.pos.push( a.x, a.y, a.z, b.x, b.y, b.z );
		this.col.push( c.r, c.g, c.b, c.r, c.g, c.b );

	}

	loop( pts, hex ) {

		for ( let i = 0; i < pts.length; i ++ ) this.line( pts[ i ], pts[ ( i + 1 ) % pts.length ], hex );

	}

	cross( p, s, hex ) {

		for ( const d of [ [ s, 0, 0 ], [ 0, s, 0 ], [ 0, 0, s ] ] ) this.line( _a.set( p.x - d[ 0 ], p.y - d[ 1 ], p.z - d[ 2 ] ), _b.set( p.x + d[ 0 ], p.y + d[ 1 ], p.z + d[ 2 ] ), hex );

	}

	build( material, name ) {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.col, 3 ) );
		const l = new THREE.LineSegments( g, material );
		l.name = name;
		l.frustumCulled = false;
		return l;

	}

}

const _c = new THREE.Color(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const V = ( p ) => p.clone();

/**
 * The affordances (a group named `affordances`) and the volumes (`volumes`), each lifted a little off its surface:
 * an edge with a tick toward the drop (and a cross where it turns a corner), a wall's outline, a line with its rungs or
 * the way to its wall, an object with its facing, a slope's outline with the way down, a volume's box.
 * @param {Course} course
 * @return {THREE.Group}
 */
export function buildOverlay( course ) {

	const group = new THREE.Group();
	group.name = 'overlay';
	const L = new Lines(), up = 0.02;

	for ( const e of course.edges ) {

		const hex = e.narrow ? COL.narrow : e.hangable ? ( e.braced ? COL.braced : COL.free ) : e.climbable ? COL.climb : COL.edge;
		const a = V( e.a ).addScaledVector( e.n, 0.01 ), b = V( e.b ).addScaledVector( e.n, 0.01 );
		a.y += up; b.y += up;
		L.line( a, b, hex );
		const mid = a.clone().lerp( b, 0.5 );
		L.line( mid, mid.clone().addScaledVector( e.n, 0.3 ), hex );
		if ( e.cornerB ) L.cross( b, 0.06, COL[ e.cornerB ] );

	}

	for ( const w of course.walls ) {

		const o = V( w.origin ).addScaledVector( w.n, 0.02 ), r = o.clone().addScaledVector( w.u, w.width );
		L.loop( [ o, r, r.clone().setY( w.top ), o.clone().setY( w.top ) ], w.runnable ? COL.wall : w.climbable ? COL.climbWall : w.vault ? COL.free : COL.edge );

	}

	for ( const l of course.lines ) {

		const hex = l.kind === 'pipe' || l.kind === 'ladder' ? COL.climbLine : l.kind === 'beam' ? COL.balance : COL.swing;
		L.line( l.a, l.b, hex );
		if ( l.ladder ) {

			const u = new THREE.Vector3( l.ladder.n.z, 0, - l.ladder.n.x ).multiplyScalar( l.ladder.width / 2 );
			for ( const y of l.ladder.rungs ) L.line( V( l.a ).setY( y ).sub( u ).addScaledVector( l.ladder.n, 0.05 ), V( l.a ).setY( y ).add( u ).addScaledVector( l.ladder.n, 0.05 ), hex );

		}

		if ( l.pipe?.n ) {

			const mid = l.a.clone().lerp( l.b, 0.5 );
			L.line( mid, mid.clone().addScaledVector( l.pipe.n, 0.3 ), hex );

		}

	}

	for ( const o of course.objects ) {

		L.cross( o.p, 0.12, COL.object );
		L.line( o.p, o.p.clone().addScaledVector( o.n, 0.4 ), COL.object );

	}

	for ( const s of course.slopes ) {

		const hex = s.kind === 'slide' ? COL.slide : COL.walk;
		L.loop( s.corners.map( ( c ) => c.clone().addScaledVector( s.n, 0.02 ) ), hex );
		const mid = s.corners.reduce( ( m, c ) => m.add( c ), new THREE.Vector3() ).multiplyScalar( 0.25 ).addScaledVector( s.n, 0.03 );
		L.line( mid, mid.clone().addScaledVector( s.down, 0.8 ), hex );

	}

	const aff = L.build( course.look.lines, 'affordances' );
	group.add( aff );

	const Vl = new Lines();
	for ( const v of course.volumes ) {

		const { min, max } = v.box, hex = COL[ v.kind ] ?? COL.trigger;
		const c = ( x, y, z ) => new THREE.Vector3( x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z );
		Vl.loop( [ c( 0, 0, 0 ), c( 1, 0, 0 ), c( 1, 0, 1 ), c( 0, 0, 1 ) ], hex );
		Vl.loop( [ c( 0, 1, 0 ), c( 1, 1, 0 ), c( 1, 1, 1 ), c( 0, 1, 1 ) ], hex );
		for ( const [ x, z ] of [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ] ) Vl.line( c( x, 0, z ), c( x, 1, z ), hex );

	}

	const vol = Vl.build( course.look.lines, 'volumes' );
	group.add( vol );
	return group;

}

// Route links by move, in the graybox colours of what they use.
const MOVE = {
	run: 0x6a6d70, jump: 0xffffff, drop: 0xbfc2c4, springboard: 0xef7b2a, vault: 0xef7b2a,
	wallclimb: 0xf2c12e, climbUp: 0xf2c12e, shimmy: 0xf2c12e, climb: 0xf2c12e, transfer: 0xf2c12e, dropToHang: 0xf2c12e,
	ledgeWalk: 0x1fa3a0, wallrun: 0x2f6fd0, corridor: 0x2f6fd0,
	pipe: 0x3fa34d, ladder: 0x3fa34d, swing: 0xc8479b, zipline: 0xc8479b, beam: 0x1fa3a0, slide: 0x7fc4e8,
	slideUnder: 0xd6d7d5, crouch: 0xd6d7d5, door: 0xd8282b, interact: 0xd8282b,
};
const BAD = 0xff2020, WARN = 0xffa020;

/**
 * The route: each link's path in its move's colour (red with a violation, amber with a warning, a cross where), and
 * each node (start and finish larger).
 * @param {Course} course
 * @param {Object} [options]
 * @param {boolean} [options.runs] Draw run links that have no problem too.
 * @param {boolean} [options.problems] Only the links with problems.
 * @return {THREE.LineSegments}
 */
export function buildRouteOverlay( course, { runs = false, problems = false } = {} ) {

	const L = new Lines(), route = course.route, up = new THREE.Vector3( 0, 0.05, 0 );
	for ( const link of route.links ) {

		const bad = link.violations?.length, warn = link.warnings?.length;
		if ( problems && ! bad && ! warn ) continue;
		if ( ! runs && link.move === 'run' && ! bad ) continue;
		const hex = bad ? BAD : warn ? WARN : MOVE[ link.move ] ?? 0xffffff;
		for ( let i = 1; i < link.path.length; i ++ ) L.line( link.path[ i - 1 ].clone().add( up ), link.path[ i ].clone().add( up ), hex );
		for ( const v of link.violations ?? [] ) L.cross( v.at, 0.3, BAD );
		for ( const w of link.warnings ?? [] ) L.cross( w.at, 0.2, WARN );

	}

	for ( const n of route.nodes ) {

		if ( problems ) break;
		const hex = n.kind === 'start' ? 0x3fd06b : n.kind === 'finish' ? 0xffffff : 0x9a9da0;
		L.cross( n.p.clone().add( up ), n.kind === 'start' || n.kind === 'finish' ? 0.5 : 0.12, hex );

	}

	const lines = L.build( course.look.lines, 'route' );
	lines.renderOrder = 3;
	return lines;

}

/**
 * The reach envelope round a take-off point at an approach speed: a ring per landing rise at the Comfortable gap
 * (bright) and at Max (dim), drawn at that rise; a mast with a tick at each obstacle band's top and at clearly
 * unclimbable; and the span of edges caught from a jump.
 * @param {Course} course
 * @param {THREE.Vector3} point
 * @param {number} speed (m/s)
 * @return {THREE.LineSegments}
 */
export function buildEnvelope( course, point, speed ) {

	const L = new Lines(), M = course.metrics, seg = 64;
	const tint = { 1: 0xf2c12e, 0.5: 0xefd27a, 0: 0xffffff, '-1': 0x7fc4e8, '-2': 0x4f9fe0, '-3': 0x2f6fd0, '-5': 0x24408a };
	for ( const rise of M.jump.rises ) {

		const r = gapReach( speed, rise );
		if ( ! r || r.max <= 0 ) continue;
		for ( const [ radius, dim ] of [ [ r.comfortable, 1 ], [ r.max, 0.45 ] ] ) {

			const c = new THREE.Color( tint[ rise ] ?? 0xffffff ).multiplyScalar( dim );
			for ( let i = 0; i < seg; i ++ ) {

				const a0 = i / seg * Math.PI * 2, a1 = ( i + 1 ) / seg * Math.PI * 2;
				L.line( new THREE.Vector3( point.x + Math.cos( a0 ) * radius, point.y + rise + 0.03, point.z + Math.sin( a0 ) * radius ), new THREE.Vector3( point.x + Math.cos( a1 ) * radius, point.y + rise + 0.03, point.z + Math.sin( a1 ) * radius ), c.getHex() );

			}

		}

	}

	const O = M.obstacle, top = O.unclimbable;
	L.line( point.clone(), point.clone().setY( point.y + top ), 0xffffff );
	for ( const [ h, hex ] of [ [ O.bands[ 0 ].to, 0xbfc2c4 ], [ O.bands[ 1 ].to, 0xbfc2c4 ], [ O.bands[ 2 ].to, 0xef7b2a ], [ O.bands[ 3 ].to, 0xef7b2a ], [ O.bands[ 4 ].to, 0xf2c12e ], [ O.bands[ 5 ].to, 0xf2c12e ], [ O.unclimbable, 0xff2020 ] ] ) {

		L.line( point.clone().add( new THREE.Vector3( - 0.15, h, 0 ) ), point.clone().add( new THREE.Vector3( 0.15, h, 0 ) ), hex );
		L.line( point.clone().add( new THREE.Vector3( 0, h, - 0.15 ) ), point.clone().add( new THREE.Vector3( 0, h, 0.15 ) ), hex );

	}

	const [ c0, c1 ] = M.jump.catch.rise;
	L.line( point.clone().add( new THREE.Vector3( 0.25, c0, 0 ) ), point.clone().add( new THREE.Vector3( 0.25, c1, 0 ) ), 0xc8479b );
	const lines = L.build( course.look.lines, 'envelope' );
	lines.renderOrder = 3;
	return lines;

}
