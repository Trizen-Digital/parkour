/**
 * The family test courses: one course per family of moves, each a row of lanes that try one move at the sizes the
 * metrics give it, at Comfortable and at Max and just past what is possible (those lanes are built to fail). Their
 * numbers come from the metrics' rules (`reach.js`), so the courses follow the metrics when they change.
 *
 * `tools/courses/write-families.mjs` writes them to `public/courses/test_<family>.json`. A lane says how to run it:
 * where to start, how to hold the stick (`drive`: `stand`, `hold` at a walk, `full`), what to press (`press`: `up`
 * jumps, `down`, `interact`, `quickturn`, `attack`; `stop` lets go of the stick) `at` how far before its feature, and
 * what to do `then`. The lane driver (qa/lanes.js) and Easy's lane check (tools/easy/lanes.mjs) run them; a lane's
 * route nodes are its stretch of the course's route, which the validator checks.
 */
import { metrics as M } from './metrics.js';
import { barSwing, barToBar, beamKind, gapReach, landingKind, obstacleClass, runUpBetween, slopeKind, speedAfterRun, transfer, wallclimb, wallrun, zipline } from './reach.js';

// Course files are written to the millimetre.
const r3 = ( x ) => Math.round( x * 1000 ) / 1000;
const v3 = ( a ) => a.map( r3 );

// How a lane holds the stick for an approach speed: standing still, held at a walk or jog, or full (building speed).
const driveFor = ( v ) => v <= 0 ? 'stand' : v <= M.speed.run ? 'hold' : 'full';

// References to a prim's affordances, in the course file's form: its edge or wall nearest a point, or its affordance
// of a kind.
const edge = ( prim, near ) => ( { prim, kind: 'edges', near: v3( near ) } );
const wall = ( prim, near ) => ( { prim, kind: 'walls', near: v3( near ) } );
const item = ( prim, kind ) => ( { prim, kind } );

// A test course being written: its prims, its lanes and its route.
class TestCourse {

	constructor( name, about ) {

		this.def = { name, about, spawn: null, prims: [], lanes: [], route: { nodes: [], links: [] } };
		this.count = {};

	}

	// Ids by kind of thing: roof1, roof2, wall1…
	id( base ) {

		this.count[ base ] = ( this.count[ base ] ?? 0 ) + 1;
		return `${base}${this.count[ base ]}`;

	}

	box( base, min, max, extra = {} ) {

		const id = this.id( base );
		this.def.prims.push( { type: 'box', id, min: v3( min ), max: v3( max ), ...extra } );
		return id;

	}

	add( prim ) {

		const id = prim.id ?? this.id( prim.type );
		this.def.prims.push( { type: prim.type, id, ...prim } );
		return id;

	}

	// Adds a lane and its stretch of route: a node at its start and one per step (`{ move, to, kind, ref, refs, params,
	// test }`), each linked from the one before. The step marked `test` is the move the lane is about; when the lane is
	// built to fail, so is that link.
	lane( lane, steps ) {

		const i = this.def.lanes.length, R = this.def.route, ids = [ `L${i}` ];
		R.nodes.push( { id: ids[ 0 ], p: v3( lane.start ), kind: 'stand' } );
		steps.forEach( ( s, k ) => {

			const id = `L${i}.${k + 1}`;
			R.nodes.push( { id, p: v3( s.to ), kind: s.kind ?? 'stand', ref: s.ref } );
			const params = { speed: lane.speed, ...s.params, lane: i };
			if ( s.test && lane.expect === 'fail' ) params.expect = 'fail';
			R.links.push( { from: ids[ k ], to: id, move: s.move, params, refs: s.refs } );
			ids.push( id );

		} );

		const { name, family, move, expect, start, yaw = 0, drive, speed, runUp, feature, press = null, at = 0, then, note, ...params } = lane;
		this.def.lanes.push( { name, family, move, expect, start: v3( start ), yaw, drive, speed: r3( speed ), runUp: r3( runUp ), feature: v3( feature ), press, at: r3( at ), then, note, ...params, nodes: ids } );

	}

	// A metre-thick floor slab with its top at y.
	floor( x0, x1, z0, z1, y = 0 ) {

		return this.box( 'floor', [ x0, y - 1, z0 ], [ x1, y, z1 ] );

	}

	walkway( x0, x1, z0, z1, y, base = y - 1 ) {

		return this.box( 'walkway', [ x0, base, z0 ], [ x1, y, z1 ] );

	}

	// A flight of stairs (rises of about 25 cm, 30 cm treads) climbing along yaw from y0 to `top` ([ x, z ]) at y1.
	stairsUp( top, y0, y1, yaw ) {

		const steps = Math.max( 1, Math.round( ( y1 - y0 ) / 0.25 ) ), L = steps * 0.3, a = yaw * Math.PI / 180;
		return this.add( { type: 'stairs', p: v3( [ top[ 0 ] - Math.sin( a ) * L, y0, top[ 1 ] - Math.cos( a ) * L ] ), yaw, width: 2, steps, rise: r3( ( y1 - y0 ) / steps ), run: 0.3 } );

	}

	// Finishes the course: a kill volume 20 m under its lowest point and 30 m past it all round, and the spawn at the
	// first lane's start.
	done() {

		const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
		for ( const p of this.def.prims ) {

			for ( const q of [ p.min, p.max, p.a, p.b, p.p ] ) {

				if ( q ) for ( let j = 0; j < 3; j ++ ) {

					lo[ j ] = Math.min( lo[ j ], q[ j ] );
					hi[ j ] = Math.max( hi[ j ], q[ j ] );

				}

			}

		}

		this.def.prims.push( { type: 'volume', id: 'below', kind: 'kill', min: [ lo[ 0 ] - 30, lo[ 1 ] - 22, lo[ 2 ] - 30 ], max: [ hi[ 0 ] + 30, lo[ 1 ] - 20, hi[ 2 ] + 30 ] } );
		const L = this.def.lanes[ 0 ];
		this.def.spawn = { p: L.start, yaw: L.yaw };
		return this.def;

	}

}

// Gaps: per approach speed, per landing rise, a lane at Comfortable, at Max and past Clearly out.
export function gaps() {

	const c = new TestCourse( 'test_gaps', 'Running jumps across gaps, one block of lanes per speed band (standing, 3.0 m/s held, and 3.6, 5.0 and 7.2 m/s from full stick over the run-up that builds them, plus 5 % and 1 m for the start), each landing height from +1 to -3 m at Comfortable and at Max (1 cm inside each) and 10 cm past Clearly out (expect fail). Roofs 4 m wide, take-offs at 0 over a pit 5 m down, landings 6 m deep. Up 1 m before the edge (standing: at it); +1 m landings add the coil.' );
	const pit = - 5, W = 4;
	let x = 0;
	for ( const v of M.jump.speeds ) {

		const drive = driveFor( v );
		const run = drive === 'stand' ? 0.4 : drive === 'hold' ? 4 : Math.max( 2.5, runUpBetween( 0, v ) + 0.5 );
		const depth = Math.max( run + 1, 5 );
		for ( const rise of [ 1, 0.5, 0, - 1, - 2, - 3 ] ) {

			const r = gapReach( v, rise );
			if ( ! r || r.max <= 0 ) continue;
			for ( const [ grade, gap, expect ] of [ [ 'comfortable', r.comfortable - 0.01, 'pass' ], [ 'max', r.max - 0.01, 'pass' ], [ 'out', r.clearlyOut + 0.1, 'fail' ] ] ) {

				const cx = x + W / 2;
				const take = c.box( 'roof', [ x, pit, 0 ], [ x + W, 0, depth ] );
				const land = c.box( 'roof', [ x, pit, depth + gap ], [ x + W, rise, depth + gap + 6 ] );
				c.lane( {
					name: `${v} m/s: ${r3( gap )} m to ${rise > 0 ? '+' : ''}${rise} m (${grade})`, family: 'jumps', move: 'jump', expect,
					start: [ cx, 0, depth - run ], drive, speed: v, runUp: run, feature: [ cx, 0, depth ],
					press: 'up', at: drive === 'stand' ? run : Math.min( 1, run / 2 ),
					then: rise > M.jump.coil ? [ { press: 'down', on: 'takeoff', s: 0.15 } ] : undefined,
					gap: r3( gap ), rise, grade,
				}, [
					{ move: 'run', to: [ cx, 0, depth - 0.3 ], kind: 'takeoff', ref: edge( take, [ cx, 0, depth ] ) },
					{ move: 'jump', to: [ cx, rise, depth + gap + 1.5 ], kind: 'land', ref: edge( land, [ cx, rise, depth + gap ] ), params: { gap: r3( gap ), rise }, test: true },
				] );
				x += W + 2;

			}

		}

		c.stairsUp( [ x + 4, 0 ], pit, 0, 180 );
		x += 10;

	}

	c.box( 'pit', [ - 10, pit - 1, - 10 ], [ x, pit, 80 ], { roles: [ 'out' ] } );
	c.walkway( - 10, x, - 10, 0, 0, pit );
	c.stairsUp( [ - 6, 0 ], pit, 0, 180 );
	return c.done();

}

// Obstacles by height: at a run (thin and deep), walking, wallclimbs; then calling a vault off by steering away or
// letting go, and steering onto another obstacle.
export function vaults() {

	const c = new TestCourse( 'test_vaults', 'Obstacle heights over the feet. At a run (8 m of full stick): 0.4-2.2 m thin (0.4 m deep: step up, vault over, high vault over) and deep (3 m: vault onto, high vault onto). Walking (1 m/s held): climb onto 0.8-1.9 m, jump to hang 2.1-2.6 m, 2.9 m out of reach (expect fail). At a run at 4 m deep walls: wallclimb over 2.5 and 2.8, to hang 3.0-3.6 (then Up climbs up), 3.9 (the dead band) and 4.2 (clearly unclimbable) fail. Up 1.2 m before the face (walking: 0.6 m).' );
	const run = 8, v = r3( speedAfterRun( 0, run ) );
	let x = 0;

	for ( const [ depth, heights ] of [ [ 0.4, [ 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2 ] ], [ 3, [ 0.7, 0.9, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2 ] ] ] ) {

		for ( const h of heights ) {

			const cx = x + 1.5, z0 = run + 0.5, cls = obstacleClass( h, depth, v );
			const id = c.box( 'block', [ x, 0, z0 ], [ x + 3, h, z0 + depth ] );
			const step = cls.move === 'step' || cls.move === 'stepUp', over = /Over/.test( cls.move );
			c.lane( {
				name: `${h} m, ${depth} m deep at a run: ${cls.move}`, family: 'vaults', move: cls.move, expect: cls.possible ? 'pass' : 'fail',
				start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ],
				press: step ? null : 'up', at: step ? 0 : 1.2, height: h, depth,
			}, step ? [
				{ move: 'run', to: [ cx, 0, z0 + depth + 1.5 ], test: true },
			] : [
				{ move: 'run', to: [ cx, 0, z0 - 0.4 ], ref: edge( id, [ cx, h, z0 ] ) },
				{ move: 'vault', to: over ? [ cx, 0, z0 + depth + 1.5 ] : [ cx, h, z0 + 1.5 ], kind: 'land', params: { height: h, depth }, test: true },
			] );
			x += 6;

		}

		x += 6;

	}

	for ( const h of [ 0.8, 1.2, 1.6, 1.9, 2.1, 2.4, 2.6, 2.9 ] ) {

		const cx = x + 1.5, z0 = 3, cls = obstacleClass( h, 3, 1 ), hang = cls.move === 'jumpToHang' || ! cls.move;
		const id = c.box( 'block', [ x, 0, z0 ], [ x + 3, h, z0 + 3 ] );
		c.lane( {
			name: `${h} m walking: ${cls.move ?? 'out of reach'}`, family: hang ? 'ledges' : 'vaults', move: cls.move ?? 'jumpToHang', expect: cls.possible ? 'pass' : 'fail',
			start: [ cx, 0, 0.5 ], drive: 'hold', speed: 1, runUp: z0 - 0.5, feature: [ cx, 0, z0 ],
			press: 'up', at: 0.6, then: cls.move === 'jumpToHang' ? [ { press: 'up', on: 'hang', s: 0.8 } ] : undefined, height: h, depth: 3,
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 0.4 ] },
			{ move: 'climb', to: hang ? [ cx, h, z0 ] : [ cx, h, z0 + 0.6 ], kind: hang ? 'edge' : 'stand', ref: edge( id, [ cx, h, z0 ] ), params: { height: h }, test: true },
		] );
		x += 6;

	}

	x += 6;

	for ( const h of [ 2.5, 2.8, 3.0, 3.2, 3.4, 3.6, 3.9, 4.2 ] ) {

		const cx = x + 1.5, z0 = run + 0.5, wc = wallclimb( { height: h, speed: v, runUp: run } ), ok = wc.possible && wc.move !== 'up';
		const id = c.box( 'wall', [ x, 0, z0 ], [ x + 3, h, z0 + 4 ] );
		const steps = [
			{ move: 'run', to: [ cx, 0, z0 - 0.4 ] },
			{ move: 'wallclimb', to: wc.move === 'over' ? [ cx, h, z0 + 0.6 ] : [ cx, h, z0 ], kind: wc.move === 'over' ? 'stand' : 'edge', ref: edge( id, [ cx, h, z0 ] ), params: { height: h }, test: true },
		];
		if ( ok && wc.move === 'hang' ) steps.push( { move: 'climbUp', to: [ cx, h, z0 + 0.8 ], ref: edge( id, [ cx, h, z0 ] ) } );
		c.lane( {
			name: `wallclimb at ${h} m: ${ok ? wc.move : h < M.obstacle.unclimbable ? 'the dead band' : 'clearly unclimbable'}`, family: 'walls', move: wc.move === 'over' ? 'wallclimbOver' : 'wallclimbHang', expect: ok ? 'pass' : 'fail',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ],
			press: 'up', at: 1.2, then: ok && wc.move === 'hang' ? [ { press: 'up', on: 'hang', s: 0.6 } ] : undefined, height: h,
		}, steps );
		x += 6;

	}

	x += 6;
	{

		const h = 1, depth = 0.4, z0 = run + 0.5;
		let cx = x + 2.9;
		c.box( 'block', [ x, 0, z0 ], [ x + 3, h, z0 + depth ] );
		c.lane( {
			name: 'steer away: Up 3 m before a 1 m box, then the stick to the left: called off, runs on past its end', family: 'vaults', move: 'vaultOver', expect: 'pass',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ], press: 'up', at: 3,
			then: [ { stick: 'left', on: 'start', s: 0 } ], after: '^Ground/Run$', afterIn: 0.4, height: h, depth,
		}, [
			{ move: 'run', to: [ cx + 3, 0, z0 + 1.5 ], test: true },
		] );
		x += 12;
		cx = x + 1.5;
		c.box( 'block', [ x, 0, z0 ], [ x + 3, h, z0 + depth ] );
		c.lane( {
			name: 'let go: Up 3 m before a 1 m box, then the stick let go: called off, stops short of it', family: 'vaults', move: 'vaultOver', expect: 'pass',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ], press: 'up', at: 3,
			then: [ { stick: 'stop', on: 'start', s: 0.05 } ], after: '^Ground/(Run|Idle)$', height: h, depth,
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 1.6 ], test: true },
		] );
		x += 12;
		x += 3.2;
		cx = x + 0.3;
		c.box( 'block', [ x, 0, z0 ], [ x + 3, h, z0 + depth ] );
		const b = c.box( 'block', [ x - 3.2, 0, z0 ], [ x - 0.2, 1.2, z0 + depth ] );
		c.lane( {
			name: 'onto another: Up 3 m before a 1 m box, then steered right onto the 1.2 m one beside it', family: 'vaults', move: 'vaultOver', expect: 'pass',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ], press: 'up', at: 3,
			then: [ { stick: 'right', on: 'start', s: 0.02 } ], minTop: 1.15, height: 1.2, depth,
		}, [
			{ move: 'run', to: [ x - 0.8, 0, z0 - 0.4 ], ref: edge( b, [ x - 0.8, 1.2, z0 ] ) },
			{ move: 'vault', to: [ x - 1.8, 0, z0 + depth + 1.5 ], kind: 'land', params: { height: 1.2, depth }, test: true },
		] );
		x += 12;

	}

	c.floor( - 6, x + 6, - 6, 24 );
	return c.done();

}

// Wallruns by approach angle, wall height and entry speed; across a gap; a corridor; the jump and drop off a wallrun;
// the wallclimb turn.
export function wallruns() {

	const c = new TestCourse( 'test_wallruns', 'Wallruns on walls along +z, met from the left at an angle: approach angles 5-55 deg and 65 (out) on 3.5 m walls at full speed (10 m run-up); wall heights 1.8 (out), 1.9 (Max), 2.5, 3.0 and 4.0 m at 20 deg; entry speeds 1.8 (out), 2.0 (Max) and 3.0 m/s held, and full. Then a 4 m wall that carries on over a 4.5 m gap, and a 3.5 m corridor over a 10 m pit (wallrun, turn, push off to the other wall, wallrun out). Up 1.5 m before meeting the wall.' );
	const zMeet = 14, L = 10, full = r3( speedAfterRun( 0, L ) );
	let x = 0;
	const lane = ( { angle = 20, height = 3.5, speed = full, label } ) => {

		const wx = x + 8, a = angle * Math.PI / 180, drive = speed === full ? 'full' : 'hold', run = drive === 'full' ? L : 8;
		const meet = [ wx - 0.4, 0, zMeet ], start = [ meet[ 0 ] - Math.sin( a ) * run, 0, zMeet - Math.cos( a ) * run ];
		const id = c.box( 'wall', [ wx, 0, zMeet - 4 ], [ wx + 0.4, height, zMeet + 14 ] );
		const wr = wallrun( { height, angle, speed } );
		c.lane( {
			name: `${label}: ${angle}° at ${speed} m/s on ${height} m`, family: 'walls', move: 'wallrun', expect: wr.possible ? 'pass' : 'fail',
			start, yaw: angle, drive, speed, runUp: run, feature: meet, press: 'up', at: 1.5, angle, height,
		}, [
			{ move: 'run', to: meet, kind: 'wall', ref: wall( id, [ wx, 1, zMeet ] ) },
			{ move: 'wallrun', to: [ wx - 0.4, 0, zMeet + 6 ], params: { angle, height }, refs: [ wall( id, [ wx, 1, zMeet ] ) ], test: true },
			{ move: 'run', to: [ wx - 1.5, 0, zMeet + 11 ] },
		] );
		x += 12;

	};

	for ( const angle of [ 5, 15, 25, 40, 55, 65 ] ) lane( { angle, label: 'angle' } );
	for ( const height of [ 1.8, 1.9, 2.5, 3.0, 4.0 ] ) lane( { height, label: 'height' } );
	for ( const speed of [ 1.8, 2.0, 3.0, full ] ) lane( { speed, label: 'speed' } );
	c.floor( - 12, x, - 4, zMeet + 16 );
	x += 8;

	{

		const wx = x + 8, gapAt = zMeet + 3, gap = 4.5, a = 20 * Math.PI / 180;
		const meet = [ wx - 0.4, 0, zMeet ], start = [ meet[ 0 ] - Math.sin( a ) * L, 0, zMeet - Math.cos( a ) * L ];
		const id = c.box( 'wall', [ wx, - 6, zMeet - 4 ], [ wx + 0.4, 4, zMeet + 16 ] );
		c.box( 'ground', [ x - 4, - 6, - 4 ], [ wx, 0, gapAt ] );
		c.box( 'ground', [ x - 4, - 6, gapAt + gap ], [ wx, 0, zMeet + 20 ] );
		c.box( 'pit', [ x - 4, - 7, gapAt ], [ wx, - 6, gapAt + gap ], { roles: [ 'out' ] } );
		c.walkway( x - 8, x - 4, - 4, zMeet + 20, 0 );
		c.add( { type: 'ladder', p: [ x - 2, - 6, gapAt + 0.15 ], h: 6, yaw: 0 } );
		c.lane( {
			name: `across a ${gap} m gap: 20° at ${full} m/s on a 4 m wall`, family: 'walls', move: 'wallrun', expect: 'pass',
			start, yaw: 20, drive: 'full', speed: full, runUp: L, feature: meet, press: 'up', at: 1.5, angle: 20, height: 4, gap,
		}, [
			{ move: 'run', to: meet, kind: 'wall', ref: wall( id, [ wx, 1, zMeet ] ) },
			{ move: 'wallrun', to: [ wx - 0.4, 0, gapAt + gap + 1.5 ], params: { angle: 20, height: 4, gap }, refs: [ wall( id, [ wx, 1, zMeet ] ) ], test: true },
			{ move: 'run', to: [ wx - 1.5, 0, zMeet + 14 ] },
		] );
		x += 16;

	}

	{

		const cx = x + 6, half = 1.75, z0 = 8, p0 = 14, p1 = 24, a = 20 * Math.PI / 180, run = 12;
		const B = c.box( 'wall', [ cx + half, - 6, z0 ], [ cx + half + 0.4, 4, 30 ] );
		const A = c.box( 'wall', [ cx - half - 0.4, - 6, z0 ], [ cx - half, 4, 30 ] );
		c.box( 'ground', [ cx - 6, - 6, - 6 ], [ cx + 6, 0, z0 ] );
		c.box( 'ground', [ cx - half, - 6, z0 ], [ cx + half, 0, p0 ] );
		c.box( 'pit', [ cx - half, - 7, p0 ], [ cx + half, - 6, p1 ], { roles: [ 'out' ] } );
		c.box( 'ground', [ cx - half, - 6, p1 ], [ cx + half, 0, 34 ] );
		c.walkway( x - 8, x, - 6, 8, 0 );
		c.add( { type: 'ladder', p: [ cx, - 6, p1 - 0.15 ], h: 6, yaw: 180 } );
		const meet = [ cx + half - 0.4, 0, 13 ], start = [ meet[ 0 ] - Math.sin( a ) * run, 0, meet[ 2 ] - Math.cos( a ) * run ];
		c.lane( {
			name: 'corridor 3.5 m over a 10 m pit: wallrun, turn, push off to the other wall, wallrun out', family: 'walls', move: 'corridor', expect: 'pass',
			start, yaw: 20, drive: 'full', speed: r3( speedAfterRun( 0, run ) ), runUp: run, feature: meet, press: 'up', at: 1.5, width: 3.5, gap: p1 - p0,
			then: [ { press: 'quickturn', on: 'wallrun', s: 0.5 }, { press: 'up', s: 0.25 } ],
			note: 'on the first wall Quickturn faces out and Up pushes off to the other; Up again on the way to it',
		}, [
			{ move: 'run', to: meet, kind: 'wall', ref: wall( B, [ cx + half, 1, 13 ] ) },
			{ move: 'wallrun', to: [ cx + half - 0.4, 0, 18.5 ], kind: 'wall', ref: wall( B, [ cx + half, 1, 18.5 ] ), params: { angle: 20, height: 4, gap: 18.5 - p0 }, refs: [ wall( B, [ cx + half, 1, 13 ] ) ] },
			{ move: 'corridor', to: [ cx - half + 0.4, 0, 21 ], kind: 'wall', ref: wall( A, [ cx - half, 1, 21 ] ), params: { width: 3.5 }, test: true },
			{ move: 'wallrun', to: [ cx - half + 0.4, 0, p1 + 1.5 ], params: { angle: 20, height: 4, gap: p1 - 21 }, refs: [ wall( A, [ cx - half, 1, 21 ] ) ] },
			{ move: 'run', to: [ cx, 0, 31 ] },
		] );
		x += 16;

	}

	{

		const a = 20 * Math.PI / 180, x0 = x;
		c.walkway( x0 - 4, x0, - 6, 8, 0 );
		for ( const [ label, move, then, goal ] of [
			[ 'wallrun jump: Up on the wall jumps off along it', 'wallrunJump', [ { press: 'up', on: 'wallrun', s: 0.75 } ], [ - 3, 11 ] ],
			[ 'wallrun drop: Down on the wall drops off it', 'wallrunDrop', [ { press: 'down', on: 'wallrun', s: 0.75 } ], [ - 1, 9 ] ],
		] ) {

			const wx = x + 8, meet = [ wx - 0.4, 0, zMeet ], start = [ meet[ 0 ] - Math.sin( a ) * L, 0, zMeet - Math.cos( a ) * L ];
			const id = c.box( 'wall', [ wx, 0, zMeet - 4 ], [ wx + 0.4, 3.5, zMeet + 10 ] );
			c.lane( { name: label, family: 'walls', move, expect: 'pass', start, yaw: 20, drive: 'full', speed: full, runUp: L, feature: meet, press: 'up', at: 1.5, then }, [
				{ move: 'run', to: meet, kind: 'wall', ref: wall( id, [ wx, 1, zMeet ] ) },
				{ move: 'wallrun', to: [ wx - 1.5, 0, zMeet + 8 ], params: { angle: 20, height: 3.5 }, refs: [ wall( id, [ wx, 1, zMeet ] ) ], test: true },
				{ move: 'run', to: [ wx + goal[ 0 ], 0, zMeet + goal[ 1 ] ] },
			] );
			x += 12;

		}

		const cx = x + 1.5, run = 8, v = r3( speedAfterRun( 0, run ) ), z0 = run + 0.5;
		const id = c.box( 'wall', [ x, 0, z0 ], [ x + 3, 4.2, z0 + 4 ] );
		c.lane( {
			name: 'wallclimb turn: Quickturn near the apex, then Up, kicks off back from the wall', family: 'walls', move: 'wallclimbTurn', expect: 'pass',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ], press: 'up', at: 1.2,
			then: [ { press: 'quickturn', s: 0.4 }, { press: 'up', s: 0.3 }, { stick: 'back', s: 0.3 } ], height: 4.2,
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 0.4 ] },
			{ move: 'wallclimbTurn', to: [ cx, 0, z0 - 2.5 ], kind: 'stand', refs: [ wall( id, [ cx, 1, z0 ] ) ], params: { height: 4.2 }, test: true },
		] );
		x += 6;
		c.floor( x0, x + 4, - 6, zMeet + 30 );

	}

	return c.done();

}

// Ledges: shimmying round outside and into inside corners, a free hang, narrow ledges, grab transfers, drops to hang.
export function ledges() {

	const c = new TestCourse( 'test_ledges', 'Ledges, left to right: a braced 3.2 m edge (wallclimb to hang, shimmy left round its outside corner); an inside corner (shimmy left into it: it stops, expect fail); a free-hang lip at 2.4 m jumped up to from a standstill, then climbed; narrow ledges 0.1 (too narrow: expect fail), 0.2 (chest to the wall) and 0.3 m (back to it) along a 6 m wall, walked onto from a 3 m deck; grab transfers 1.4 m (Max) and 1.8 m (out) up from a 3.2 m hang; drop to hang off a braced 4 m edge and off a free one (a 0.4 m slab over a recess: expect fail).' );
	const run = 8, v = r3( speedAfterRun( 0, run ) ), z0 = run + 0.5;
	let x = 0;

	{

		const id = c.box( 'block', [ x, 0, z0 ], [ x + 4, 3.2, z0 + 4 ] ), cx = x + 2;
		c.lane( {
			name: 'braced hang at 3.2 m: shimmy left round the outside corner', family: 'ledges', move: 'shimmy', expect: 'pass',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ], press: 'up', at: 1.2,
			then: [ { stick: 'left', on: 'hang', s: 0.5 } ], height: 3.2, corner: 'outside', note: 'Up climbs up wherever the shimmy stops',
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 0.4 ] },
			{ move: 'wallclimb', to: [ cx, 3.2, z0 ], kind: 'edge', ref: edge( id, [ cx, 3.2, z0 ] ), params: { height: 3.2 } },
			{ move: 'shimmy', to: [ x + 4, 3.2, z0 + 1 ], kind: 'edge', ref: edge( id, [ x + 4, 3.2, z0 + 1 ] ), test: true },
			{ move: 'climbUp', to: [ x + 3.2, 3.2, z0 + 1 ] },
		] );
		x += 10;

	}

	{

		const A = c.box( 'block', [ x, 0, z0 ], [ x + 6, 3.2, z0 + 4 ] ), cx = x + 2;
		const B = c.box( 'block', [ x + 4, 0, z0 - 5 ], [ x + 6, 3.2, z0 ] );
		c.lane( {
			name: 'inside corner: hang at 3.2 m, shimmy left into the corner (it stops there)', family: 'ledges', move: 'shimmy', expect: 'fail',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run, feature: [ cx, 0, z0 ], press: 'up', at: 1.2,
			then: [ { stick: 'left', on: 'hang', s: 0.5 } ], height: 3.2, corner: 'inside',
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 0.4 ] },
			{ move: 'wallclimb', to: [ cx, 3.2, z0 ], kind: 'edge', ref: edge( A, [ cx, 3.2, z0 ] ), params: { height: 3.2 } },
			{ move: 'shimmy', to: [ x + 4, 3.2, z0 - 1.5 ], kind: 'edge', ref: edge( B, [ x + 4, 3.2, z0 - 1.5 ] ), test: true },
		] );
		x += 12;

	}

	{

		const cx = x + 2;
		const lip = c.box( 'lip', [ x, 2.1, z0 ], [ x + 4, 2.4, z0 + 1 ] );
		c.box( 'block', [ x, 0, z0 + 1 ], [ x + 4, 2.4, z0 + 5 ] );
		c.lane( {
			name: 'free hang: jump up to a 2.4 m lip from a standstill (no face under it), climb up', family: 'ledges', move: 'jumpToHang', expect: 'pass',
			start: [ cx, 0, z0 - 0.6 ], drive: 'stand', speed: 0, runUp: 0, feature: [ cx, 0, z0 ], press: 'up', at: 0.6,
			then: [ { press: 'up', on: 'hang', s: 0.8 } ], height: 2.4, braced: false,
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 0.5 ] },
			{ move: 'climb', to: [ cx, 2.4, z0 ], kind: 'edge', ref: edge( lip, [ cx, 2.4, z0 ] ), params: { height: 2.4 }, test: true },
			{ move: 'climbUp', to: [ cx, 2.4, z0 + 1 ] },
		] );
		x += 10;

	}

	for ( const depth of [ 0.1, 0.2, 0.3 ] ) {

		c.box( 'deck', [ x, 0, 0 ], [ x + 4, 3, 8 ] );
		c.stairsUp( [ x + 2, 0 ], 0, 3, 0 );
		c.box( 'wall', [ x + 4, 0, 0 ], [ x + 4.6, 6, 24 ] );
		const id = c.box( 'ledge', [ x + 4 - depth, 2.7, 8 ], [ x + 4, 3, 18 ] );
		const narrow = depth >= M.ledge.narrow.depth[ 0 ] && depth <= M.ledge.narrow.depth[ 1 ];
		const facing = depth < M.ledge.narrow.chest ? 'chest' : 'back';
		c.lane( {
			name: `narrow ledge ${depth} m: ${narrow ? `${facing} to the wall` : 'too narrow'}`, family: 'ledges', move: 'ledgeWalk', expect: narrow ? 'pass' : 'fail',
			start: [ x + 3.65, 3, 3 ], drive: 'hold', speed: 1, runUp: 5, feature: [ x + 4 - depth / 2, 3, 8 ], press: null, at: 0, depth, facing: narrow ? facing : undefined,
		}, [
			{ move: 'run', to: [ x + 3.65, 3, 7.8 ] },
			{ move: 'ledgeWalk', to: [ x + 4 - depth / 2, 3, 17.5 ], refs: [ edge( id, [ x + 4 - depth, 3, 13 ] ) ], test: true },
		] );
		x += 10;

	}

	for ( const up of [ 1.4, 1.8 ] ) {

		const cx = x + 2, ok = transfer( { up, plan: 0 } );
		c.box( 'wall', [ x, 0, z0 ], [ x + 4, 6, z0 + 2 ] );
		const lo = c.box( 'ledge', [ x, 2.9, z0 - 0.25 ], [ x + 4, 3.2, z0 ] );
		const hi = c.box( 'ledge', [ x, 2.9 + up, z0 - 0.25 ], [ x + 4, 3.2 + up, z0 ] );
		c.lane( {
			name: `grab transfer ${up} m up from a 3.2 m hang`, family: 'ledges', move: 'transfer', expect: ok ? 'pass' : 'fail',
			start: [ cx, 0, 0.5 ], drive: 'full', speed: v, runUp: run - 0.25, feature: [ cx, 0, z0 - 0.25 ], press: 'up', at: 1.2,
			then: [ { press: 'up', on: 'hang', s: 0.6 } ], height: 3.2, up,
		}, [
			{ move: 'run', to: [ cx, 0, z0 - 0.65 ] },
			{ move: 'wallclimb', to: [ cx, 3.2, z0 - 0.25 ], kind: 'edge', ref: edge( lo, [ cx, 3.2, z0 - 0.25 ] ), params: { height: 3.2 } },
			{ move: 'transfer', to: [ cx, 3.2 + up, z0 - 0.25 ], kind: 'edge', ref: edge( hi, [ cx, 3.2 + up, z0 - 0.25 ] ), params: { up }, test: true },
		] );
		x += 10;

	}

	for ( const braced of [ true, false ] ) {

		const cx = x + 2;
		let id;
		if ( braced ) id = c.box( 'block', [ x, 0, 0 ], [ x + 4, 4, 10 ] );
		else {

			c.box( 'block', [ x, 0, 0 ], [ x + 4, 3.6, 9 ] );
			id = c.box( 'slab', [ x, 3.6, 0 ], [ x + 4, 4, 10 ] );

		}

		c.stairsUp( [ x + 2, 0 ], 0, 4, 0 );

		c.lane( {
			name: `drop to hang off a ${braced ? 'braced' : 'free'} 4 m edge`, family: 'ledges', move: 'dropToHang', expect: braced ? 'pass' : 'fail',
			start: [ cx, 4, 6 ], drive: 'hold', speed: 1, runUp: 4, feature: [ cx, 4, 10 ], press: 'down', at: 0.4, braced,
		}, [
			{ move: 'run', to: [ cx, 4, 9.6 ], kind: 'edge', ref: edge( id, [ cx, 4, 10 ] ) },
			{ move: 'dropToHang', to: [ cx, 4, 10 ], kind: 'edge', ref: edge( id, [ cx, 4, 10 ] ), test: true },
		] );
		x += 10;

	}

	c.floor( - 6, x, - 6, 30 );
	return c.done();

}

// Drainpipes and ladders by height, one with nothing to climb out onto, and a ladder at the rung-spacing limit.
export function pipes() {

	const c = new TestCourse( 'test_pipes', 'Drainpipes (0.12 m, 0.15 m off the wall) up 3, 4.5, 6 and 8 m walls with a roof to climb out onto; one stopping 1.5 m under the top of a 6 m wall (nothing to climb out onto: expect fail); ladders 3, 5 and 7 m with 0.30 m rungs and a 5 m one at 0.34 (the warp limit). Walk up (1.5 m/s held), Up 0.8 m from the foot, keep the stick forward to climb out at the top.' );
	let x = 0;
	const lane = ( kind, h, wallId, id, { dx = 0, out = true, ...extra } = {} ) => {

		const px = x + dx;
		c.lane( {
			name: `${kind} up ${h} m${extra.rungs ? `, rungs ${extra.rungs} m` : ''}${out ? '' : ': stops 1.5 m under the top'}`, family: 'pipes', move: kind, expect: out ? 'pass' : 'fail',
			start: [ px, 0, 5 ], drive: 'hold', speed: 1.5, runUp: 4.85, feature: [ px, 0, 9.85 ], press: 'up', at: 0.8, height: h, ...extra,
		}, [
			{ move: 'run', to: [ px, 0, 9.4 ], kind: 'line', ref: item( id, kind ) },
			{ move: kind, to: [ px, h, 9.85 ], kind: 'line', ref: item( id, kind ), test: true },
			...( out ? [ { move: 'climbUp', to: [ px, h, 11 ], ref: edge( wallId, [ px, h, 10 ] ) } ] : [] ),
		] );
		x += 8;

	};

	for ( const h of [ 3, 4.5, 6, 8 ] ) {

		const w = c.box( 'wall', [ x - 2, 0, 10 ], [ x + 2, h, 14 ] );
		lane( 'pipe', h, w, c.add( { type: 'pipe', a: [ x, 0, 9.85 ], b: [ x, h, 9.85 ], r: 0.06, n: [ 0, 0, - 1 ] } ) );

	}

	const w = c.box( 'wall', [ x - 2, 0, 10 ], [ x + 2, 6, 14 ] );
	lane( 'pipe', 4.5, w, c.add( { type: 'pipe', a: [ x + 1, 0, 9.85 ], b: [ x + 1, 4.5, 9.85 ], r: 0.06, n: [ 0, 0, - 1 ] } ), { dx: 1, out: false, capped: true } );
	for ( const [ h, rungs ] of [ [ 3, 0.3 ], [ 5, 0.3 ], [ 7, 0.3 ], [ 5, 0.34 ] ] ) {

		const w = c.box( 'wall', [ x - 2, 0, 10 ], [ x + 2, h, 14 ] );
		lane( 'ladder', h, w, c.add( { type: 'ladder', p: [ x, 0, 9.85 ], h, yaw: 180, width: 0.5, rungs } ), { rungs } );

	}

	c.floor( - 8, x, - 6, 20 );
	return c.done();

}

// Swing bars by height over the take-off, then bar to bar by distance.
export function bars() {

	const c = new TestCourse( 'test_bars', 'Swing bars 1.2 m past a roof edge over a 6 m pit, 1.9 (out), 2.0, 2.2, 2.4, 2.6, 2.8 and 2.9 (out) m over the take-off, a landing roof 1 m down from 2.9 m past the bar; then bar to bar at 2.4 m, 3, 3.5, 4, 4.5 and 5 (out) m apart. 12 m run-up at full stick; Up 0.8 m before the edge, Up at the forward apex releases.' );
	const pit = - 6, run = 12, v = r3( speedAfterRun( 0, run ) );
	let x = 0;
	const roof = () => c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, 0, run ] );
	const bar = ( z, y ) => c.add( { type: 'bar', a: [ x - 1.3, y, z ], b: [ x + 1.3, y, z ], r: 0.025, posts: true } );
	for ( const h of [ 1.9, 2.0, 2.2, 2.4, 2.6, 2.8, 2.9 ] ) {

		const take = roof(), zb = run + 1.2, id = bar( zb, h );
		c.box( 'roof', [ x - 2, pit, zb + 2.9 ], [ x + 2, - 1, zb + 12 ] );
		const sb = barSwing( { height: h, width: 2.6, clear: h - pit, speed: v } );
		c.lane( {
			name: `swing bar ${h} m over the take-off`, family: 'bars', move: 'swing', expect: sb.possible ? 'pass' : 'fail',
			start: [ x, 0, 0.5 ], drive: 'full', speed: v, runUp: run - 0.5, feature: [ x, 0, run ], press: 'up', at: 0.8,
			then: [ { press: 'up', on: 'apex', s: 0 } ], height: h,
		}, [
			{ move: 'run', to: [ x, 0, run - 0.3 ], kind: 'takeoff', ref: edge( take, [ x, 0, run ] ) },
			{ move: 'swing', to: [ x, - 1, zb + 4 ], kind: 'land', refs: [ item( id, 'bar' ) ], params: { height: h }, test: true },
		] );
		x += 8;

	}

	c.stairsUp( [ x - 2, 0 ], pit, 0, 180 );
	x += 4;
	for ( const d of [ 3, 3.5, 4, 4.5, 5 ] ) {

		const take = roof(), zb = run + 1.2, A = bar( zb, 2.4 ), B = bar( zb + d, 2.4 );
		c.box( 'roof', [ x - 2, pit, zb + d + 2.9 ], [ x + 2, - 1, zb + d + 12 ] );
		c.lane( {
			name: `bar to bar ${d} m at 2.4 m`, family: 'bars', move: 'barToBar', expect: barToBar( { distance: d } ) ? 'pass' : 'fail',
			start: [ x, 0, 0.5 ], drive: 'full', speed: v, runUp: run - 0.5, feature: [ x, 0, run ], press: 'up', at: 0.8,
			then: [ { press: 'up', on: 'apex', s: 0 }, { press: 'up', on: 'apex', s: 0 } ], distance: d,
			note: 'Up at the first forward apex releases to the second bar, Up at its forward apex onto the roof',
		}, [
			{ move: 'run', to: [ x, 0, run - 0.3 ], kind: 'takeoff', ref: edge( take, [ x, 0, run ] ) },
			{ move: 'swing', to: [ x, 2.4, zb + d ], kind: 'line', ref: item( B, 'bar' ), refs: [ item( A, 'bar' ) ], params: { height: 2.4, distance: d }, test: true },
			{ move: 'swing', to: [ x, - 1, zb + d + 4 ], kind: 'land', refs: [ item( B, 'bar' ) ] },
		] );
		x += 8;

	}

	c.box( 'pit', [ - 10, pit - 1, - 10 ], [ x + 4, pit, 40 ], { roles: [ 'out' ] } );
	c.walkway( - 10, x + 4, - 10, 0, 0, pit );
	c.stairsUp( [ - 6, 0 ], pit, 0, 180 );
	c.stairsUp( [ x - 1, 0 ], pit, 0, 180 );
	return c.done();

}

// Ziplines by slope.
export function ziplines() {

	const c = new TestCourse( 'test_ziplines', 'Ziplines from a 4 m roof across 16 m to a lower roof with 6 m to land under the low anchor: 3 (out), 5, 10, 15, 20, 25 and 30 (out) deg. The cable is 2.3 m over the take-off where it is caught (0.6 m past the edge). 9 m run-up at full stick; Up 0.6 m before the edge.' );
	const pit = - 5.5, span = 16, top = 4, edge0 = 10;
	let x = 0;
	for ( const slope of [ 3, 5, 10, 15, 20, 25, 30 ] ) {

		const t = Math.tan( slope * Math.PI / 180 ), atCatch = top + 2.3;
		const hi = atCatch + 2.1 * t, lo = atCatch - ( span - 0.6 ) * t;
		const take = c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, top, edge0 ] );
		const id = c.add( { type: 'cable', a: v3( [ x, hi, edge0 - 1.5 ] ), b: v3( [ x, lo, edge0 + span ] ), anchors: true } );
		c.box( 'roof', [ x - 2, pit, edge0 + span - 6 ], [ x + 2, lo - 2.6, edge0 + span + 8 ] );
		c.lane( {
			name: `zipline ${slope}°`, family: 'zip', move: 'zipline', expect: zipline( { slope } ).rideable ? 'pass' : 'fail',
			start: [ x, top, 1 ], drive: 'full', speed: r3( speedAfterRun( 0, edge0 - 1 ) ), runUp: edge0 - 1, feature: [ x, top, edge0 ], press: 'up', at: 0.6, slope,
		}, [
			{ move: 'run', to: [ x, top, edge0 - 0.4 ], kind: 'takeoff', ref: edge( take, [ x, top, edge0 ] ) },
			{ move: 'zipline', to: [ x, lo - 2.6, edge0 + span + 2 ], kind: 'land', refs: [ item( id, 'cable' ) ], params: { slope }, test: true },
		] );
		x += 8;

	}

	c.box( 'pit', [ - 10, pit - 1, - 10 ], [ x + 4, pit, 50 ], { roles: [ 'out' ] } );
	c.walkway( - 10, x + 4, - 10, 0, top, pit );
	c.stairsUp( [ - 6, 0 ], pit, top, 180 );
	c.stairsUp( [ x - 1, 0 ], pit, top, 180 );
	return c.done();

}

// Balance beams by width, from a wire to one wide enough to run along.
export function beams() {

	const c = new TestCourse( 'test_beams', 'Balance beams 5 m long between 1 m blocks: a 0.03 m wire, beams 0.05, 0.1, 0.15, 0.2 and 0.25 m wide, and a 0.4 m one (run normally). Walk on from the block at 2.5 m/s held.' );
	let x = 0;
	for ( const w of [ 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.4 ] ) {

		c.box( 'block', [ x - 1, 0, 4 ], [ x + 1, 1, 8 ] );
		c.stairsUp( [ x, 4 ], 0, 1, 0 );
		c.box( 'block', [ x - 1, 0, 13 ], [ x + 1, 1, 17 ] );
		const kind = beamKind( w ), ref = kind === 'wire' ? 'cable' : 'beam';
		const id = kind === 'wire' ?
			c.add( { type: 'cable', a: [ x, r3( 1 - w / 2 ), 8 ], b: [ x, r3( 1 - w / 2 ), 13 ], r: w / 2, kind: 'wire' } ) :
			c.add( { type: 'beam', a: [ x, 1, 7.9 ], b: [ x, 1, 13.1 ], width: w } );
		c.lane( {
			name: `${kind} ${w} m`, family: 'balance', move: kind === 'wide' ? 'run' : 'balance', expect: 'pass',
			start: [ x, 1, 5 ], drive: 'hold', speed: M.balance.speed, runUp: 3, feature: [ x, 1, 8 ], press: null, at: 0, width: w, kind,
		}, [
			{ move: 'run', to: [ x, 1, 7.8 ], kind: 'line', ref: item( id, ref ) },
			{ move: 'beam', to: [ x, 1, 13.2 ], refs: [ item( id, ref ) ], test: true },
			{ move: 'run', to: [ x, 1, 15.5 ] },
		] );
		x += 6;

	}

	c.floor( - 6, x, - 6, 24 );
	return c.done();

}

// Slopes by angle: walked, slid down, a wall.
export function slopes() {

	const c = new TestCourse( 'test_slopes', 'Slopes 3 m high off the end of a deck, run onto from the top: 35 deg (walked: no slide, expect fail), 40, 45, 50, 55 and 60 (the seated slide), 65 (a wall: a fall, no slide). Level run-out at each foot. 7 m run-up at full stick.' );
	let x = 0;
	for ( const angle of [ 35, 40, 45, 50, 55, 60, 65 ] ) {

		const h = 3, L = h / Math.tan( angle * Math.PI / 180 ), kind = slopeKind( angle );
		c.box( 'deck', [ x - 2, 0, 0 ], [ x + 2, h, 8 ] );
		const id = c.add( { type: 'wedge', p: v3( [ x, 0, 8 + L / 2 ] ), size: v3( [ 4, h, L ] ), yaw: 180 } );
		c.lane( {
			name: `slope ${angle}°: ${kind}`, family: 'slopes', move: 'slide', expect: kind === 'slide' ? 'pass' : 'fail',
			start: [ x, h, 1 ], drive: 'full', speed: r3( speedAfterRun( 0, 7 ) ), runUp: 7, feature: [ x, h, 8 ], press: null, at: 0, angle, kind,
		}, [
			{ move: 'run', to: [ x, h, 7.9 ], kind: 'slope', ref: item( id, 'slopes' ) },
			{ move: 'slide', to: [ x, 0, 8 + L + 1 ], refs: [ item( id, 'slopes' ) ], test: true },
			{ move: 'run', to: [ x, 0, 8 + L + 5 ] },
		] );
		x += 7;

	}

	c.floor( - 6, x, - 6, 30 );
	c.walkway( - 2, x - 5, - 4, 0, 3, 0 );
	c.stairsUp( [ - 2, - 2 ], 0, 3, 90 );
	c.stairsUp( [ x - 5, - 2 ], 0, 3, - 90 );
	return c.done();

}

// Doors by size, barged at a run and kicked walking; a valve and a button.
export function doors() {

	const c = new TestCourse( 'test_doors', 'Doors in 3 m walls across the lanes: 0.9 x 2.1, 1.0 x 2.2 and 1.2 x 2.4 m at a run (the barge: no press), 1.0 x 2.2 m walking (Interact kicks it); a valve wheel and a button at 1.2 m on a wall with room to stand in front (Interact).' );
	let x = 0;
	for ( const [ w, h, drive ] of [ [ 0.9, 2.1, 'full' ], [ 1.0, 2.2, 'full' ], [ 1.2, 2.4, 'full' ], [ 1.0, 2.2, 'hold' ] ] ) {

		const speed = drive === 'full' ? r3( speedAfterRun( 0, 11.5 ) ) : 1.2, barge = speed >= M.door.barge.speed;
		const id = c.add( { type: 'door', p: [ x, 0, 12.15 ], yaw: 180, width: w, height: h, wall: { width: 5, height: 3, depth: 0.3 } } );
		c.lane( {
			name: `door ${w} x ${h} m at ${speed} m/s: ${barge ? 'barge' : 'kick'}`, family: 'doors', move: barge ? 'barge' : 'kick', expect: 'pass',
			start: [ x, 0, 0.5 ], drive, speed, runUp: 11.5, feature: [ x, 0, 12 ], press: barge ? null : 'interact', at: barge ? 0 : 1.0, width: w, height: h,
		}, [
			{ move: 'run', to: [ x, 0, 11.4 ], kind: 'object', ref: item( id, 'door' ) },
			{ move: 'door', to: [ x, 0, 14 ], refs: [ item( id, 'door' ) ], test: true },
			{ move: 'run', to: [ x, 0, 18 ] },
		] );
		x += 7;

	}

	c.box( 'wall', [ x - 2.5, 0, 12 ], [ x + 2.5, 3, 12.3 ] );
	for ( const [ kind, dx, z ] of [ [ 'valve', - 1, 11.88 ], [ 'button', 1, 11.985 ] ] ) {

		const id = c.add( kind === 'valve' ? { type: 'valve', p: [ x + dx, 1.2, z ], yaw: 180, r: 0.2 } : { type: 'button', p: [ x + dx, 1.2, z ], yaw: 180 } );
		c.lane( {
			name: `${kind} at 1.2 m`, family: 'doors', move: kind, expect: 'pass',
			start: [ x + dx, 0, 6 ], drive: 'hold', speed: 1.2, runUp: 5.4, feature: [ x + dx, 0, 12 ], press: 'interact', at: 0.8,
		}, [
			{ move: 'run', to: [ x + dx, 0, 11.4 ], kind: 'object', ref: item( id, kind ) },
			{ move: 'interact', to: [ x + dx, 0, 11.45 ], refs: [ item( id, kind ) ], test: true },
		] );

	}

	x += 7;
	c.floor( - 6, x, - 6, 24 );
	return c.done();

}

// Falls by height, plain and with the skill roll.
export function landings() {

	const c = new TestCourse( 'test_landings', 'Landings: run off roofs 1, 2, 3.5, 5.3, 8 and 11 m above the ground (11 is fatal: expect fail), then 3.5, 5.3 and 8 m again with the skill roll (Down 0.15 s before touchdown). 7 m run-up at full stick, no press at the edge.' );
	let x = 0;
	const lane = ( h, roll ) => {

		const id = c.box( 'roof', [ x - 2, 0, 0 ], [ x + 2, h, 8 ] ), l = landingKind( h, { roll } );
		c.stairsUp( [ x, 0 ], 0, h, 0 );
		c.lane( {
			name: `drop ${h} m${roll ? ' with the roll' : ''}: ${l}`, family: 'jumps', move: 'landing', expect: l === 'fatal' ? 'fail' : 'pass',
			start: [ x, h, 1 ], drive: 'full', speed: r3( speedAfterRun( 0, 7 ) ), runUp: 7, feature: [ x, h, 8 ], press: null, at: 0,
			then: roll ? [ { press: 'down', on: 'touchdown', s: 0.15 } ] : undefined, fall: h, landing: l,
		}, [
			{ move: 'run', to: [ x, h, 7.7 ], kind: 'takeoff', ref: edge( id, [ x, h, 8 ] ) },
			{ move: 'drop', to: [ x, 0, 11 ], kind: 'land', params: { fall: h }, test: true },
			{ move: 'run', to: [ x, 0, 16 ] },
		] );
		x += 7;

	};

	for ( const h of [ 1, 2, 3.5, 5.3, 8, 11 ] ) lane( h, false );
	x += 4;
	for ( const h of [ 3.5, 5.3, 8 ] ) lane( h, true );
	c.floor( - 6, x, - 15, 30 );
	return c.done();

}

// Jumps beyond gaps and landings: springboards, the coil, the air turn.
export function jumps() {

	const c = new TestCourse( 'test_jumps', 'The jumps family beyond gaps and landings, left to right: a springboard (the generator\'s red plank at a roof\'s edge) 1.8 m across onto a roof 1.3 m up, Up 3 m before it; the coil (Down 0.12 s into a running jump across 2 m); a 0.6 m springboard step 1.1 m in front of a 1.3 m block (METRICS), up onto the block; the air turn off a 2 m roof (Quickturn 0.1 s after leaving it) with the stick pulled back for the back roll, and without (onto the back, then up).' );
	const pit = - 5, v = r3( speedAfterRun( 0, 12 ) );
	let x = 0;
	{

		const sb = c.add( { type: 'springboard', id: 'spr1', form: 'plank', p: [ x, 0, 15.3 ], size: [ 1.6, 0.5, 1.3 ], yaw: 0 } );
		c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, 0, 16 ] );
		const far = c.box( 'roof', [ x - 2, pit, 17.8 ], [ x + 2, 1.3, 23.8 ] );
		c.lane( { name: 'springboard: 1.8 m across onto a roof 1.3 m up', family: 'jumps', move: 'springboard', expect: 'pass', start: [ x, 0, 2 ], drive: 'full', speed: v, runUp: 13.8, feature: [ x, 0.44, 15.8 ], press: 'up', at: 3, gap: 1.8, rise: 1.3, step: 0.5 }, [
			{ move: 'run', to: [ x, 0, 14.2 ], kind: 'takeoff', ref: item( sb, 'springboard' ) },
			{ move: 'springboard', to: [ x, 1.3, 19.3 ], kind: 'land', ref: edge( far, [ x, 1.3, 17.8 ] ), params: { gap: 1.8, rise: 1.3, step: 0.5 }, test: true },
		] );
		x += 7;

	}

	{

		const take = c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, 0, 14 ] );
		const land = c.box( 'roof', [ x - 2, pit, 16 ], [ x + 2, 0, 22 ] );
		c.lane( {
			name: 'coil: Down 0.12 s into a running jump across 2 m', family: 'jumps', move: 'coil', expect: 'pass', start: [ x, 0, 2 ], drive: 'full', speed: v, runUp: 12, feature: [ x, 0, 14 ], press: 'up', at: 1,
			then: [ { press: 'down', on: 'takeoff', s: 0.12 } ], gap: 2, rise: 0,
		}, [
			{ move: 'run', to: [ x, 0, 13.7 ], kind: 'takeoff', ref: edge( take, [ x, 0, 14 ] ) },
			{ move: 'jump', to: [ x, 0, 17.5 ], kind: 'land', ref: edge( land, [ x, 0, 16 ] ), params: { gap: 2, rise: 0 }, test: true },
		] );
		x += 7;

	}

	c.box( 'pit', [ - 6, pit - 1, - 6 ], [ x - 3.5, pit, 30 ], { roles: [ 'out' ] } );
	c.walkway( - 6, x - 3.5, - 6, 0, 0, pit );
	c.stairsUp( [ - 4, 0 ], pit, 0, 180 );
	const x0 = x - 3.5;
	{

		const sb = c.add( { type: 'springboard', id: 'spr2', form: 'step', p: [ x, 0, 14 ], size: [ 1.6, 0.6, 0.6 ], yaw: 0 } );
		const block = c.box( 'block', [ x - 2, 0, 15.4 ], [ x + 2, 1.3, 21.4 ] );
		c.lane( { name: 'springboard step 0.6 m, 1.1 m in front of a 1.3 m block: onto it', family: 'jumps', move: 'springboard', expect: 'pass', start: [ x, 0, 2 ], drive: 'full', speed: v, runUp: 12, feature: [ x, 0.6, 14 ], press: 'up', at: 3, step: 0.6, rise: 1.3 }, [
			{ move: 'run', to: [ x, 0, 12.4 ], kind: 'takeoff', ref: item( sb, 'springboard' ) },
			{ move: 'springboard', to: [ x, 1.3, 17 ], kind: 'land', ref: edge( block, [ x, 1.3, 15.4 ] ), refs: [ item( sb, 'springboard' ) ], test: true },
		] );
		x += 7;

	}

	const turn = ( back ) => {

		const id = c.box( 'roof', [ x - 2, 0, 0 ], [ x + 2, 2, 8 ] );
		c.stairsUp( [ x, 0 ], 0, 2, 0 );
		c.lane( {
			name: `air turn off a 2 m roof${back ? ', the stick pulled back: the back roll' : ', the stick not pulled back: onto the back, then up'}`, family: 'jumps', move: 'airTurn', expect: 'pass',
			start: [ x, 2, 1 ], drive: 'full', speed: r3( speedAfterRun( 0, 7 ) ), runUp: 7, feature: [ x, 2, 8 ], press: null, at: 0, fall: 2, getsUp: back ? undefined : true,
			then: back ? [ { press: 'quickturn', on: 'takeoff', s: 0.1 }, { stick: 'back', s: 0.2 } ] : [ { press: 'quickturn', on: 'takeoff', s: 0.1 } ],
		}, [
			{ move: 'run', to: [ x, 2, 7.7 ], kind: 'takeoff', ref: edge( id, [ x, 2, 8 ] ) },
			{ move: 'drop', to: [ x, 0, 11 ], kind: 'land', params: { fall: 2 }, test: true },
		] );
		x += 7;

	};

	turn( true );
	turn( false );
	c.floor( x0, x - 3.5, - 6, 30 );
	return c.done();

}

// Combat moves, with no one to fight.
export function combat() {

	const c = new TestCourse( 'test_combat', 'Combat with no one to fight, moves the runner does not have yet, left to right: standing, Attack three times in time (the combo); Down (crouched), then Attack (the crouch punch); Attack, then Quickturn in the guard (the dodge back); at full speed, Attack (the jumping kick); Down (the slide), then Attack (the slide kick); a running jump across 2 m, Attack in its flight (the air kick); off a 1.35 m deck at a run, Attack 0.45 s before touchdown (the stomp); a wallrun at 20 deg, Attack on the wall (the jump off it with the kick, standing in for the wallrun kick).' );
	const pit = - 1.5, full = r3( speedAfterRun( 0, 10 ) );
	let x = 0;
	const stand = ( name, move, press, then ) => {

		c.lane( { name, family: 'combat', move, expect: 'pass', start: [ x, 0, 2 ], drive: 'hold', speed: 0, runUp: 0, feature: [ x, 0, 2 ], press, at: 0, then }, [
			{ move: 'run', to: [ x, 0, 2.5 ], test: true },
		] );
		x += 6;

	};

	stand( 'combo: Attack three times in time', 'combo', 'attack', [ { press: 'attack', s: 0.35 }, { press: 'attack', s: 0.3 } ] );
	stand( 'crouch punch: Down (crouched), then Attack', 'crouchPunch', 'down', [ { press: 'attack', s: 0.6 } ] );
	stand( 'dodge back: Attack (into the guard), then Quickturn in it', 'dodgeBack', 'attack', [ { press: 'quickturn', s: 1.3 } ] );
	c.lane( { name: 'jumping kick: Attack at full speed', family: 'combat', move: 'jumpKick', expect: 'pass', start: [ x, 0, 2 ], drive: 'full', speed: full, runUp: 10, feature: [ x, 0, 12 ], press: 'attack', at: 0 }, [
		{ move: 'run', to: [ x, 0, 15 ], test: true },
	] );
	x += 6;
	c.lane( { name: 'slide kick: Down at full speed, then Attack', family: 'combat', move: 'slideKick', expect: 'pass', start: [ x, 0, 2 ], drive: 'full', speed: full, runUp: 10, feature: [ x, 0, 12 ], press: 'down', at: 0, then: [ { press: 'attack', s: 0.4 } ] }, [
		{ move: 'run', to: [ x, 0, 15 ], test: true },
	] );
	x += 6;
	c.floor( - 6, x - 3, - 6, 30 );
	{

		const take = c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, 0, 14 ] );
		const land = c.box( 'roof', [ x - 2, pit, 16 ], [ x + 2, 0, 24 ] );
		c.lane( {
			name: 'air kick: Attack 0.1 s into a running jump across 2 m', family: 'combat', move: 'airKick', expect: 'pass', start: [ x, 0, 2 ], drive: 'full', speed: full, runUp: 12, feature: [ x, 0, 14 ], press: 'up', at: 1,
			then: [ { press: 'attack', on: 'takeoff', s: 0.1 } ], gap: 2, rise: 0,
		}, [
			{ move: 'run', to: [ x, 0, 13.7 ], kind: 'takeoff', ref: edge( take, [ x, 0, 14 ] ) },
			{ move: 'jump', to: [ x, 0, 18 ], kind: 'land', ref: edge( land, [ x, 0, 16 ] ), params: { gap: 2, rise: 0 }, test: true },
		] );
		x += 6;

	}

	c.box( 'pit', [ x - 9, pit - 1, - 6 ], [ x - 3, pit, 30 ], { roles: [ 'out' ] } );
	c.walkway( x - 9, x - 3, - 6, 0, 0, pit );
	const x0 = x - 3;
	{

		const id = c.box( 'deck', [ x - 2, 0, 0 ], [ x + 2, 1.35, 8 ] );
		c.stairsUp( [ x, 0 ], 0, 1.35, 0 );
		c.lane( {
			name: 'stomp: off a 1.35 m deck at a run, Attack 0.45 s before touchdown', family: 'combat', move: 'stomp', expect: 'pass', start: [ x, 1.35, 1 ], drive: 'full', speed: r3( speedAfterRun( 0, 7 ) ), runUp: 7, feature: [ x, 1.35, 8 ], press: null, at: 0,
			then: [ { press: 'attack', on: 'touchdown', s: 0.45 } ], fall: 1.35,
		}, [
			{ move: 'run', to: [ x, 1.35, 7.7 ], kind: 'takeoff', ref: edge( id, [ x, 1.35, 8 ] ) },
			{ move: 'drop', to: [ x, 0, 10 ], kind: 'land', params: { fall: 1.35 }, test: true },
		] );
		x += 6;

	}

	{

		const zMeet = 14, a = 20 * Math.PI / 180, wx = x + 4;
		const meet = [ wx - 0.4, 0, zMeet ], start = [ meet[ 0 ] - Math.sin( a ) * 10, 0, zMeet - Math.cos( a ) * 10 ];
		const id = c.box( 'wall', [ wx, 0, zMeet - 4 ], [ wx + 0.4, 3.5, zMeet + 14 ] );
		c.lane( {
			name: 'wallrun kick (stand-in): Attack on the wall, the jump off it with the kick', family: 'combat', move: 'wallrunKick', expect: 'pass',
			start, yaw: 20, drive: 'full', speed: full, runUp: 10, feature: meet, press: 'up', at: 1.5, then: [ { press: 'attack', on: 'wallrun', s: 0.35 } ],
		}, [
			{ move: 'run', to: meet, kind: 'wall', ref: wall( id, [ wx, 1, zMeet ] ) },
			{ move: 'wallrun', to: [ wx - 0.4, 0, zMeet + 3 ], params: { angle: 20, height: 3.5 }, refs: [ wall( id, [ wx, 1, zMeet ] ) ] },
			{ move: 'run', to: [ wx - 3, 0, zMeet + 8 ], test: true },
		] );
		x += 10;

	}

	c.floor( x0, x, - 6, 30 );
	return c.done();

}

// Ropes, and a rope fired at anchors.
export function ropes() {

	const c = new TestCourse( 'test_ropes', 'Ropes and the MAG rope, moves the runner does not have yet, left to right: a rope hung over a 5 m gap from 7 m up, Up 2.5 m before it at full speed, Up again at the forward apex (released across); a MAG swing anchor 8 m up over a 7 m gap, Interact 2 m before the edge (the jump, the rope fired in the air), Up at the forward apex; a pull-up anchor on the edge of a 5 m roof, Interact standing 2 m out (pulled up and over); a breach panel in a 4 m wall, Interact standing 5 m out, then the stick forward through it.' );
	const pit = - 5, full = r3( speedAfterRun( 0, 12 ) );
	let x = 0;
	{

		c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, 0, 14 ] );
		const far = c.box( 'roof', [ x - 2, pit, 19 ], [ x + 2, 0, 28 ] );
		const id = c.add( { type: 'rope', id: 'rope1', a: [ x, 7, 15.5 ], length: 5.5 } );
		c.lane( {
			name: 'hanging rope: swung on over a 5 m gap, released at the forward apex', family: 'rope', move: 'ropeSwing', expect: 'pass', start: [ x, 0, 1 ], drive: 'full', speed: full, runUp: 12, feature: [ x, 0, 15.5 ], press: 'up', at: 2.5,
			then: [ { press: 'up', on: 'apex', s: 0 } ],
		}, [
			{ move: 'run', to: [ x, 0, 13.5 ], kind: 'takeoff', ref: item( id, 'rope' ) },
			{ move: 'swing', to: [ x, 0, 21 ], kind: 'land', ref: edge( far, [ x, 0, 19 ] ), test: true },
		] );
		x += 7;

	}

	{

		c.box( 'roof', [ x - 2, pit, 0 ], [ x + 2, 0, 14 ] );
		const far = c.box( 'roof', [ x - 2, pit, 21 ], [ x + 2, 0, 30 ] );
		c.add( { type: 'anchor', id: 'mag1', p: [ x, 8, 17 ], form: 'swing' } );
		c.lane( {
			name: 'MAG swing: Interact 2 m before the edge, the rope fired at an anchor 8 m up, Up at the forward apex', family: 'rope', move: 'magSwing', expect: 'pass', start: [ x, 0, 1 ], drive: 'full', speed: full, runUp: 12, feature: [ x, 0, 14 ], press: 'interact', at: 2,
			then: [ { press: 'up', on: 'apex', s: 0 } ],
		}, [
			{ move: 'run', to: [ x, 0, 13.7 ], kind: 'takeoff' },
			{ move: 'swing', to: [ x, 0, 23 ], kind: 'land', ref: edge( far, [ x, 0, 21 ] ), refs: [ item( 'mag1', 'anchor' ) ], test: true },
		] );
		x += 7;

	}

	c.box( 'pit', [ - 6, pit - 1, - 6 ], [ x - 3.5, pit, 34 ], { roles: [ 'out' ] } );
	c.walkway( - 6, x - 3.5, - 6, 0, 0, pit );
	c.stairsUp( [ - 4, 0 ], pit, 0, 180 );
	const x0 = x - 3.5;
	{

		const roof = c.box( 'roof', [ x - 3, 0, 8 ], [ x + 3, 5, 16 ] );
		c.add( { type: 'anchor', id: 'mag2', p: [ x, 5, 8 ], form: 'pullup', yaw: 180 } );
		c.lane( { name: 'MAG pull-up: Interact standing 2 m out from a 5 m roof\'s edge', family: 'rope', move: 'pullUp', expect: 'pass', start: [ x, 0, 6 ], drive: 'hold', speed: 0, runUp: 0, feature: [ x, 0, 6 ], press: 'interact', at: 0 }, [
			{ move: 'pullUp', to: [ x, 5, 9 ], kind: 'stand', ref: edge( roof, [ x, 5, 8 ] ), refs: [ item( 'mag2', 'anchor' ) ], params: { height: 5 }, test: true },
		] );
		x += 8;

	}

	{

		c.add( { type: 'panel', id: 'panel1', p: [ x, 0, 10 ], yaw: 180, width: 1.2, height: 2.2, wall: { width: 6, height: 4, depth: 0.3 } } );
		c.lane( {
			name: 'wall breach: Interact standing 5 m from a panel, then the stick forward through it', family: 'rope', move: 'breach', expect: 'pass', start: [ x, 0, 5 ], drive: 'hold', speed: 0, runUp: 0, feature: [ x, 0, 5 ], press: 'interact', at: 0,
			then: [ { stick: 'forward', s: 4.0 } ],
		}, [
			{ move: 'breach', to: [ x, 0, 14 ], refs: [ item( 'panel1', 'panel' ) ], test: true },
		] );
		x += 8;

	}

	c.floor( x0, x, - 6, 34 );
	return c.done();

}

// Ground moves: the wall bump, the edge teeter and what cancels it, the stumble, slides, the crouch walk, the
// backpedal, the crawl.
export function ground() {

	const c = new TestCourse( 'test_ground', 'Ground flow, left to right: running into a 4 m wall with no press (the bump: it stops there); the edge teeter at a 3 m drop, walked up to at 1 m/s (walking off it: no teeter; stopping with the toes at its lip: the teeter; then the stick back, sideways or over, or Down, each cancelling it; stopping 0.8 m short: none); off a 1 m deck at a run, the stick pulled back as it lands (the stumble); Down at full speed on open ground (the slide) and under a bar 1.0 m up (Down 2 m before it); walking into a 1.3 m vent (the crouch walk); standing, the stick pulled half back (the backpedal); walking into a 0.9 m crawl space (the crawl).' );
	const v = r3( speedAfterRun( 0, 10 ) );
	let x = 0;
	{

		const id = c.box( 'wall', [ x - 2, 0, 12 ], [ x + 2, 4, 12.5 ] );
		c.lane( { name: 'wall bump: running into a 4 m wall, no press', family: 'ground', move: 'wallBump', expect: 'pass', start: [ x, 0, 1 ], drive: 'full', speed: v, runUp: 10, feature: [ x, 0, 12 ], press: null, at: 0 }, [
			{ move: 'run', to: [ x, 0, 11.4 ], kind: 'wall', ref: wall( id, [ x, 1, 12 ] ), test: true },
		] );
		x += 7;

	}

	{

		const stop = 0.28;
		const teeter = [
			[ 'walking off a 3 m drop: no teeter, it walks off', 'landing', { forbid: 'teeter' }, ( id ) => [
				{ move: 'run', to: [ x, 3, 7.6 ], kind: 'takeoff', ref: edge( id, [ x, 3, 8 ] ) },
				{ move: 'drop', to: [ x, 0, 10 ], kind: 'land', params: { fall: 3 }, test: true },
			] ],
			[ 'standing still at the lip of a 3 m drop: the teeter', 'teeter', { press: 'stop', at: stop, settle: 2.5 }, ( id ) => [
				{ move: 'run', to: [ x, 3, 7.7 ], kind: 'stand', ref: edge( id, [ x, 3, 8 ] ), test: true },
			] ],
			[ 'teeter, then the stick pulled back: it backs away', 'teeter', { press: 'stop', at: stop, then: [ { stick: 'back', amount: 0.5, on: 'start', s: 0.4 }, { stick: 'stop', s: 1.2 } ], after: 'Backpedal' }, ( id ) => [
				{ move: 'run', to: [ x, 3, 7.7 ], kind: 'stand', ref: edge( id, [ x, 3, 8 ] ), test: true },
				{ move: 'run', to: [ x, 3, 6.6 ] },
			] ],
			[ 'teeter, then the stick sideways: it walks along the edge', 'teeter', { press: 'stop', at: stop, then: [ { stick: 'left', on: 'start', s: 0.4 }, { stick: 'stop', s: 0.6 } ], after: 'Ground/Run' }, ( id ) => [
				{ move: 'run', to: [ x, 3, 7.7 ], kind: 'stand', ref: edge( id, [ x, 3, 8 ] ), test: true },
				{ move: 'run', to: [ x + 1.4, 3, 7.4 ] },
			] ],
			[ 'teeter, then the stick toward the drop: it walks off', 'teeter', { press: 'stop', at: stop, then: [ { stick: 'forward', on: 'start', s: 0.4 } ], after: 'Ground/Run|^Air' }, ( id ) => [
				{ move: 'run', to: [ x, 3, 7.7 ], kind: 'takeoff', ref: edge( id, [ x, 3, 8 ] ), test: true },
				{ move: 'drop', to: [ x, 0, 10 ], kind: 'land', params: { fall: 3 } },
			] ],
			[ 'teeter, then Down: it lowers into a hang', 'teeter', { press: 'stop', at: stop, then: [ { press: 'down', on: 'start', s: 0.4 } ], after: 'drop_to_hang|Hang' }, ( id ) => [
				{ move: 'run', to: [ x, 3, 7.7 ], kind: 'stand', ref: edge( id, [ x, 3, 8 ] ), test: true },
				{ move: 'dropToHang', to: [ x, 3, 8 ], kind: 'edge', ref: edge( id, [ x, 3, 8 ] ) },
			] ],
			[ 'standing still 0.8 m short of the edge: no teeter', 'stand', { press: 'stop', at: stop + 0.8, forbid: 'teeter', settle: 1.5 }, () => [
				{ move: 'run', to: [ x, 3, 6.9 ], test: true },
			] ],
		];
		for ( const [ name, move, opts, steps ] of teeter ) {

			const id = c.box( 'deck', [ x - 2, 0, 0 ], [ x + 2, 3, 8 ] );
			c.stairsUp( [ x, 0 ], 0, 3, 0 );
			c.lane( { name, family: 'ground', move, expect: 'pass', start: [ x, 3, 2 ], drive: 'hold', speed: 1.0, runUp: 6, feature: [ x, 3, 8 ], press: null, at: 0, ...opts }, steps( id ) );
			x += 7;

		}

	}

	{

		const id = c.box( 'deck', [ x - 2, 0, 0 ], [ x + 2, 1, 8 ] );
		c.stairsUp( [ x, 0 ], 0, 1, 0 );
		c.lane( {
			name: 'stumble: off a 1 m deck at a run, the stick pulled back as it lands', family: 'ground', move: 'stumble', expect: 'pass', start: [ x, 1, 1 ], drive: 'full', speed: r3( speedAfterRun( 0, 7 ) ), runUp: 7, feature: [ x, 1, 8 ], press: null, at: 0,
			then: [ { stick: 'back', on: 'touchdown', s: 0.05 } ],
		}, [
			{ move: 'run', to: [ x, 1, 7.7 ], kind: 'takeoff', ref: edge( id, [ x, 1, 8 ] ) },
			{ move: 'drop', to: [ x, 0, 10 ], kind: 'land', params: { fall: 1 }, test: true },
		] );
		x += 7;

	}

	c.lane( { name: 'slide: Down at full speed', family: 'ground', move: 'slide', expect: 'pass', start: [ x, 0, 1 ], drive: 'full', speed: v, runUp: 10, feature: [ x, 0, 11 ], press: 'down', at: 0 }, [
		{ move: 'run', to: [ x, 0, 14 ], test: true },
		{ move: 'run', to: [ x, 0, 20 ] },
	] );
	x += 7;
	{

		c.box( 'bar', [ x - 2, 1.0, 12 ], [ x + 2, 1.5, 12.4 ] );
		c.lane( { name: 'slide under a bar 1.0 m up (Down 2 m before it)', family: 'ground', move: 'slideUnder', expect: 'pass', start: [ x, 0, 1 ], drive: 'full', speed: v, runUp: 10, feature: [ x, 0, 12 ], press: 'down', at: 2 }, [
			{ move: 'slideUnder', to: [ x, 0, 13.5 ], test: true },
			{ move: 'run', to: [ x, 0, 20 ] },
		] );
		x += 7;

	}

	{

		c.box( 'vent', [ x - 1, 1.3, 8 ], [ x + 1, 2.3, 12 ] );
		c.box( 'vent', [ x - 1.4, 0, 8 ], [ x - 1, 2.3, 12 ] );
		c.box( 'vent', [ x + 1, 0, 8 ], [ x + 1.4, 2.3, 12 ] );
		c.lane( { name: 'crouch walk through a 1.3 m vent', family: 'ground', move: 'crouch', expect: 'pass', start: [ x, 0, 2 ], drive: 'hold', speed: 1.0, runUp: 6, feature: [ x, 0, 8 ], press: null, at: 0 }, [
			{ move: 'crouch', to: [ x, 0, 13 ], test: true },
		] );
		x += 7;

	}

	c.lane( {
		name: 'backpedal: standing, the stick pulled half back', family: 'ground', move: 'backpedal', expect: 'pass', start: [ x, 0, 10 ], drive: 'hold', speed: 0, runUp: 0, feature: [ x, 0, 10 ], press: null, at: 0,
		then: [ { stick: 'back', amount: 0.5, s: 0.2 } ],
	}, [
		{ move: 'run', to: [ x, 0, 8 ], test: true },
	] );
	x += 7;
	{

		c.box( 'slab', [ x - 1, 0.9, 8 ], [ x + 1, 2.3, 12 ] );
		c.box( 'slab', [ x - 1.4, 0, 8 ], [ x - 1, 2.3, 12 ] );
		c.box( 'slab', [ x + 1, 0, 8 ], [ x + 1.4, 2.3, 12 ] );
		c.lane( { name: 'crawl through a 0.9 m crawl space', family: 'ground', move: 'crawl', expect: 'pass', start: [ x, 0, 2 ], drive: 'hold', speed: 1.0, runUp: 6, feature: [ x, 0, 8 ], press: null, at: 0 }, [
			{ move: 'crouch', to: [ x, 0, 13 ], test: true },
		] );
		x += 7;

	}

	c.floor( - 6, x, - 6, 24 );
	return c.done();

}

/** Each family's course, by family name: a function returning the course definition. */
export const FAMILIES = { gaps, vaults, wallruns, ledges, pipes, bars, ziplines, beams, slopes, doors, landings, ground, jumps, combat, ropes };
