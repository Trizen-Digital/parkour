/**
 * The course generator: a run across rooftops, one challenge after another, from a seed. Buildings stand along a
 * street 30 m below; each challenge (a gap to jump, obstacles to vault, a drop, a slide slope, a door or a vent, a
 * balance beam, a wall to climb, a pipe or a ladder, a wallrun, a corridor, a swing bar, a zipline, a bar to slide
 * under, a springboard) is sized from the metrics at the speed the runner will have there, and comes with its stretch
 * of route. Every few challenges the street turns a corner.
 *
 * The same seed gives the same course. `generate` checks what it built (with the validator, in practice) and rerolls
 * only the challenges that fail: each challenge draws from its own random stream (the seed, its index and its reroll
 * count), so rerolling one leaves the others as they were.
 */
import { DEG } from '@trizen/parkour/math.js';
import { metrics as M } from './metrics.js';
import { gapReach, speedAfterRun, wallrunLength } from './reach.js';
import { SPEED_AFTER } from './routeMoves.js';

// The street's height, below the roofs at 0.
const STREET = - 30;
// A building's width across the street's direction.
const WIDTH = 8;
// The parapets along the roofs' sides: tall enough to stop the runner, too thin to stand on (METRICS).
const PARAPET = { height: 1.3, thickness: 0.25 };
// The roof heights the run keeps between: a rise or drop that would leave this band goes the other way.
const BAND = [ - 6, 14 ];

// A seeded random stream (mulberry32): numbers in [0, 1).
function prng( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// One 32-bit seed from several integers.
const hash = ( ...xs ) => xs.reduce( ( h, x ) => Math.imul( h ^ ( x | 0 ), 0x9E3779B1 ) >>> 0, 0x811C9DC5 );
const r3 = ( x ) => Math.round( x * 1000 ) / 1000;
const lerp = ( a, b, t ) => a + ( b - a ) * t;

// How often each challenge comes up: [ at difficulty 0, at difficulty 1 ], blended by the difficulty.
const CATALOGUE = {
	gap: [ 4, 3 ],
	vault: [ 3, 2 ],
	drop: [ 2, 1 ],
	slide: [ 1, 1 ],
	door: [ 1.5, 1 ],
	beam: [ 1, 1 ],
	climb: [ 1, 2 ],
	pipe: [ 0.5, 1.5 ],
	wallrun: [ 0.3, 2 ],
	corridor: [ 0, 1.2 ],
	swing: [ 0.3, 1.5 ],
	zipline: [ 0.5, 1.2 ],
	slideUnder: [ 0.7, 1 ],
	springboard: [ 0.3, 1.2 ],
};

// The run being built. Positions are in the street's frame: `u` across the street (+ to the left), `w` along it from
// the last corner, `y` up; `at` turns them into the course's.
class RooftopRun {

	constructor( seed, difficulty ) {

		this.seed = seed;
		this.difficulty = difficulty;
		this.prims = [];
		this.nodes = [];
		this.links = [];
		// Where the street's frame is: its origin and the way it runs.
		this.frame = { x: 0, z: 0, yaw: 0 };
		// The current roof's height, how far along the street the run has got, and the runner's speed there.
		this.y = 0;
		this.w = 0;
		this.v = 0;
		this.count = 0;
		// The building whose roof the runner is on, until it is closed.
		this.building = null;
		this.last = null;
		this.challenge = - 1;
		this.random = prng( seed );

	}

	between( a = 0, b = 1 ) {

		return a + ( b - a ) * this.random();

	}

	pick( list ) {

		return list[ Math.floor( this.random() * list.length ) ];

	}

	id( prefix ) {

		return `${prefix}${++ this.count}`;

	}

	at( u, y, w ) {

		const { x, z, yaw } = this.frame, c = Math.cos( yaw ), s = Math.sin( yaw );
		return [ r3( x + u * c + w * s ), r3( y ), r3( z - u * s + w * c ) ];

	}

	forward( sign = 1 ) {

		return [ r3( sign * Math.sin( this.frame.yaw ) ), 0, r3( sign * Math.cos( this.frame.yaw ) ) ];

	}

	// A box spanning u0–u1 across, w0–w1 along and y0–y1 up.
	box( id, u0, u1, w0, w1, y0, y1, extra = {} ) {

		const prim = { type: 'box', id, p: this.at( ( u0 + u1 ) / 2, y0, ( w0 + w1 ) / 2 ), size: [ r3( u1 - u0 ), r3( y1 - y0 ), r3( w1 - w0 ) ], yaw: r3( this.frame.yaw / DEG ), ...extra };
		this.prims.push( prim );
		return prim;

	}

	add( prim ) {

		this.prims.push( prim );
		return prim;

	}

	// Starts a building at w0, at the current roof height (with a parapet across its back with `back`).
	open( w0, { back = false } = {} ) {

		this.building = { id: this.id( 'b' ), w0, y: this.y, open: { left: [], right: [] }, back, front: false };
		return this.building;

	}

	// Ends the open building at w1: its block from the street up (no-run: its faces are not for wallruns) and the
	// parapets along its sides, left open where a challenge asked (`unwall`), and across its front with `front`.
	close( w1, { front = false } = {} ) {

		const b = this.building;
		if ( ! b ) return;
		const H = WIDTH / 2, t = PARAPET.thickness, top = b.y + PARAPET.height;
		this.box( b.id, - H, H, b.w0, w1, STREET, b.y, { roles: [ 'noRun' ] } );
		const parapet = ( id, u0, u1, w0, w1 ) => w1 - w0 > 0.05 && this.box( id, u0, u1, w0, w1, b.y, top, { roles: [ 'noRun', 'noClimb' ], look: 'noRun', lookTop: 'noRun' } );
		for ( const [ side, u0, u1 ] of [ [ 'left', H - t, H ], [ 'right', - H, - H + t ] ] ) {

			let w = b.w0;
			const gaps = b.open[ side ].filter( ( [ a, c ] ) => c > b.w0 && a < w1 ).sort( ( p, q ) => p[ 0 ] - q[ 0 ] );
			for ( const [ a, c ] of gaps ) {

				parapet( `${b.id}${side[ 0 ]}${w.toFixed( 1 )}`, u0, u1, w, Math.max( w, a ) );
				w = Math.max( w, c );

			}

			parapet( `${b.id}${side[ 0 ]}${w.toFixed( 1 )}`, u0, u1, w, w1 );

		}

		if ( b.back ) parapet( `${b.id}back`, - H, H, b.w0, b.w0 + t );
		if ( front ) parapet( `${b.id}front`, - H, H, w1 - t, w1 );
		this.building = null;

	}

	// Leaves the open building's parapet on one side open from w0 to w1 (for a wall beside the roof, or a corner).
	unwall( side, w0, w1 ) {

		this.building?.open[ side ].push( [ w0, w1 ] );

	}

	node( kind, u, y, w, ref = null ) {

		const n = { id: `n${this.nodes.length}`, p: this.at( u, y, w ), kind };
		if ( ref ) n.ref = ref;
		this.nodes.push( n );
		return n;

	}

	// Runs from the last node to this one, building speed over the distance.
	runTo( node ) {

		if ( this.last && this.last !== node ) {

			const a = this.last.p, b = node.p, L = Math.hypot( a[ 0 ] - b[ 0 ], a[ 2 ] - b[ 2 ] );
			this.links.push( { from: this.last.id, to: node.id, move: 'run', params: { challenge: this.challenge } } );
			this.v = speedAfterRun( this.v, L );

		}

		this.last = node;

	}

	// A move from the last node to this one, at the speed the runner has, which the move then changes. Its `challenge`
	// says which challenge to reroll when it fails.
	move( node, move, params = {}, refs = [] ) {

		const link = { from: this.last.id, to: node.id, move, params: { ...params, challenge: this.challenge, speed: r3( this.v ) } };
		if ( refs.length ) link.refs = refs;
		this.links.push( link );
		this.v = SPEED_AFTER[ move ]( this.v, link );
		this.last = node;
		return link;

	}

	runway( L ) {

		this.w += L;

	}

	// The run-up (whole metres, at least `min`) that builds the runner's current speed to v.
	runUpFor( v, min = 3 ) {

		let L = min;
		while ( speedAfterRun( this.v, L ) < v && L < 60 ) L += 1;
		return L;

	}

	// A change of roof height, turned round when it would leave the band.
	rise( dy ) {

		const y = this.y + dy;
		return y < BAND[ 0 ] || y > BAND[ 1 ] ? - dy : dy;

	}

	// A reference to a prim's edge nearest a point, for a route node.
	edgeRef( id, u, y, w ) {

		return { prim: id, kind: 'edges', near: this.at( u, y, w ) };

	}

}

// The challenges. Each builds its stretch of course from the current roof and leaves the run on the roof after it;
// one that can't go the way the band allows builds another instead.
const CHALLENGES = {

	// A running jump to the next roof, level, down or (fast and hard enough) half a metre up: at least 1.2 m, and from
	// 60 % of the Comfortable gap at the speed its run-up builds up to 95 % at full difficulty.
	gap( b ) {

		const R = b.between( 6, 10 ) + b.runUpFor( M.speed.sprint, 0 );
		const v = speedAfterRun( b.v, R );
		const choices = v >= M.speed.sprint && b.difficulty > 0.3 ? [ 0, 0, - 1, - 2, 0.5 ] : [ 0, 0, - 1, - 2 ];
		let rise = b.pick( choices );
		if ( b.y + rise < BAND[ 0 ] || b.y + rise > BAND[ 1 ] ) rise = 0;
		const reach = gapReach( v, rise );
		const gap = Math.max( 1.2, reach.comfortable * lerp( 0.6, 0.95, b.difficulty * b.random() ) );
		b.runway( R );
		const A = b.building, y0 = b.y, edge = b.w;
		const take = b.node( 'takeoff', 0, y0, edge, b.edgeRef( A.id, 0, y0, edge ) );
		b.runTo( take );
		b.close( edge );
		b.y += rise;
		const B = b.open( edge + gap );
		const land = b.node( 'land', 0, b.y, edge + gap + 1.5, b.edgeRef( B.id, 0, b.y, edge + gap ) );
		b.move( land, 'jump', { gap: r3( gap ), rise: r3( rise ) } );
		b.w = edge + gap + 1.5;

	},

	// One to three thin obstacles across the roof to vault over (more with difficulty), or now and then one deep block
	// to vault onto and drop off.
	vault( b ) {

		const n = 1 + Math.floor( b.random() * ( 1 + 2 * b.difficulty ) );
		const onto = b.difficulty > 0.3 && b.random() < 0.3;
		for ( let k = 0; k < ( onto ? 1 : n ); k ++ ) {

			b.runway( b.between( 6, 8 ) + b.runUpFor( M.obstacle.run + 0.3, 0 ) );
			const h = r3( b.between( 0.85, lerp( 1.1, 1.3, b.difficulty ) ) ), depth = r3( onto ? b.between( 2.5, 3.5 ) : b.between( 0.3, 0.5 ) );
			const id = b.id( 'v' ), H = WIDTH / 2 - PARAPET.thickness;
			b.box( id, - H, H, b.w, b.w + depth, b.y, b.y + h );
			const start = b.node( 'stand', 0, b.y, b.w - 1.2, b.edgeRef( id, 0, b.y + h, b.w ) );
			b.runTo( start );
			if ( onto ) {

				const top = b.node( 'land', 0, b.y + h, b.w + 1.2 );
				b.move( top, 'vault', { height: h, depth } );
				const off = b.node( 'land', 0, b.y, b.w + depth + 1.5, b.edgeRef( id, 0, b.y + h, b.w + depth ) );
				b.runTo( b.node( 'takeoff', 0, b.y + h, b.w + depth - 0.2 ) );
				b.move( off, 'drop', { fall: h, gap: 0 } );

			} else {

				const over = b.node( 'land', 0, b.y, b.w + depth + 1.5 );
				b.move( over, 'vault', { height: h, depth } );

			}

			b.w += depth + 1.5;

		}

	},

	// A drop over a short gap to a roof 2.2–4.5 m down.
	drop( b ) {

		const fall = b.between( 2.2, lerp( 3.2, 4.5, b.difficulty ) ), dy = b.rise( - fall );
		if ( dy > 0 ) return CHALLENGES.gap( b );
		const gap = b.between( 0.8, 1.5 );
		b.runway( b.between( 5, 8 ) );
		const A = b.building, edge = b.w;
		const take = b.node( 'takeoff', 0, b.y, edge, b.edgeRef( A.id, 0, b.y, edge ) );
		b.runTo( take );
		b.close( edge );
		b.y += dy;
		b.open( edge + gap );
		const land = b.node( 'land', 0, b.y, edge + gap + 2 );
		b.move( land, 'drop', { fall: r3( fall ), gap: r3( gap ) } );
		b.w = edge + gap + 2;

	},

	// A slide down a 42–52° slope from the roof's edge to a roof 2.5–4 m below.
	slide( b ) {

		const H = b.between( 2.5, 4 ), dy = b.rise( - H );
		if ( dy > 0 ) return CHALLENGES.vault( b );
		const angle = b.between( 42, 52 ), Lh = H / Math.tan( angle * DEG );
		b.runway( b.between( 4, 6 ) );
		const edge = b.w, y0 = b.y;
		const id = b.id( 's' );
		const start = b.node( 'stand', 0, y0, edge - 0.6, { prim: id, kind: 'slopes' } );
		b.runTo( start );
		b.close( edge );
		b.y -= H;
		b.open( edge );
		const c = b.at( 0, b.y, edge + Lh / 2 );
		b.add( { type: 'wedge', id, p: c, size: [ WIDTH - 2 * PARAPET.thickness, r3( H ), r3( Lh ) ], yaw: r3( b.frame.yaw / DEG + 180 ) } );
		const foot = b.node( 'land', 0, b.y, edge + Lh + 1.5 );
		b.move( foot, 'slide', { angle: r3( angle ), height: r3( H ) } );
		b.w = edge + Lh + 1.5;

	},

	// A door in a wall across the roof (mostly), or a vent 1.3 m high to crouch through.
	door( b ) {

		b.runway( b.between( 6, 9 ) );
		const H = WIDTH / 2 - PARAPET.thickness;
		if ( b.random() < 0.6 ) {

			const id = b.id( 'd' ), depth = 0.3;
			b.add( { type: 'door', id, p: b.at( 0, b.y, b.w + depth / 2 ), yaw: r3( b.frame.yaw / DEG + 180 ), width: 1.0, height: 2.2, wall: { width: 2 * H, height: 3, depth }, roles: [ 'noRun' ] } );
			const start = b.node( 'stand', 0, b.y, b.w - 1.5, { prim: id, kind: 'door' } );
			b.runTo( start );
			const through = b.node( 'land', 0, b.y, b.w + depth + 2 );
			b.move( through, 'door', { width: 1.0, height: 2.2 } );
			b.w += depth + 2;

		} else {

			const id = b.id( 'vent' ), L = b.between( 2.5, 3.5 ), clear = 1.3, half = 0.6;
			b.box( `${id}L`, - H, - half, b.w, b.w + L, b.y, b.y + 2.4, { roles: [ 'noRun', 'noClimb' ], look: 'noRun', lookTop: 'noRun' } );
			b.box( `${id}R`, half, H, b.w, b.w + L, b.y, b.y + 2.4, { roles: [ 'noRun', 'noClimb' ], look: 'noRun', lookTop: 'noRun' } );
			b.box( id, - half, half, b.w, b.w + L, b.y + clear, b.y + 2.4, { roles: [ 'noClimb' ], look: 'noRun', lookTop: 'noRun' } );
			const start = b.node( 'stand', 0, b.y, b.w - 1.5, { prim: id, kind: 'walls' } );
			b.runTo( start );
			const out = b.node( 'land', 0, b.y, b.w + L + 1.5 );
			b.move( out, 'crouch', { clear, length: r3( L ) } );
			b.w += L + 1.5;

		}

	},

	// A balance beam 4–7 m across a gap to the next roof, narrower with difficulty.
	beam( b ) {

		b.runway( b.between( 5, 7 ) );
		const gap = b.between( 4, 7 ), width = r3( lerp( 0.2, 0.1, b.difficulty ) + b.between( - 0.02, 0.02 ) );
		const edge = b.w, id = b.id( 'beam' );
		b.add( { type: 'beam', id, a: b.at( 0, b.y, edge - 0.3 ), b: b.at( 0, b.y, edge + gap + 0.3 ), width, thickness: 0.15 } );
		const start = b.node( 'stand', 0, b.y, edge - 0.6, { prim: id, kind: 'beam' } );
		b.runTo( start );
		b.close( edge );
		b.open( edge + gap );
		const end = b.node( 'land', 0, b.y, edge + gap + 1 );
		b.move( end, 'beam', { width, length: r3( gap ) } );
		b.w = edge + gap + 1;

	},

	// A wallclimb to hang from the next roof's edge, 2.9–3.2 m up, then up; harder runs shimmy along it first, round a
	// block that stands on the edge.
	climb( b ) {

		b.runway( b.between( 6, 9 ) );
		const h = b.between( 2.9, 3.2 ), dy = b.rise( h );
		if ( dy < 0 ) return CHALLENGES.drop( b );
		const edge = b.w, y0 = b.y;
		b.close( edge );
		b.y += h;
		const B = b.open( edge );
		const shimmy = b.difficulty > 0.35 && b.random() < 0.5;
		const start = b.node( 'stand', 0, y0, edge - 1.5, b.edgeRef( B.id, 0, b.y, edge ) );
		b.runTo( start );
		const hang = b.node( 'edge', 0, b.y, edge, b.edgeRef( B.id, 0, b.y, edge ) );
		b.move( hang, 'wallclimb', { height: r3( h ) } );
		let u = 0;
		if ( shimmy ) {

			const s = b.random() < 0.5 ? 1 : - 1, H = WIDTH / 2 - PARAPET.thickness;
			b.box( b.id( 'blk' ), s > 0 ? - H : - 1.2, s > 0 ? 1.2 : H, edge + 0.4, edge + 2.0, b.y, b.y + 2.2, { roles: [ 'noRun', 'noClimb' ], look: 'noRun', lookTop: 'noRun' } );
			u = s * 2.4;
			const across = b.node( 'edge', u, b.y, edge, b.edgeRef( B.id, u, b.y, edge ) );
			b.move( across, 'shimmy', { length: 2.4 } );

		}

		const top = b.node( 'land', u, b.y, edge + 1.2 );
		b.move( top, 'climbUp', {} );
		b.w = edge + 1.2;

	},

	// A drainpipe or a ladder up the face of a roof 4.5–6 m higher.
	pipe( b ) {

		b.runway( b.between( 5, 7 ) );
		const h = b.between( 4.5, 6 ), dy = b.rise( h );
		if ( dy < 0 ) return CHALLENGES.slide( b );
		const edge = b.w, y0 = b.y, u = b.pick( [ - 1.5, 0, 1.5 ] ), ladder = b.random() < 0.5, id = b.id( ladder ? 'lad' : 'pipe' );
		b.close( edge );
		b.y += h;
		b.open( edge );
		if ( ladder ) b.add( { type: 'ladder', id, p: b.at( u, y0, edge - 0.15 ), h: r3( h ), yaw: r3( b.frame.yaw / DEG + 180 ), width: 0.5 } );
		else b.add( { type: 'pipe', id, a: b.at( u, y0, edge - 0.15 ), b: b.at( u, b.y, edge - 0.15 ), r: 0.06, n: b.forward( - 1 ) } );
		const foot = b.node( 'line', u, y0, edge - 0.7, { prim: id } );
		b.runTo( foot );
		const top = b.node( 'land', u, b.y, edge + 1.2 );
		b.move( top, ladder ? 'ladder' : 'pipe', { height: r3( h ) } );
		b.w = edge + 1.2;

	},

	// A wallrun along a wall beside the roof, across a gap a jump would not clear but the wallrun carries.
	wallrun( b ) {

		const R = b.between( 8, 11 ) + b.runUpFor( M.wall.run.speed.comfortable + 0.5, 0 );
		const v = speedAfterRun( b.v, R ), side = b.random() < 0.5 ? 'left' : 'right', s = side === 'left' ? 1 : - 1;
		const reach = gapReach( v, 0 ).max, along = wallrunLength( v )[ 0 ];
		const gap = Math.min( Math.max( reach + 0.5, 3.5 ), along - 0.5 );
		b.runway( R );
		const edge = b.w, H = WIDTH / 2, top = b.y + b.between( 3.4, 4 ), id = b.id( 'wr' );
		b.box( id, s > 0 ? H : - H - 0.4, s > 0 ? H + 0.4 : - H, edge - 5, edge + gap + 5, STREET, top, {} );
		b.unwall( side, edge - 5, edge );
		const start = b.node( 'wall', s * ( H - 1.2 ), b.y, edge - 3, { prim: id, kind: 'walls', near: b.at( s * H, b.y + 1.5, edge - 2 ) } );
		b.runTo( start );
		b.close( edge );
		b.open( edge + gap );
		b.unwall( side, edge + gap, edge + gap + 5 );
		const land = b.node( 'land', 0, b.y, edge + gap + 6 );
		b.move( land, 'wallrun', { height: r3( top - b.y ), gap: r3( gap ), angle: 20, side }, [ { prim: id, kind: 'walls', near: b.at( s * H, b.y + 1.5, edge + gap / 2 ) } ] );
		b.w = edge + gap + 6;

	},

	// Two walls 3–4 m apart over a gap: wallrun, push off to the other wall, wallrun out.
	corridor( b ) {

		const R = b.between( 9, 12 ) + b.runUpFor( M.wall.run.speed.comfortable + 0.5, 0 );
		b.runway( R );
		const width = b.between( 3, 4 ), gap = b.between( 5.5, 7 ), edge = b.w, top = b.y + 4, half = width / 2;
		const L = b.id( 'cw' ), Rr = b.id( 'cw' );
		b.box( L, half, half + 0.4, edge - 4, edge + gap + 4, STREET, top, {} );
		b.box( Rr, - half - 0.4, - half, edge - 4, edge + gap + 4, STREET, top, {} );
		const start = b.node( 'wall', 0, b.y, edge - 3, { prim: L, kind: 'walls', near: b.at( half, b.y + 1.5, edge ) } );
		b.runTo( start );
		b.close( edge );
		b.open( edge + gap );
		const land = b.node( 'land', 0, b.y, edge + gap + 5 );
		b.move( land, 'corridor', { width: r3( width ), gap: r3( gap ), height: 4 }, [ { prim: Rr, kind: 'walls', near: b.at( - half, b.y + 1.5, edge + gap / 2 ) } ] );
		b.w = edge + gap + 5;

	},

	// A swing bar on posts 1.2 m past the roof's edge, 2.25–2.5 m over it, released onto a roof below.
	swing( b ) {

		b.runway( b.between( 8, 11 ) + b.runUpFor( M.bar.speed + 0.5, 0 ) );
		const hb = b.between( 2.25, 2.5 ), below = b.between( 2.6, 3.4 ), dy = b.rise( hb - below );
		if ( dy !== hb - below ) return CHALLENGES.gap( b );
		const edge = b.w, out = 1.2, id = b.id( 'bar' ), y0 = b.y, barY = y0 + hb;
		b.add( { type: 'bar', id, a: b.at( - 1.3, barY, edge + out ), b: b.at( 1.3, barY, edge + out ), r: 0.025, posts: true } );
		const take = b.node( 'takeoff', 0, y0, edge - 0.4, { prim: id } );
		b.runTo( take );
		b.close( edge );
		b.y += dy;
		const near = edge + out + 2.6;
		b.open( near );
		const land = b.node( 'land', 0, b.y, near + 1.4 );
		b.move( land, 'swing', { height: r3( hb ), width: 2.6, forward: r3( near + 1.4 - edge - out ), below: r3( below ) } );
		b.w = near + 1.4;

	},

	// A zipline 13–19 m long at 10–18°, caught 2.3 m over the roof's edge, down to a roof under its low end.
	zipline( b ) {

		const slope = b.between( 10, 18 ), span = b.between( 13, 19 ), t = Math.tan( slope * DEG );
		const drop = span * t + M.zipline.catch[ 0 ] + 0.3 - 2.3;
		if ( b.y - drop < BAND[ 0 ] ) return CHALLENGES.climb( b );
		b.runway( b.between( 6, 8 ) );
		const edge = b.w, y0 = b.y, id = b.id( 'zip' );
		const high = b.at( 0, y0 + 2.3 + 1.5 * t, edge - 1.5 ), low = b.at( 0, y0 + 2.3 - span * t, edge + span );
		b.add( { type: 'cable', id, a: high, b: low, anchors: true } );
		const take = b.node( 'takeoff', 0, y0, edge - 0.4, { prim: id } );
		b.runTo( take );
		b.close( edge );
		b.y = low[ 1 ] - 2.6;
		b.open( edge + span - 6 );
		const land = b.node( 'land', 0, b.y, edge + span + 2 );
		b.move( land, 'zipline', { slope: r3( slope ), span: r3( span ), rise: 2.3 } );
		b.w = edge + span + 2;

	},

	// A duct across the roof to slide under, 1.3 m clear (1.1 m at full difficulty).
	slideUnder( b ) {

		b.runway( b.between( 7, 10 ) + b.runUpFor( M.slide.speed + 0.3, 0 ) );
		const clear = r3( lerp( 1.3, 1.1, b.difficulty ) ), id = b.id( 'duct' ), H = WIDTH / 2 - PARAPET.thickness;
		b.box( id, - H, H, b.w, b.w + 0.5, b.y + clear, b.y + clear + 0.6, { roles: [ 'noClimb' ], look: 'face', lookTop: 'face' } );
		const start = b.node( 'stand', 0, b.y, b.w - 2.5, { prim: id, kind: 'walls' } );
		b.runTo( start );
		const out = b.node( 'land', 0, b.y, b.w + 2.5 );
		b.move( out, 'slideUnder', { clear } );
		b.w += 2.5;

	},

	// A red plank at the roof's edge, up to a roof 1.2–1.5 m higher across a short gap.
	springboard( b ) {

		b.runway( b.between( 9, 12 ) + b.runUpFor( M.speed.freerun, 0 ) );
		const rise = b.rise( b.between( 1.2, 1.5 ) );
		if ( rise < 0 ) return CHALLENGES.gap( b );
		const step = 0.5, gap = b.between( 1.6, 2.1 ), edge = b.w, id = b.id( 'spr' ), y0 = b.y;
		b.add( { type: 'springboard', id, form: 'plank', p: b.at( 0, y0, edge - 0.7 ), size: [ 1.6, step, 1.3 ], yaw: r3( b.frame.yaw / DEG ) } );
		const take = b.node( 'takeoff', 0, y0, edge - 1.6, { prim: id, kind: 'springboard' } );
		b.runTo( take );
		b.close( edge );
		b.y += rise;
		const B = b.open( edge + gap );
		const land = b.node( 'land', 0, b.y, edge + gap + 1.5, b.edgeRef( B.id, 0, b.y, edge + gap ) );
		b.move( land, 'springboard', { gap: r3( gap ), rise: r3( rise ), step } );
		b.w = edge + gap + 1.5;

	},

};

// A corner: the street turns a quarter left (dir 1) or right (-1) over a pad at the end of this roof, which carries on
// as the next building's start; the runner slows for it.
function turn( b, dir ) {

	b.runway( 3 );
	const H = WIDTH / 2, corner = b.w + H, side = dir > 0 ? 'left' : 'right';
	b.unwall( side, corner - H, corner + H );
	const pad = b.node( 'stand', 0, b.y, corner );
	b.runTo( pad );
	b.close( corner + H, { front: true } );
	const [ x, , z ] = b.at( 0, b.y, corner );
	b.frame = { x, z, yaw: b.frame.yaw + dir * Math.PI / 2 };
	b.w = 0;
	b.open( H );
	b.v = Math.min( b.v, 4.5 );

}

/**
 * Builds a course from a seed.
 * @param {Object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.length] How many challenges.
 * @param {number} [options.difficulty] 0–1: which challenges come up and how hard each is.
 * @param {Object} [options.rerolls] How many times to reroll each challenge, by index.
 * @return {Object} A course definition (`generator` records the options).
 */
export function build( { seed = 1, length = 12, difficulty = 0.4, rerolls = {} } = {} ) {

	const b = new RooftopRun( seed, difficulty );
	b.open( - 8, { back: true } );
	b.w = - 5;
	const start = b.node( 'start', 0, 0, - 5 );
	b.last = start;
	let sinceTurn = 0, heading = 0;
	for ( let i = 0; i < length; i ++ ) {

		b.challenge = i;
		b.random = prng( hash( seed, i, rerolls[ i ] ?? 0 ) );
		// A corner after a few challenges; once turned, more likely, and back the other way, so the run zigzags on.
		if ( sinceTurn >= ( heading ? 2 : 3 ) && b.random() < ( heading ? 0.6 : 0.35 ) ) {

			const dir = heading ? - heading : ( b.random() < 0.5 ? 1 : - 1 );
			turn( b, dir );
			heading += dir;
			sinceTurn = 0;

		}

		const weights = Object.entries( CATALOGUE ).map( ( [ k, [ w0, w1 ] ] ) => [ k, lerp( w0, w1, difficulty ) ] );
		const total = weights.reduce( ( s, [ , w ] ) => s + w, 0 );
		let x = b.random() * total, kind = weights[ 0 ][ 0 ];
		for ( const [ k, w ] of weights ) {

			if ( ( x -= w ) <= 0 ) {

				kind = k;
				break;

			}

		}

		CHALLENGES[ kind ]( b );
		sinceTurn ++;

	}

	b.challenge = length;
	b.runway( 10 );
	const finish = b.node( 'finish', 0, b.y, b.w );
	b.runTo( finish );
	const [ fx, fy, fz ] = b.at( 0, b.y, b.w - 1 ), [ gx, , gz ] = b.at( 0, b.y, b.w + 1 );
	b.close( b.w + 3, { front: true } );
	b.prims.push(
		{ type: 'box', id: 'street', min: [ - 2000, STREET - 1, - 2000 ], max: [ 2000, STREET, 2000 ], roles: [ 'out' ] },
		{ type: 'volume', id: 'fall', kind: 'kill', min: [ - 2000, STREET - 0.5, - 2000 ], max: [ 2000, STREET + 3, 2000 ] },
		{ type: 'volume', id: 'finish', kind: 'trigger', name: 'finish', min: [ Math.min( fx, gx ) - WIDTH / 2, fy, Math.min( fz, gz ) - WIDTH / 2 ], max: [ Math.max( fx, gx ) + WIDTH / 2, fy + 2.5, Math.max( fz, gz ) + WIDTH / 2 ] },
	);
	return {
		name: `generated_${seed}`,
		about: `Generated: seed ${seed}, ${length} challenges, difficulty ${difficulty}.`,
		generator: { seed, length, difficulty, rerolls },
		spawn: { p: [ 0, 0, - 5 ], yaw: 0 },
		prims: b.prims,
		route: { nodes: b.nodes, links: b.links },
	};

}

/**
 * Builds a course and rerolls the challenges a check fails, up to `tries` times.
 * @param {Object} [options] As `build`, and:
 * @param {Function|null} [options.check] `( def ) => [ challenge indices that fail ]`.
 * @param {number} [options.tries]
 * @return {{ def: Object, failed: Array<number>, tries: number }} The last course built and what still failed.
 */
export function generate( { seed = 1, length = 12, difficulty = 0.4, check = null, tries = 6 } = {} ) {

	const rerolls = {};
	let def = null, failed = [];
	for ( let k = 0; k < tries; k ++ ) {

		def = build( { seed, length, difficulty, rerolls } );
		if ( ! check ) break;
		failed = check( def );
		if ( ! failed.length ) return { def, failed, tries: k + 1 };
		for ( const i of failed ) rerolls[ i ] = ( rerolls[ i ] ?? 0 ) + 1;

	}

	return { def, failed, tries };

}
