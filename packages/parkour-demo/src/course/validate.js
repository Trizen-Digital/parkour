/**
 * The course validator: every link of a course's route checked against the level metrics, so a level that passes
 * plays. Each move has its check (`CHECKS`), which measures the course where the link is (the gap and the landing past
 * it, the run-up behind it, the obstacle's height and depth, the clearance over the path…) and judges it with the
 * metrics' rules (`reach.js`) at the speed the runner arrives with.
 *
 * A check **fails** a link (a violation: the move can't be made as built) or **warns** (it can, but not comfortably).
 * Lanes built to fail (`params.expect: 'fail'`, in the family test courses) are meant to: their violations are listed
 * as expected, and one with none is a violation itself. The generator rerolls the challenges that fail.
 */
import * as THREE from 'three/webgpu';
import { metrics as M } from './metrics.js';
import { barSwing, barToBar, beamGetOn, beamKind, clearance, corridor, doorFit, gapReach, grade, ladderFit, landingKind, obstacleClass, pipeFit, slopeKind, springboardFit, switchFit, transfer, vaultLanding, wallclimb, wallrun, wallrunLength, zipline } from './reach.js';

const _p = new THREE.Vector3(), _q = new THREE.Vector3();
const STEP = M.runner.step;

function groundY( c, x, z, top, bottom = - Infinity, r = 0 ) {

	const g = c.groundAt( x, z, top, bottom, r );
	return g ? g.y : null;

}

// The horizontal direction from a to b (+z when they are one above the other).
function heading( a, b ) {

	const v = new THREE.Vector3( b.x - a.x, 0, b.z - a.z );
	const l = v.length();
	return l > 1e-6 ? v.divideScalar( l ) : v.set( 0, 0, 1 );

}

// How far the ground runs on from p along dir at height y (within a step), clear at the knees, the chest and the head.
function runway( c, p, dir, y, max = 30 ) {

	let d = 0;
	for ( ; d < max; d += 0.1 ) {

		const x = p.x + dir.x * d, z = p.z + dir.z * d;
		const g = groundY( c, x, z, y + STEP, y - STEP );
		if ( g === null ) break;
		if ( c.solidAt( x, g + 0.4, z ) || c.solidAt( x, g + 1.0, z ) || c.solidAt( x, g + 1.6, z ) ) break;

	}

	return d;

}

// Looking from p along dir: where the ground at the take-off height `y0` ends (`edge`), and where ground at the
// landing height begins after it (`far`), refined to a few millimetres. `gap` is the distance between; null when the
// ground never ends.
function across( c, p, dir, y0, yLand, max = 18 ) {

	const off = ( d ) => groundY( c, p.x + dir.x * d, p.z + dir.z * d, y0 + STEP, y0 - STEP ) === null;
	const on = ( d ) => groundY( c, p.x + dir.x * d, p.z + dir.z * d, yLand + 0.4, yLand - 0.4 ) !== null;
	let edge = null;
	for ( let d = 0; d <= max; d += 0.05 ) {

		if ( off( d ) ) {

			edge = refine( off, Math.max( 0, d - 0.05 ), d );
			break;

		}

	}

	if ( edge === null ) return null;
	for ( let d = edge; d <= max; d += 0.05 ) {

		if ( ! on( d ) ) continue;
		const far = refine( on, Math.max( edge, d - 0.05 ), d );
		const g = groundY( c, p.x + dir.x * far, p.z + dir.z * far, yLand + 0.4, yLand - 0.4 ) ?? groundY( c, p.x + dir.x * d, p.z + dir.z * d, yLand + 0.4, yLand - 0.4 );
		return { edge, far, gap: far - edge, y: g, rise: g - y0, at: new THREE.Vector3( p.x + dir.x * far, g, p.z + dir.z * far ) };

	}

	return { edge, far: null, gap: Infinity };

}

// The first distance between a (where `test` is false, unless it already holds there) and b where it holds.
function refine( test, a, b ) {

	if ( test( a ) ) return a;
	for ( let i = 0; i < 10; i ++ ) {

		const m = ( a + b ) / 2;
		if ( test( m ) ) b = m;
		else a = m;

	}

	return b;

}

function closest( p, a, b, out = new THREE.Vector3() ) {

	_q.subVectors( b, a );
	const l2 = _q.lengthSq(), t = l2 > 1e-12 ? Math.max( 0, Math.min( 1, _p.subVectors( p, a ).dot( _q ) / l2 ) ) : 0;
	return out.copy( a ).addScaledVector( _q, t );

}

// Angles are judged to the hundredth of a degree, so a slope authored at a round angle is that angle.
const roundAngle = ( x ) => Math.round( x * 100 ) / 100;
// The link's affordance of a collection (and kind).
const usedBy = ( link, collection, kind ) => link.affordances.find( ( a ) => a.collection === collection && ( ! kind || a.kind === kind ) );
// Numbers in messages, to the centimetre.
const r2 = ( x ) => Number.isFinite( x ) ? Math.round( x * 100 ) / 100 : x;

// One link being checked: its ends, its direction, the speed the runner arrives at it with (the route's arrival
// speed, else the speed it was planned at, else what the move needs comfortably and at least a sprint), and the
// measurements several moves share.
class LinkCheck {

	constructor( course, link ) {

		this.c = course;
		this.link = link;
		this.from = link.from.p;
		this.to = link.to.p;
		this.dir = heading( this.from, this.to );
		this.v = link.speedIn ?? link.params.speed ?? Math.min( M.speed.max, Math.max( link.speed.comfortable, M.speed.sprint ) );

	}

	fail( message, at = this.from ) {

		this.link.violations.push( { message, at: at.clone() } );

	}

	warn( message, at = this.from ) {

		this.link.warnings.push( { message, at: at.clone() } );

	}

	// The straight run-up behind p, lined up with the move.
	runUp( p, y, need = M.jump.runUp.length ) {

		const back = this.dir.clone().negate();
		const d = runway( this.c, _p.copy( p ).addScaledVector( back, 0.15 ), back, y, need + 1 );
		if ( d < need ) this.fail( `run-up ${r2( d )} m (needs ${need} m)`, p );
		return d;

	}

	// The clear ground past a landing; a fall that wants a roll wants more of it.
	landingZone( p, y, fall = 0 ) {

		const d = runway( this.c, p, this.dir, y, 8 );
		const L = M.jump.landing;
		if ( d < L.min ) this.fail( `landing ${r2( d )} m clear (needs ${L.min})`, p );
		else if ( fall >= M.landing.run && d < L.roll ) this.warn( `landing ${r2( d )} m: a roll wants ${L.roll}`, p );
		else if ( d < L.comfortable ) this.warn( `landing ${r2( d )} m (comfortable ${L.comfortable})`, p );
		return d;

	}

	// Nothing in the flight's way, and the headroom over it.
	flight( y0 ) {

		const c = this.c;
		let low = Infinity;
		for ( const q of this.link.path.slice( 1, - 1 ) ) {

			if ( c.solidAt( q.x, q.y + 0.9, q.z ) || c.solidAt( q.x, q.y + 1.5, q.z ) ) {

				this.fail( 'something in the way of the flight', q );
				return;

			}

			low = Math.min( low, c.ceilingAt( q.x, q.z, Math.max( q.y, y0 ) + 0.05, 0.25 ) - y0 );

		}

		if ( low < M.runner.height ) this.fail( `a ceiling ${r2( low )} m over the take-off along the arc` );
		else if ( low < M.level.headroom.arc ) this.warn( `headroom ${r2( low )} m over the arc (METRICS: ${M.level.headroom.arc})` );

	}

	// The arrival speed against what the move needs.
	speed() {

		const s = this.link.speed;
		if ( ! Number.isFinite( s.min ) ) this.fail( 'no approach speed makes it' );
		else if ( this.v + 1e-6 < s.min ) this.fail( `arrives at ${r2( this.v )} m/s, needs ${r2( s.min )}` );
		else if ( this.v + 1e-6 < s.comfortable ) this.warn( `arrives at ${r2( this.v )} m/s (comfortable from ${r2( s.comfortable )})` );

	}

	// A running jump (off a springboard's step when `boost` gives it): the gap across and the landing's rise measured
	// from the edge, graded against the reach at the arrival speed; then its run-up, its landing zone and its flight.
	jump( boost = null ) {

		const link = this.link, y0 = this.from.y, yLand = this.to.y;
		const edgeAff = ! boost && link.from.affordance?.collection === 'edges' ? link.from.affordance : null;
		const start = edgeAff ? closest( this.from, edgeAff.a, edgeAff.b ).addScaledVector( this.dir, - 0.3 ) : this.from.clone();
		const g = across( this.c, start, this.dir, y0, yLand );
		if ( ! g || g.far === null ) {

			this.fail( 'no landing across' );
			return;

		}

		const rise = boost ? g.rise - boost.step : g.rise;
		const reach = gapReach( this.v, rise );
		if ( ! reach ) {

			this.fail( `the landing is ${r2( g.rise )} m up: a catch, not a landing`, g.at );
			return;

		}

		const add = boost ? M.obstacle.springboard.adds : 0;
		const r = { comfortable: reach.comfortable + add, max: reach.max + add, clearlyOut: reach.clearlyOut + add };
		const gr = grade( g.gap, r );
		if ( gr === 'out' ) this.fail( `gap ${r2( g.gap )} m at ${r2( this.v )} m/s: past Max (${r2( r.max )})`, g.at );
		else if ( gr === 'dead' ) this.fail( `gap ${r2( g.gap )} m in the dead band (${r2( r.max )}–${r2( r.clearlyOut )})`, g.at );
		else if ( gr === 'max' ) this.warn( `gap ${r2( g.gap )} m past Comfortable (${r2( r.comfortable )})`, g.at );
		this.runUp( boost ? this.from : _q.copy( start ).addScaledVector( this.dir, g.edge ), y0 );
		const fall = Math.max( 0, - g.rise );
		this.landingZone( g.at, g.y, fall );
		this.flight( y0 );

	}

}

// The low point of the clearance along a link's straight path, every 25 cm.
function passageClearance( k ) {

	let low = Infinity;
	const P = k.link.path, L = k.link.length;
	for ( let d = 0; d <= L; d += 0.25 ) {

		const p = _q.copy( P[ 0 ] ).lerp( P[ P.length - 1 ], L > 0 ? d / L : 0 );
		const y = groundY( k.c, p.x, p.z, p.y + STEP, p.y - 1 ) ?? p.y;
		low = Math.min( low, k.c.ceilingAt( p.x, p.z, y + 0.05, 0.25 ) - y );

	}

	return low;

}

const CHECKS = {

	// Headroom along the run, every metre (a bar or a cable overhead is part of the course, not a ceiling).
	run( k ) {

		const c = k.c, P = k.link.path, L = k.link.length;
		let low = Infinity;
		for ( let d = 0; d <= L; d += 1 ) {

			const p = _p.copy( P[ 0 ] ).lerp( P[ P.length - 1 ], L > 0 ? d / L : 0 );
			const y = groundY( c, p.x, p.z, p.y + STEP + 0.05, p.y - 1 ) ?? p.y;
			const top = c.ceilingAt( p.x, p.z, y + 0.05, 0.25 );
			if ( top - y >= M.runner.height && c.affordancesNear( [ 'lines' ], _q.set( p.x, top, p.z ), 0.3 ).length ) continue;
			low = Math.min( low, top - y );

		}

		if ( low < M.runner.height ) k.fail( `the run passes under ${r2( low )} m` );
		else if ( low < M.level.headroom.lane ) k.warn( `headroom ${r2( low )} m over the run (METRICS: ${M.level.headroom.lane})` );

	},

	jump( k ) {

		k.speed();
		k.jump();

	},

	// A springboard: a step's height in the metrics; then either the step in front of an obstacle it gets the runner
	// onto (when the landing edge is above and a plain jump finds no landing), or a jump boosted by the step.
	springboard( k ) {

		const obj = usedBy( k.link, 'objects', 'springboard' );
		if ( ! obj ) return k.fail( 'no springboard' );
		if ( obj.height < M.obstacle.springboard.step[ 0 ] * 0.9 || obj.height > M.obstacle.springboard.step[ 1 ] ) k.warn( `springboard ${r2( obj.height )} m (METRICS ${M.obstacle.springboard.step.join( '–' )})` );
		k.speed();
		const edge = k.link.to.affordance?.collection === 'edges' ? k.link.to.affordance : null;
		if ( edge && edge.y - k.from.y > 0.6 && ! across( k.c, k.from, k.dir, k.from.y, edge.y )?.far ) {

			const front = closest( obj.p, edge.a, edge.b ), ahead = Math.hypot( front.x - obj.p.x, front.z - obj.p.z ) - ( obj.size?.[ 2 ] ?? 0.6 ) / 2;
			const sb = springboardFit( { step: obj.height, ahead, obstacle: edge.y - k.from.y } );
			if ( ! sb.possible ) k.fail( `a ${r2( obj.height )} m step ${r2( ahead )} m in front of a ${r2( edge.y - k.from.y )} m obstacle (METRICS ${M.obstacle.springboard.step.join( '–' )} m step, ${M.obstacle.springboard.obstacle.join( '–' )} m obstacle)`, front );
			else if ( ! sb.comfortable ) k.warn( `the step ${r2( ahead )} m in front (comfortable ~${M.obstacle.springboard.ahead} m)` );
			return;

		}

		k.jump( { step: obj.height } );

	},

	wallclimbTurn( k ) {

		const wall = k.link.to.affordance?.collection === 'walls' ? k.link.to.affordance : usedBy( k.link, 'walls' );
		if ( ! wall ) return k.fail( 'no wall' );
		const height = wall.top - k.from.y;
		if ( height < M.wall.climb.height.max ) k.fail( `a ${r2( height )} m wall is too low to climb (METRICS ≥ ${M.wall.climb.height.max})` );
		const back = runway( k.c, k.to.clone(), k.dir, k.to.y, 4 );
		if ( back < 1.5 ) k.fail( 'no room to kick off back into', k.to );

	},

	pullUp( k ) {

		const a = usedBy( k.link, 'objects', 'anchor' );
		if ( ! a || a.form !== 'pullup' ) return k.fail( 'no pull-up anchor' );
		const height = a.p.y - k.from.y;
		if ( height < 2.5 || height > 9 ) k.fail( `the anchor ${r2( height )} m up (2.5–9)`, a.p );
		const edge = k.link.to.affordance?.collection === 'edges' ? k.link.to.affordance : usedBy( k.link, 'edges' );
		if ( ! edge || closest( a.p, edge.a, edge.b ).distanceTo( a.p ) > 1 ) k.fail( 'no edge at the anchor', a.p );
		else if ( ! edge.hangable || ! edge.climbable ) k.fail( 'the edge at the anchor isn\'t hung from and climbed over', a.p );

	},

	breach( k ) {

		const panel = usedBy( k.link, 'objects', 'panel' );
		if ( ! panel ) return k.fail( 'no panel' );
		if ( ! doorFit( panel ) ) k.fail( `panel ${r2( panel.width )} × ${r2( panel.height )} m (a door's METRICS ${M.door.width.join( '–' )} × ${M.door.height.join( '–' )})` );
		const behind = runway( k.c, panel.p.clone().addScaledVector( panel.n, - 0.4 ), panel.n.clone().negate(), panel.p.y, 3 );
		if ( behind < 1.5 ) k.fail( 'no room behind the panel', panel.p );

	},

	drop( k ) {

		const y0 = k.from.y, g = across( k.c, k.from, k.dir, y0, k.to.y );
		const fall = y0 - ( g?.y ?? k.to.y );
		const kind = landingKind( fall );
		if ( kind === 'fatal' ) k.fail( `a ${r2( fall )} m fall is fatal`, k.to );
		else if ( kind === 'hard' ) k.warn( `a ${r2( fall )} m fall: a hard landing without the roll`, k.to );
		if ( g?.far != null ) k.landingZone( g.at, g.y, fall );

	},

	// A vault: the obstacle's class at the arrival speed must be a vault, with its run-up, and a landing past it when
	// it is vaulted over.
	vault( k ) {

		const edge = usedBy( k.link, 'edges' );
		if ( ! edge ) return k.fail( 'no obstacle' );
		const y0 = k.from.y, height = edge.y - y0, depth = edge.depth;
		k.speed();
		const cls = obstacleClass( height, depth, k.v );
		if ( ! cls.possible || ! /vault/i.test( cls.move ?? '' ) ) k.fail( `${r2( height )} m (${r2( depth )} deep) at ${r2( k.v )} m/s is ${cls.move ?? 'not climbable'}, not a vault` );
		else if ( ! cls.comfortable ) k.warn( `${r2( height )} m: ${cls.ambiguous ? 'ambiguous depth' : `${r2( cls.margin )} m inside its band`}` );
		const face = closest( k.from, edge.a, edge.b ).setY( y0 );
		k.runUp( face, y0 );
		if ( /Over/.test( cls.move ?? '' ) ) {

			const p = face.clone().addScaledVector( k.dir, depth + 0.3 );
			const g = groundY( k.c, p.x, p.z, y0 + 0.5, y0 - 30 );
			const clear = g === null ? 0 : runway( k.c, p, k.dir, g, 3 );
			const vl = vaultLanding( { rise: ( g ?? - Infinity ) - y0, clear } );
			if ( ! vl.landing ) k[ vl.drop ? 'warn' : 'fail' ]( vl.drop ? 'a vault and a drop' : 'no landing past the vault', p );

		}

	},

	// A wallclimb at a run: what the climb does at this height, angle, speed and run-up, and that the edge at the top
	// allows it (hang from it for a climb to hang, climb over it for a climb over; out of reach fails).
	wallclimb( k ) {

		const edge = k.link.to.affordance ?? usedBy( k.link, 'edges' );
		if ( ! edge ) return k.fail( 'no edge to climb to' );
		const y0 = k.from.y, height = edge.y - y0;
		const angle = Math.acos( Math.min( 1, Math.max( - 1, - ( k.dir.x * edge.n.x + k.dir.z * edge.n.z ) ) ) ) * 180 / Math.PI;
		const face = closest( k.from, edge.a, edge.b ).setY( y0 );
		const run = runway( k.c, face.clone().addScaledVector( k.dir, - 0.4 ), k.dir.clone().negate(), y0, 6 );
		const wc = wallclimb( { height, angle, speed: k.v, runUp: run + 0.4 } );
		if ( ! wc.possible ) k.fail( `a ${r2( height )} m wallclimb at ${r2( k.v )} m/s, ${r2( angle )}°, ${r2( run )} m run-up isn't possible` );
		else if ( ! wc.comfortable ) k.warn( `wallclimb ${r2( height )} m: not comfortable` );
		if ( wc.move === 'hang' && ! edge.hangable ) k.fail( 'the edge at the top isn\'t hangable', face );
		if ( wc.move === 'over' && ! edge.climbable ) k.fail( 'the edge at the top can\'t be climbed over', face );
		if ( wc.move === 'up' ) k.fail( `the edge ${r2( height )} m up is out of reach: up the wall and back down${height < M.obstacle.unclimbable ? ` (the dead band: under ${M.obstacle.bands[ 5 ].to} or from ${M.obstacle.unclimbable} m)` : ''}`, face );

	},

	// A climb from a walk or a stand: onto the top (climbable) or a jump up to hang (hangable).
	climb( k ) {

		const to = k.link.to.affordance, edge = to?.collection === 'edges' ? to : usedBy( k.link, 'edges' );
		if ( ! edge ) return k.fail( 'no edge to climb to' );
		const y0 = k.from.y, height = edge.y - y0;
		const cls = obstacleClass( height, edge.depth, Math.min( k.v, M.obstacle.run - 0.01 ) );
		if ( cls.move !== 'climbOnto' && cls.move !== 'jumpToHang' ) k.fail( `${r2( height )} m isn't climbed from a walk (${cls.move ?? 'out of reach'})` );
		else if ( cls.move === 'climbOnto' && ! edge.climbable ) k.fail( 'the top can\'t be climbed onto' );
		else if ( cls.move === 'jumpToHang' && ! edge.hangable ) k.fail( 'the edge isn\'t hangable' );
		else if ( ! cls.comfortable ) k.warn( `${r2( height )} m: ${r2( cls.margin )} m inside its band` );

	},

	transfer( k ) {

		const a = k.link.from.affordance, b = k.link.to.affordance;
		if ( a?.collection !== 'edges' || b?.collection !== 'edges' ) return k.fail( 'a transfer goes from an edge to an edge' );
		const p = closest( k.from, a.a, a.b ), q = closest( p, b.a, b.b ), up = b.y - a.y, plan = Math.hypot( q.x - p.x, q.z - p.z );
		if ( ! transfer( { up, plan } ) ) k.fail( `the edge above is ${r2( up )} m up, ${r2( plan )} m off (METRICS ≤ ${M.ledge.transfer.up} up, ≤ ${M.ledge.transfer.plan} off)`, q );
		if ( ! b.hangable ) k.fail( 'the edge above isn\'t hangable', q );

	},

	dropToHang( k ) {

		const from = k.link.from.affordance, edge = from?.collection === 'edges' ? from : usedBy( k.link, 'edges' );
		if ( ! edge ) return k.fail( 'no edge to climb down from' );
		if ( ! edge.hangable ) k.fail( 'the edge isn\'t hangable' );
		if ( ! edge.braced ) k.fail( `no braced face under the edge (${r2( edge.face )} m of face): climbing down into a hang needs one` );

	},

	ledgeWalk( k ) {

		const edges = k.link.affordances.filter( ( a ) => a.collection === 'edges' );
		const e = edges.find( ( a ) => a.narrow );
		if ( ! e ) return k.fail( `no narrow ledge (${M.ledge.narrow.depth.join( '–' )} m deep along a wall ≥ ${M.ledge.narrow.wall} m)${edges[ 0 ] ? `: ${r2( edges[ 0 ].depth )} m deep` : ''}` );

	},

	climbUp( k ) {

		const from = k.link.from.affordance, edge = from?.collection === 'edges' ? from : usedBy( k.link, 'edges' );
		if ( ! edge ) return k.fail( 'no edge' );
		if ( ! edge.climbable ) k.fail( `the top behind the edge (${r2( edge.depth )} m, headroom ${r2( edge.headroom )}) can't be climbed onto` );
		else if ( ! edge.standable ) k.warn( 'no room to stand up on the top' );

	},

	// A shimmy from one edge to another along the chain of edges (within eight, either way, the shorter): an inside
	// corner on the way stops it.
	shimmy( k ) {

		const a = k.link.from.affordance, b = k.link.to.affordance;
		if ( ! a || ! b ) return k.fail( 'no edge to shimmy along' );
		const along = ( step, corner ) => {

			let inside = false;
			for ( let e = a, n = 0; e && n < 8; e = e[ step ], n ++ ) {

				if ( e === b ) return { inside, n };
				inside ||= e[ corner ] === 'inside';

			}

			return null;

		};

		const fwd = along( 'next', 'cornerB' ), back = along( 'prev', 'cornerA' );
		const way = a === b ? { inside: false } : fwd && back ? ( back.n < fwd.n ? back : fwd ) : fwd ?? back;
		if ( ! way ) k.fail( 'the hang and the climb-up aren\'t on one continuous edge' );
		else if ( way.inside ) k.fail( 'an inside corner stops the shimmy' );

	},

	// A wallrun: the wall's height and the entry speed, how far the run carries against the gap it crosses, the wall's
	// length round the gap, and nothing on its face along the run.
	wallrun( k ) {

		const wall = usedBy( k.link, 'walls' );
		if ( ! wall ) return k.fail( 'no wall' );
		const y0 = k.from.y, height = wall.top - y0;
		k.speed();
		const wr = wallrun( { height, angle: k.link.params.angle ?? 20, speed: k.v } );
		if ( ! wr.possible ) k.fail( `a ${r2( height )} m wall at ${r2( k.v )} m/s can't be wallrun` );
		else if ( ! wr.comfortable ) k.warn( `wallrun on ${r2( height )} m at ${r2( k.v )} m/s: not comfortable` );
		const reachLen = wallrunLength( k.v )[ 1 ], gap = k.link.params.gap ?? 0;
		if ( gap > reachLen - 1 ) k.fail( `the wallrun covers ${r2( reachLen )} m, the gap is ${r2( gap )}` );
		let span = 0;
		for ( let w = wall; w && span < 200; w = w.next ) span += w.width;
		for ( let w = wall.prev; w && span < 200; w = w.prev ) span += w.width;
		if ( span < gap + 2 ) k.fail( `the wall (${r2( span )} m) doesn't carry across the ${r2( gap )} m gap` );
		const u = wall.u, n = wall.n;
		for ( let s = 0.5; s < wall.width; s += 1 ) {

			for ( let h = M.wall.run.clear[ 0 ]; h <= M.wall.run.clear[ 1 ]; h += 0.5 ) {

				const x = wall.origin.x + u.x * s + n.x * 0.2, z = wall.origin.z + u.z * s + n.z * 0.2;
				if ( k.c.solidAt( x, y0 + h, z ) ) {

					k.warn( 'something on the wall\'s face along the run', new THREE.Vector3( x, y0 + h, z ) );
					return;

				}

			}

		}

	},

	corridor( k ) {

		const walls = k.link.affordances.filter( ( a ) => a.collection === 'walls' );
		if ( walls.length < 2 ) return k.fail( 'a corridor needs two walls' );
		const [ a, b ] = walls, width = Math.abs( ( b.origin.x - a.origin.x ) * a.n.x + ( b.origin.z - a.origin.z ) * a.n.z );
		k.speed();
		const g = corridor( width );
		if ( g === 'out' ) k.fail( `corridor ${r2( width )} m wide (METRICS ${M.wall.run.corridor.max.join( '–' )})` );
		else if ( g === 'max' ) k.warn( `corridor ${r2( width )} m wide (comfortable ${M.wall.run.corridor.comfortable.join( '–' )})` );
		for ( const w of walls ) if ( ! w.runnable || w.top - k.from.y < M.wall.run.height.max ) k.fail( 'a corridor wall too low to wallrun' );

	},

	// A pipe or a ladder: its fit, a top to climb out onto, and a foot within jumping reach of the ground.
	pipe( k ) {

		const line = usedBy( k.link, 'lines', 'pipe' ) ?? usedBy( k.link, 'lines', 'ladder' );
		if ( ! line ) return k.fail( `no ${k.link.move}` );
		if ( line.kind === 'pipe' ) {

			const tilt = Math.acos( Math.min( 1, Math.abs( line.b.y - line.a.y ) / line.a.distanceTo( line.b ) ) ) * 180 / Math.PI;
			const fit = pipeFit( { diameter: line.r * 2, wallGap: line.pipe.wallGap ?? 0, tilt } );
			if ( ! fit.ok ) k.fail( `pipe: ${Object.entries( fit ).filter( ( [ key, v ] ) => key !== 'ok' && ! v ).map( ( [ key ] ) => key ).join( ', ' )} out of METRICS` );

		} else {

			const fit = ladderFit( { rungs: line.ladder.spacing, width: line.ladder.width } );
			if ( ! fit.ok ) k.fail( 'ladder: rungs or width out of METRICS' );

		}

		const top = line.a.y > line.b.y ? line.a : line.b, foot = line.a.y > line.b.y ? line.b : line.a;
		const out = k.c.affordancesNear( [ 'edges' ], top, 0.8 ).some( ( e ) => e.climbable );
		if ( ! out ) k.fail( 'no top to climb out onto', top );
		const ground = groundY( k.c, k.from.x, k.from.z, k.from.y + STEP, k.from.y - 3 ) ?? k.from.y;
		if ( foot.y - ground > M.climb.jump.rise[ 1 ] ) k.fail( `its foot is ${r2( foot.y - ground )} m up`, foot );

	},

	// A swing: on a rope (or a rope fired at an anchor), or on a bar: the bar's height, width and clearance at the
	// arrival speed, then either the next bar's distance or the landing's place under and past the bar.
	swing( k ) {

		const rope = usedBy( k.link, 'lines', 'rope' ) ?? usedBy( k.link, 'objects', 'anchor' );
		if ( rope ) return ropeSwing( k, rope );
		const bar = usedBy( k.link, 'lines', 'bar' );
		if ( ! bar ) return k.fail( 'no bar' );
		const y0 = k.from.y, mid = bar.a.clone().lerp( bar.b, 0.5 );
		if ( k.link.from.affordance !== bar ) {

			const under = groundY( k.c, mid.x, mid.z, mid.y - bar.r - 0.05 );
			const height = mid.y - y0, width = bar.a.distanceTo( bar.b ), clear = mid.y - ( under ?? - Infinity );
			k.speed();
			const sb = barSwing( { height, width, clear, speed: k.v } );
			if ( ! sb.possible ) k.fail( `bar ${r2( height )} m over the take-off, ${r2( width )} m wide, ${r2( clear )} m clear at ${r2( k.v )} m/s: not a swing` );
			else if ( ! sb.comfortable ) k.warn( `bar ${r2( height )} m (comfortable ${M.bar.height.comfortable})` );

		}

		const next = k.link.to.affordance;
		if ( next?.kind === 'bar' && next !== bar ) {

			const m2 = next.a.clone().lerp( next.b, 0.5 ), distance = Math.hypot( m2.x - mid.x, m2.z - mid.z ), rise = m2.y - mid.y;
			if ( ! barToBar( { distance, rise } ) ) k.fail( `bar to bar ${r2( distance )} m apart, ${r2( rise )} m up (METRICS ${M.bar.barToBar.distance.join( '–' )} m, ±${M.bar.barToBar.height})`, m2 );
			return;

		}

		const fwd = ( k.to.x - mid.x ) * k.dir.x + ( k.to.z - mid.z ) * k.dir.z, below = mid.y - k.to.y;
		const R = M.bar.release;
		if ( fwd < R.forward[ 0 ] - 1 || fwd > R.forward[ 1 ] + 0.5 || below < R.below[ 0 ] || below > R.below[ 1 ] ) k.fail( `the landing is ${r2( fwd )} m on and ${r2( below )} m under the bar (METRICS ${R.forward.join( '–' )} on, ${R.below.join( '–' )} down)`, k.to );
		k.landingZone( k.to, k.to.y, Math.max( 0, below - M.runner.hang ) );

	},

	// A zipline: its slope, the cable's height over where it is caught a metre on from the take-off, the clearance
	// under the cable from there to its low end, and the landing past it.
	zipline( k ) {

		const cable = usedBy( k.link, 'lines', 'cable' );
		if ( ! cable ) return k.fail( 'no cable' );
		const { high, low } = cable.cable, slope = roundAngle( cable.cable.slope );
		const y0 = k.from.y, catchAt = k.from.clone().addScaledVector( k.dir, 1 );
		const hx = low.x - high.x, hz = low.z - high.z, h2 = hx * hx + hz * hz;
		const t = h2 > 1e-9 ? Math.max( 0, Math.min( 1, ( ( catchAt.x - high.x ) * hx + ( catchAt.z - high.z ) * hz ) / h2 ) ) : 0;
		const at = high.clone().lerp( low, t ), rise = at.y - y0;
		let clear = Infinity;
		const L = at.distanceTo( low );
		for ( let s = 0; s < L - 1; s += 0.5 ) {

			const q = _p.copy( at ).lerp( low, s / L );
			const g = groundY( k.c, q.x, q.z, q.y - 0.1 );
			if ( g !== null ) clear = Math.min( clear, q.y - g );

		}

		const land = runway( k.c, k.to, k.dir, k.to.y, 6 );
		const z = zipline( { slope, rise, clear, landing: land } );
		for ( const [ key, msg ] of [ [ 'rideable', `slope ${r2( slope )}° (METRICS ${M.zipline.slope.join( '–' )})` ], [ 'catchable', `the cable is ${r2( rise )} m over the take-off (METRICS ${M.zipline.catch.join( '–' )})` ], [ 'clear', `${r2( clear )} m under the cable (METRICS ${M.zipline.clear})` ], [ 'landing', `${r2( land )} m to land at the end (METRICS ${M.zipline.landing})` ] ] ) if ( ! z[ key ] ) k.fail( msg );

	},

	// A beam (or a wire): its width, and ground at its height at both ends to get on and off from.
	beam( k ) {

		const beam = usedBy( k.link, 'lines', 'beam' ) ?? k.link.affordances.find( ( a ) => a.kind === 'cable' && a.cable.kind === 'wire' );
		if ( ! beam ) return k.fail( 'no beam' );
		const width = beam.beam?.width ?? beam.r * 2, kind = beamKind( width );
		if ( kind === 'wide' ) k.warn( `${r2( width )} m wide: run normally, not balanced` );
		const top = Math.max( beam.a.y, beam.b.y ) + ( beam.beam ? 0 : beam.r );
		for ( const end of [ k.from, k.to ] ) {

			const g = groundY( k.c, end.x, end.z, top + 0.5, top - 2 );
			if ( g === null || ! beamGetOn( { rise: top - g } ) ) k.fail( 'no surface at the beam\'s height to walk on from', end );

		}

	},

	slide( k ) {

		const slope = usedBy( k.link, 'slopes' );
		if ( ! slope ) return k.fail( 'no slope' );
		const angle = roundAngle( slope.angle );
		if ( slopeKind( angle ) !== 'slide' ) k.fail( `${r2( angle )}° isn't a slide slope (METRICS ${M.slope.walk}–${M.slope.slide})` );
		const foot = slope.corners[ 0 ].clone().lerp( slope.corners[ 1 ], 0.5 );
		const down = new THREE.Vector3( slope.down.x, 0, slope.down.z ).normalize();
		const out = runway( k.c, foot.addScaledVector( down, 0.3 ), down, slope.bottom, 6 );
		if ( out < M.slope.runOut ) k.fail( `${r2( out )} m of run-out at the foot (METRICS ${M.slope.runOut})`, foot );

	},

	slideUnder( k ) {

		const clear = passageClearance( k );
		k.speed();
		const cl = clearance( clear + 1e-3 );
		if ( ! cl.slide ) k.fail( `${r2( clear )} m is too low to slide under (METRICS ${M.slide.under.max})` );
		else if ( ! cl.slideComfortable ) k.warn( `${r2( clear )} m to slide under (comfortable ${M.slide.under.comfortable})` );

	},

	crouch( k ) {

		const clear = passageClearance( k ), cl = clearance( clear + 1e-3 );
		if ( ! cl.crouch && ! cl.crawl ) k.fail( `${r2( clear )} m is too low to crawl through (METRICS ${M.slide.crawl})` );

	},

	door( k ) {

		const door = usedBy( k.link, 'objects', 'door' );
		if ( ! door ) return k.fail( 'no door' );
		if ( ! doorFit( door ) ) k.fail( `door ${r2( door.width )} × ${r2( door.height )} m (METRICS ${M.door.width.join( '–' )} × ${M.door.height.join( '–' )})` );
		const behind = runway( k.c, door.p.clone().addScaledVector( door.n, - 0.4 ), door.n.clone().negate(), door.p.y, 3 );
		if ( behind < 1.5 ) k.fail( 'no room behind the door', door.p );

	},

	interact( k ) {

		const obj = k.link.affordances.find( ( a ) => a.kind === 'valve' || a.kind === 'button' );
		if ( ! obj ) return;
		const floor = groundY( k.c, obj.p.x + obj.n.x * 0.6, obj.p.z + obj.n.z * 0.6, obj.p.y, obj.p.y - 3 ) ?? 0;
		const room = runway( k.c, obj.p.clone().addScaledVector( obj.n, 0.4 ).setY( floor ), obj.n, floor, 2 );
		if ( ! switchFit( { height: obj.p.y - floor, room } ) ) k.fail( `${obj.kind} at ${r2( obj.p.y - floor )} m with ${r2( room )} m to stand (METRICS ${M.switches.height.join( '–' )}, ${M.switches.room})` );

	},

};

CHECKS.ladder = CHECKS.pipe;

// A rope swing across a gap: the anchor 3–9 m above the take-off, over the gap, and the landing in the rope's swing.
function ropeSwing( k, rope ) {

	const top = rope.p ?? ( rope.a.y >= rope.b.y ? rope.a : rope.b );
	const y0 = k.from.y, height = top.y - y0;
	if ( height < 3 || height > 9 ) k.fail( `the rope's anchor ${r2( height )} m up (3–9)`, top );
	const g = across( k.c, k.from, k.dir, y0, k.to.y );
	if ( ! g || g.far === null ) return k.fail( 'no landing across' );
	const out = ( top.x - k.from.x ) * k.dir.x + ( top.z - k.from.z ) * k.dir.z;
	if ( out < g.edge - 1 || out > g.far + 1 ) k.fail( 'the anchor isn\'t over the gap', top );
	else if ( g.far - out > height + 0.5 ) k.fail( `the landing ${r2( g.far - out )} m past the anchor: out of the swing's reach (${r2( height + 0.5 )})`, g.at );
	k.landingZone( g.at, g.y, Math.max( 0, y0 - g.y ) );

}

/**
 * Checks every link of a route. Each link's `violations` and `warnings` are reset and filled.
 * @param {Course} course
 * @param {Route} [route]
 * @return {{ ok: boolean, counts: Object, violations: Array, warnings: Array, expected: Array, links: number }}
 * `counts` are links per move; each problem is `{ link, move, message, at }`.
 */
export function validate( course, route = course.route ) {

	const report = { ok: true, counts: {}, violations: [], warnings: [], expected: [], links: 0 };
	if ( ! route ) return report;
	for ( const link of route.links ) {

		link.violations = [];
		link.warnings = [];
		report.counts[ link.move ] = ( report.counts[ link.move ] ?? 0 ) + 1;
		report.links ++;
		const check = CHECKS[ link.move ];
		if ( ! check ) continue;
		try {

			check( new LinkCheck( course, link ) );

		} catch ( err ) {

			link.violations.push( { message: `check failed: ${err.message}`, at: link.from.p.clone() } );

		}

		if ( link.params.expect === 'fail' ) {

			for ( const v of link.violations ) report.expected.push( { link, move: link.move, ...v } );
			if ( ! link.violations.length && check ) report.violations.push( { link, move: link.move, message: 'expected to fail, but nothing in the course stops it', at: link.from.p.clone() } );

		} else for ( const v of link.violations ) report.violations.push( { link, move: link.move, ...v } );

		for ( const w of link.warnings ) report.warnings.push( { link, move: link.move, ...w } );

	}

	report.ok = ! report.violations.length;
	return report;

}

/**
 * A report as text: the counts, then a line per problem (✗ violation, △ warning, ○ expected).
 * @return {string}
 */
export function describe( report ) {

	const at = ( p ) => p.toArray().map( ( x ) => x.toFixed( 1 ) ).join( ', ' );
	const lines = [ `${report.links} links: ${Object.entries( report.counts ).map( ( [ k, n ] ) => `${k} ${n}` ).join( ', ' )}`, `${report.violations.length} violations, ${report.warnings.length} warnings${report.expected?.length ? `, ${report.expected.length} expected (lanes built to fail)` : ''}` ];
	for ( const v of report.violations ) lines.push( `✗ ${v.link.id} ${v.move} @ ${at( v.at )}: ${v.message}` );
	for ( const w of report.warnings ) lines.push( `△ ${w.link.id} ${w.move} @ ${at( w.at )}: ${w.message}` );
	for ( const e of report.expected ?? [] ) lines.push( `○ ${e.link.id} ${e.move} @ ${at( e.at )}: ${e.message} (expected)` );
	return lines.join( '\n' );

}
