/**
 * The level metrics as rules: what the runner reaches and what a prop must measure, read from the metrics table
 * (`metrics.js`, explained in docs/METRICS.md). The deriving, the route, the validator, the generator and the family
 * test courses all ask these, so they agree on what a course allows.
 *
 * Most rules grade against **Comfortable** (build to this), **Max** (the limit with precise input) and **Clearly out**
 * (where a target that is meant to be unreachable must sit, so it doesn't look nearly reachable).
 *
 * Every function takes the metrics last (`m`), defaulting to the table.
 */
import { metrics as M } from './metrics.js';

const lerp = ( a, b, t ) => a + ( b - a ) * t;
const within = ( x, [ lo, hi ] ) => x >= lo && x <= hi;

// Where x falls in a monotonic table `xs` (rising or falling): the index of the interval and how far into it, 0–1,
// held at the ends.
function bracket( xs, x ) {

	const n = xs.length, s = Math.sign( xs[ n - 1 ] - xs[ 0 ] );
	if ( ( x - xs[ 0 ] ) * s <= 0 ) return [ 0, 0 ];
	for ( let i = 0; i < n - 1; i ++ ) {

		if ( ( x - xs[ i + 1 ] ) * s <= 0 ) return [ i, ( x - xs[ i ] ) / ( xs[ i + 1 ] - xs[ i ] ) ];

	}

	return [ n - 2, 1 ];

}

// Piecewise-linear lookup of x in the table xs → ys.
function interpolate( x, xs, ys ) {

	const [ i, f ] = bracket( xs, x );
	return lerp( ys[ i ], ys[ i + 1 ], f );

}

/**
 * A value's grade against its limits: `comfortable`, `max`, `dead` (past Max but short of Clearly out: never place a
 * target there) or `out`.
 * @param {number} value
 * @param {{ comfortable: number, max: number, clearlyOut?: number }} limits
 * @param {number} [harder] 1 when more is harder, -1 when less is.
 * @return {string}
 */
export function grade( value, { comfortable, max, clearlyOut }, harder = 1 ) {

	const v = value * harder;
	if ( v <= comfortable * harder ) return 'comfortable';
	if ( v <= max * harder ) return 'max';
	if ( clearlyOut !== undefined && v < clearlyOut * harder ) return 'dead';
	return 'out';

}

// How long running straight takes to build to a speed on the build-up curve (Infinity past the top).
function timeToReach( v, m ) {

	const { t, v: vs } = m.speed.curve;
	if ( v <= vs[ 0 ] ) return 0;
	if ( v > vs[ vs.length - 1 ] ) return Infinity;
	return interpolate( v, vs, t );

}

// How far running straight takes to build to a speed on the build-up curve.
function runUpFor( v, m ) {

	const T = timeToReach( v, m );
	if ( T === Infinity ) return Infinity;
	const { t, v: vs } = m.speed.curve;
	let d = 0;
	for ( let i = 0; i < t.length - 1 && t[ i ] < T; i ++ ) {

		const t1 = Math.min( T, t[ i + 1 ] ), v1 = interpolate( t1, t, vs );
		d += ( vs[ i ] + v1 ) / 2 * ( t1 - t[ i ] );

	}

	return d;

}

/**
 * The speed after running straight for a distance from v0: up to the curve's first speed at the momentum
 * acceleration, then along the build-up curve (the metrics' model of speed building over a run-up).
 * @param {number} v0 (m/s)
 * @param {number} length (m)
 * @return {number} (m/s)
 */
export function speedAfterRun( v0, length, m = M ) {

	const plain = m.speed.curve.v[ 0 ], a = m.momentum.accel, top = m.speed.curve.v[ m.speed.curve.v.length - 1 ];
	let v = Math.max( 0, v0 ), L = Math.max( 0, length );
	if ( v < plain ) {

		const d = ( plain * plain - v * v ) / ( 2 * a );
		if ( L <= d ) return Math.sqrt( v * v + 2 * a * L );
		L -= d;
		v = plain;

	}

	const want = runUpFor( v, m ) + L;
	if ( want >= runUpFor( top, m ) ) return top;
	let lo = v, hi = top;
	for ( let i = 0; i < 30; i ++ ) {

		const mid = ( lo + hi ) / 2;
		if ( runUpFor( mid, m ) < want ) lo = mid;
		else hi = mid;

	}

	return ( lo + hi ) / 2;

}

/**
 * The straight run that takes the runner from v0 to v1 (m).
 */
export function runUpBetween( v0, v1, m = M ) {

	if ( v1 <= v0 ) return 0;
	const plain = m.speed.curve.v[ 0 ], a = m.momentum.accel;
	if ( v1 <= plain ) return ( v1 * v1 - v0 * v0 ) / ( 2 * a );
	const toPlain = v0 < plain ? ( plain * plain - v0 * v0 ) / ( 2 * a ) : 0;
	return toPlain + runUpFor( v1, m ) - runUpFor( Math.max( v0, plain ), m );

}

/**
 * The speed after a move that keeps, sets or changes it (`momentum.moves`: a speed vault adds, a slide's exit halves,
 * a hard landing stops), capped at top speed. A move with no rule keeps the speed.
 * @param {string} move
 * @param {number} v (m/s)
 * @return {number}
 */
export function speedAfter( move, v, m = M ) {

	const r = m.momentum.moves[ move ];
	if ( ! r ) return v;
	if ( r.set !== undefined ) return r.set;
	let out = v;
	if ( r.scale !== undefined ) out *= r.scale;
	if ( r.add !== undefined ) out = Math.max( 0, out + r.add );
	if ( r.min !== undefined ) out = Math.max( out, r.min );
	return Math.min( out, m.speed.max );

}

/**
 * How far a running jump clears at an approach speed onto a landing `rise` above the take-off: the jump table read
 * between its speeds and rises. Null above the highest rise, which is a catch, not a landing.
 * @param {number} speed (m/s)
 * @param {number} rise (m; negative is down)
 * @return {{ max: number, comfortable: number, clearlyOut: number, coil: boolean }|null} `coil`: the rise needs the
 * coil (the legs tucked) to clear.
 */
export function gapReach( speed, rise, m = M ) {

	const J = m.jump;
	if ( rise > J.rises[ 0 ] + 1e-6 ) return null;
	const [ i, fi ] = bracket( J.speeds, speed ), [ j, fj ] = bracket( J.rises, rise );
	const cell = ( r, c, k ) => J.gap[ r ][ c ]?.[ k ] ?? 0;
	const at = ( k ) => lerp( lerp( cell( j, i, k ), cell( j, i + 1, k ), fi ), lerp( cell( j + 1, i, k ), cell( j + 1, i + 1, k ), fi ), fj );
	const max = at( 0 ), comfortable = at( 1 );
	return { max, comfortable, clearlyOut: max + J.clearlyOut, coil: rise > J.coil };

}

/**
 * The slowest approach that clears a gap onto a rise: at Max and at Comfortable (null when no speed does).
 * @return {{ max: number|null, comfortable: number|null }}
 */
export function speedFor( gap, rise, m = M ) {

	const top = m.jump.speeds[ m.jump.speeds.length - 1 ];
	const solve = ( k ) => {

		const reach = ( v ) => gapReach( v, rise, m )?.[ k ] ?? 0;
		if ( reach( top ) < gap ) return null;
		if ( reach( 0 ) >= gap ) return 0;
		let lo = 0, hi = top;
		for ( let i = 0; i < 30; i ++ ) {

			const mid = ( lo + hi ) / 2;
			if ( reach( mid ) >= gap ) hi = mid;
			else lo = mid;

		}

		return hi;

	};

	return { max: solve( 'max' ), comfortable: solve( 'comfortable' ) };

}

// The obstacle bands, running or walking. Running, each band names its move (by depth where it is a pair: thin, deep);
// walking, low ones are stepped, then climbed onto, then jumped up to and hung from.
function bands( running, O ) {

	const b = O.bands;
	if ( running ) return b.map( ( x, i ) => ( { lo: i ? b[ i - 1 ].to : 0, hi: x.to, move: x.run, cHi: x.comfortable } ) );
	return [
		{ lo: 0, hi: b[ 0 ].to, move: b[ 0 ].walk },
		{ lo: b[ 0 ].to, hi: b[ 1 ].to, move: b[ 1 ].walk },
		{ lo: b[ 1 ].to, hi: O.climbOnto, move: 'climbOnto' },
		{ lo: O.climbOnto, hi: O.jumpToHang[ 1 ], move: 'jumpToHang', cLo: O.jumpToHang[ 0 ] },
	];

}

/**
 * What the runner does at an obstacle of a height over its feet, a depth of top and an approach speed.
 * @param {number} height (m)
 * @param {number} [depth] (m) Thin is vaulted over, deep is vaulted onto; between the two it is ambiguous.
 * @param {number} [speed] (m/s) Running from the obstacle run speed.
 * @return {{ move: string|null, possible: boolean, comfortable: boolean, band: Array<number>, margin: number,
 * ambiguous: boolean }} The move: `step`, `stepUp`, `vaultOver`, `vaultOnto`, `highVaultOver`, `highVaultOnto`,
 * `wallclimbOver`, `wallclimbHang`, `climbOnto`, `jumpToHang`, or null (out of reach). Comfortable: clear of the
 * band's ends by the margin, and not of an ambiguous depth where the depth decides the move.
 */
export function obstacleClass( height, depth = Infinity, speed = 0, m = M ) {

	const O = m.obstacle, running = speed >= O.run;
	const thin = depth <= O.thin, deep = depth >= O.deep, ambiguous = ! thin && ! deep;
	const list = bands( running, O );
	const b = list.find( ( x ) => height <= x.hi );
	const top = list[ list.length - 1 ].hi;
	const out = { move: null, possible: false, comfortable: false, band: b ? [ b.lo, b.hi ] : [ top, Infinity ], margin: 0, ambiguous };
	if ( ! b ) return out;
	const byDepth = Array.isArray( b.move );
	out.move = byDepth ? ( thin ? b.move[ 0 ] : b.move[ 1 ] ) : b.move;
	out.possible = out.move !== null;
	out.margin = Math.min( b.lo > 0 ? height - b.lo : Infinity, b.hi - height );
	out.comfortable = out.possible && out.margin >= O.margin && ! ( byDepth && ambiguous ) &&
		( b.cLo === undefined || height >= b.cLo ) && ( b.cHi === undefined || height <= b.cHi );
	return out;

}

/**
 * Whether a vault over lands: ground beyond within the rise band and clear for the landing length. Lower than the
 * band is a vault and a drop.
 * @return {{ landing: boolean, drop: boolean }}
 */
export function vaultLanding( { rise = 0, clear = Infinity }, m = M ) {

	const V = m.obstacle.vaultOver;
	return { landing: within( rise, V.rise ) && clear >= V.landing, drop: rise < V.rise[ 0 ] };

}

/**
 * Whether a springboard step fits in front of an obstacle: the step's height, the obstacle's, and how far ahead of it
 * the step stands.
 * @return {{ possible: boolean, comfortable: boolean }}
 */
export function springboardFit( { step, ahead = 1.1, obstacle = 1.2 }, m = M ) {

	const S = m.obstacle.springboard;
	const possible = within( step, S.step ) && within( obstacle, S.obstacle );
	return { possible, comfortable: possible && Math.abs( ahead - S.ahead ) <= 2 * m.obstacle.margin };

}

/**
 * How far a wallrun carries at an entry speed: [ least, most ] (m).
 */
export function wallrunLength( speed, m = M ) {

	const L = m.wall.run.length;
	const per = ( ys ) => ys.map( ( y, i ) => y / L.speed[ i ] );
	return [ speed * interpolate( speed, L.speed, per( L.min ) ), speed * interpolate( speed, L.speed, per( L.max ) ) ];

}

/**
 * Whether a wall is run along: its height over the run surface, the approach angle into it (°) and the entry speed.
 * @return {{ possible: boolean, comfortable: boolean }}
 */
export function wallrun( { height = Infinity, angle = 25, speed = 3.6 } = {}, m = M ) {

	const W = m.wall.run;
	const possible = height >= W.height.max && within( angle, W.angle.max ) && speed >= W.speed.max;
	const comfortable = possible && height >= W.height.comfortable && within( angle, W.angle.comfortable ) && speed >= W.speed.comfortable;
	return { possible, comfortable };

}

/**
 * A wall-to-wall corridor's width graded: `comfortable`, `max` or `out`.
 */
export function corridor( width, m = M ) {

	const C = m.wall.run.corridor;
	return within( width, C.comfortable ) ? 'comfortable' : within( width, C.max ) ? 'max' : 'out';

}

/**
 * Whether a wall is climbed at a run, and how: `over` the edge, up to a `hang`, `up` the wall and back down (the
 * edge out of reach), or a `vault` (too low to need it).
 * @param {Object} wall `height` (m), `angle` off facing it (°), `speed` (m/s), `runUp` (m).
 * @return {{ possible: boolean, comfortable: boolean, move: string }}
 */
export function wallclimb( { height, angle = 0, speed = 3.6, runUp = Infinity } = {}, m = M ) {

	const C = m.wall.climb;
	const run = obstacleClass( height, Infinity, Math.max( speed, m.obstacle.run ), m );
	const move = run.move === 'wallclimbOver' ? 'over' : run.move === 'wallclimbHang' ? 'hang' : height > run.band[ 0 ] && ! run.move ? 'up' : 'vault';
	const strides = C.runUp.max.strides * m.runner.stride;
	const possible = move !== 'vault' && height >= C.height.max && angle <= C.facing.max && runUp >= strides;
	const comfortable = possible && height >= C.height.comfortable && angle <= C.facing.comfortable &&
		runUp >= C.runUp.comfortable.length && speed >= C.runUp.comfortable.speed && ( move === 'up' || run.comfortable );
	return { possible, comfortable, move };

}

/**
 * What an edge allows, from what was measured on it (`derive.js`): hanging from it (deep enough, high enough off the
 * ground), climbing onto it (deep enough, with headroom), standing up on it, a braced hang (enough face under it),
 * walking along it as a narrow ledge (with a wall behind), and which way the runner faces on a narrow ledge.
 * @return {{ hangable: boolean, climbable: boolean, standable: boolean, braced: boolean, narrow: boolean,
 *   facing: string }}
 */
export function ledge( { depth = 0, headroom = Infinity, face = 0, drop = Infinity, wallBehind = 0 } = {}, m = M ) {

	const E = m.ledge;
	return {
		hangable: depth >= E.hang.depth && drop >= E.hang.drop,
		climbable: depth >= E.climb.depth && headroom >= E.climb.headroom,
		standable: headroom >= E.climb.stand,
		braced: face >= E.braced.face,
		narrow: within( depth, E.narrow.depth ) && wallBehind >= E.narrow.wall,
		facing: depth < E.narrow.chest ? 'chest' : 'back',
	};

}

/**
 * Whether a grab transfer reaches an edge `up` above the hands and `plan` off to the side.
 */
export function transfer( { up, plan = 0 }, m = M ) {

	return up > 0 && up <= m.ledge.transfer.up && plan <= m.ledge.transfer.plan;

}

/**
 * Whether a drainpipe is climbed: its diameter, its gap off the wall, and how far it leans from vertical (°).
 * @return {{ diameter: boolean, wallGap: boolean, vertical: boolean, ok: boolean }}
 */
export function pipeFit( { diameter, wallGap, tilt = 0 }, m = M ) {

	const P = m.pipe;
	const out = { diameter: within( diameter, P.diameter ), wallGap: within( wallGap, P.wallGap ), vertical: tilt <= P.tilt };
	out.ok = out.diameter && out.wallGap && out.vertical;
	return out;

}

/**
 * Whether a ladder is climbed: its rung spacing and width.
 * @return {{ rungs: boolean, width: boolean, ok: boolean }}
 */
export function ladderFit( { rungs, width }, m = M ) {

	const L = m.ladder;
	const out = { rungs: within( rungs, L.rungRange ), width: within( width, L.width ) };
	out.ok = out.rungs && out.width;
	return out;

}

/**
 * Whether a bar is swung on: its height over the take-off, its width, the clearance under it and the approach speed.
 * @return {{ possible: boolean, comfortable: boolean }}
 */
export function barSwing( { height, width = Infinity, clear = Infinity, speed = 3.6 }, m = M ) {

	const B = m.bar;
	const possible = within( height, B.height.max ) && width >= B.width && clear >= B.clear && speed >= B.speed;
	return { possible, comfortable: possible && Math.abs( height - B.height.comfortable ) <= 2 * m.obstacle.margin };

}

/**
 * Whether one bar is swung to from another `distance` along and `rise` higher.
 */
export function barToBar( { distance, rise = 0 }, m = M ) {

	return within( distance, m.bar.barToBar.distance ) && Math.abs( rise ) <= m.bar.barToBar.height;

}

/**
 * Whether a zipline is ridden: its slope (°, descending), the cable's height over where it is caught (and the speed
 * of a fall onto it), the clearance under it, and the landing at its end.
 * @return {{ rideable: boolean, catchable: boolean, clear: boolean, landing: boolean, ok: boolean }}
 */
export function zipline( { slope, rise = 2.3, fall = 0, clear = Infinity, landing = Infinity }, m = M ) {

	const Z = m.zipline;
	const out = { rideable: within( slope, Z.slope ), catchable: within( rise, Z.catch ) && fall <= Z.maxFall, clear: clear >= Z.clear, landing: landing >= Z.landing };
	out.ok = out.rideable && out.catchable && out.clear && out.landing;
	return out;

}

/**
 * A balance surface by its width: a `wire` (thinner than a beam), a `beam`, or `wide` (run along normally).
 */
export function beamKind( width, m = M ) {

	const [ lo, hi ] = m.balance.width;
	return width < lo ? 'wire' : width <= hi ? 'beam' : 'wide';

}

/**
 * Whether a beam is got onto: walked onto at about its height, or a standing jump onto it.
 */
export function beamGetOn( { rise = 0, jump = 0 }, m = M ) {

	return Math.abs( rise ) <= m.balance.getOn.rise || ( jump > 0 && jump <= m.balance.getOn.jump );

}

/**
 * A slope by its angle (°): `walk`ed, `slide` down, or a `wall`.
 */
export function slopeKind( angle, m = M ) {

	return angle <= m.slope.walk ? 'walk' : angle <= m.slope.slide ? 'slide' : 'wall';

}

/**
 * What the runner gets through under a clearance (m): standing, a running lane's headroom, a crouch, a slide under
 * (at Max and Comfortable), a crawl.
 */
export function clearance( height, m = M ) {

	const S = m.slide;
	return {
		stand: height >= m.runner.height,
		lane: height >= m.level.headroom.lane,
		crouch: height >= S.crouch,
		slide: height >= S.under.max,
		slideComfortable: height >= S.under.comfortable,
		crawl: height >= S.crawl,
	};

}

/**
 * How a fall lands: `run` (landed running), `deep` (run on slower), `hard` (a dead stop) or `fatal`; with the skill
 * roll, a `roll` (speed kept) from the running-landing height up.
 * @param {number} fall (m)
 * @return {string}
 */
export function landingKind( fall, { roll = false } = {}, m = M ) {

	const L = m.landing;
	if ( fall > L.hard ) return 'fatal';
	if ( fall < L.run ) return 'run';
	if ( roll ) return 'roll';
	if ( fall < L.deep ) return 'deep';
	return 'hard';

}

/**
 * Whether a door (or a panel) is a door's size.
 */
export function doorFit( { width, height }, m = M ) {

	return within( width, m.door.width ) && within( height, m.door.height );

}

/**
 * Whether a valve or a button is at hand height with room to stand in front.
 */
export function switchFit( { height, room = Infinity }, m = M ) {

	return within( height, m.switches.height ) && room >= m.switches.room;

}
