import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { PROJECT } = await import( '../tools/headless/env.mjs' );
const THREE = await import( 'three/webgpu' );
const { Course } = await import( '../src/course/Course.js' );
const { Box, Cylinder, Tube, Wedge } = await import( '../src/course/shapes.js' );
const { metrics } = await import( '../src/course/metrics.js' );
const reach = await import( '../src/course/reach.js' );
const { deriveRoute } = await import( '../src/course/deriveRoute.js' );
const { Route } = await import( '../src/course/Route.js' );
const { SPEED_AFTER, speedNeeded, jumpArc } = await import( '../src/course/routeMoves.js' );
const { validate, describe } = await import( '../src/course/validate.js' );
const { build, generate } = await import( '../src/course/generate.js' );
const { FAMILIES } = await import( '../src/course/families.js' );
const { CourseTools } = await import( '../src/course/tools.js' );

const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) <= eps, `expected ${ a } to be ${ b }` );
const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const readCourse = ( name ) => JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses', `${ name }.json` ), 'utf8' ) );

// A floor, and a block 4 m wide, 3.2 m tall and 4 m deep standing on it.
const BLOCK = { name: 'block', prims: [
	{ type: 'box', id: 'floor', min: [ - 10, - 1, - 10 ], max: [ 10, 0, 10 ] },
	{ type: 'box', id: 'block', min: [ - 2, 0, 0 ], max: [ 2, 3.2, 4 ] },
] };

test( 'a box answers its signed distance, the ground over it and a ray down onto it', () => {

	const box = new Box( V( 0, 0.5, 0 ), new THREE.Quaternion(), V( 1, 0.5, 2 ) );
	assert.ok( box.flat );
	near( box.sdf( 0, 0.5, 0 ), - 0.5 );
	near( box.sdf( 0, 3, 0 ), 2 );
	const tops = { lo: 0, hi: 0, normal: V( 0, 0, 0 ) };
	assert.ok( box.tops( 0.5, 1, 0.3, tops ) );
	near( tops.hi, 1 );
	assert.equal( box.tops( 3, 0, 0.3, tops ), false );
	const n = V( 0, 0, 0 );
	near( box.ray( V( 0, 5, 0 ), V( 0, - 1, 0 ), Infinity, n ), 4 );
	assert.deepEqual( n.toArray(), [ 0, 1, 0 ] );
	near( box.bottom( 0, 0, 0 ), 0 );

} );

test( 'a wedge rises toward its +z: the ground on it is the slope\'s height there, its angle in degrees', () => {

	// 2 m up over 2 m: 45°.
	const wedge = new Wedge( V( 0, 1, 0 ), 0, V( 1, 1, 1 ) );
	near( wedge.angle, 45 );
	const tops = { lo: 0, hi: 0, normal: V( 0, 0, 0 ) };
	assert.ok( wedge.tops( 0, 0.5, 0, tops ) );
	near( tops.hi, 1.5, 1e-12 );
	assert.ok( wedge.normal.y > 0 && wedge.normal.z < 0 );
	assert.ok( wedge.sdf( 0, 1.9, - 0.9 ) > 0, 'above the low end of the slope is outside' );
	assert.ok( wedge.sdf( 0, 1.9, 0.95 ) < 0, 'under the high end is inside' );

} );

test( 'a tube and a cylinder: the distance to their surface and the top a runner stands on', () => {

	const tube = new Tube( V( - 1, 2, 0 ), V( 1, 2, 0 ), 0.05 );
	near( tube.sdf( 0, 3, 0 ), 0.95 );
	const out = { t: 0, d: 0, point: V( 0, 0, 0 ), normal: V( 0, 0, 0 ) };
	near( tube.segment( 0, 0, 1, 0, 4, 1, out ), 0.95 );
	near( out.t, 0.5 );
	const cylinder = new Cylinder( 0, 0, 0.1, 0, 3 );
	const tops = { lo: 0, hi: 0, normal: V( 0, 0, 0 ) };
	assert.ok( cylinder.tops( 0.2, 0, 0.15, tops ) );
	near( tops.hi, 3 );
	assert.equal( cylinder.tops( 0.3, 0, 0.15, tops ), false );

} );

test( 'a course\'s queries: the ground, the ceiling, what is solid, and rays', () => {

	const course = new Course( { name: 'q', prims: [
		{ type: 'box', id: 'floor', min: [ - 5, - 1, - 5 ], max: [ 5, 0, 5 ] },
		{ type: 'box', id: 'slab', min: [ - 1, 2, - 1 ], max: [ 1, 2.5, 1 ] },
	] } );
	assert.equal( course.groundAt( 0, 0, 10 ).prim.id, 'slab' );
	assert.equal( course.groundAt( 0, 0, 1 ).prim.id, 'floor' );
	near( course.groundAt( 0, 0, 1 ).y, 0 );
	assert.ok( course.groundAt( 0, 0, 1 ).walkable );
	assert.equal( course.groundAt( 8, 0, 10 ), null );
	near( course.ceilingAt( 0, 0, 0.05 ), 2 );
	assert.equal( course.ceilingAt( 3, 0, 0.05 ), Infinity );
	assert.equal( course.solidAt( 0, 2.2, 0 ).id, 'slab' );
	assert.equal( course.solidAt( 0, 1, 0 ), null );
	const hit = course.raycast( V( - 4, 2.25, 0 ), V( 1, 0, 0 ) );
	near( hit.distance, 3 );
	assert.equal( hit.prim.id, 'slab' );
	assert.equal( course.raycast( V( - 4, 2.25, 0 ), V( 1, 0, 0 ), 2 ), null );
	course.dispose();

} );

test( 'authored prims: stairs are solid steps, a door stands in its wall, a bar\'s posts reach the ground, a pipe finds its wall', () => {

	const course = new Course( { name: 'p', prims: [
		{ type: 'box', id: 'floor', min: [ - 10, - 1, - 10 ], max: [ 10, 0, 10 ] },
		{ type: 'stairs', id: 'st', p: [ 5, 0, 0 ], steps: 4, rise: 0.25, run: 0.3 },
		{ type: 'door', id: 'd', p: [ 0, 0, 5 ], width: 1, height: 2.2, wall: { width: 5, height: 3, depth: 0.3 } },
		{ type: 'bar', id: 'b', a: [ - 1, 2.4, - 5 ], b: [ 1, 2.4, - 5 ], posts: true },
		{ type: 'box', id: 'w', min: [ - 9, 0, - 9 ], max: [ - 8, 4, - 7 ] },
		{ type: 'pipe', id: 'pp', a: [ - 7.85, 0, - 8 ], b: [ - 7.85, 4, - 8 ] },
	] } );
	const ids = course.prims.map( ( p ) => p.id );
	assert.deepEqual( ids.filter( ( id ) => id.startsWith( 'st/' ) ), [ 'st/step1', 'st/step2', 'st/step3', 'st/step4' ] );
	assert.ok( course.prims.find( ( p ) => p.id === 'st/step4' ).roles.has( 'stairs' ) );
	assert.deepEqual( ids.filter( ( id ) => id.startsWith( 'd/' ) ), [ 'd/wallL', 'd/wallR', 'd/lintel', 'd/leaf' ] );
	const leaf = course.prims.find( ( p ) => p.id === 'd/leaf' );
	assert.equal( leaf.type, 'leaf' );
	assert.ok( leaf.collide, 'a closed door is a solid' );
	const post = course.prims.find( ( p ) => p.id === 'b/postL' );
	near( post.shape.y0, 0 );
	near( post.shape.y1, 2.375 );
	const pipe = course.lines.find( ( l ) => l.kind === 'pipe' );
	assert.deepEqual( pipe.pipe.n.toArray().map( ( x ) => Math.round( x ) ), [ 1, 0, 0 ] );
	near( pipe.pipe.wallGap, 0.15, 1e-9 );
	course.dispose();

} );

test( 'deriving a block: hangable, braced, climbable edges round outside corners, and walls to run and climb', () => {

	const course = new Course( BLOCK );
	const block = course.prims.find( ( p ) => p.id === 'block' );
	const edges = course.edges.filter( ( e ) => e.prim === block );
	assert.equal( edges.length, 4 );
	for ( const e of edges ) {

		near( e.y, 3.2 );
		assert.ok( e.hangable && e.braced && e.climbable && e.standable );
		assert.equal( e.narrow, false );
		assert.equal( e.cornerB, 'outside' );
		assert.ok( e.next && e.prev );

	}

	const walls = course.walls.filter( ( w ) => w.prim === block );
	assert.equal( walls.length, 4 );
	assert.ok( walls.every( ( w ) => w.runnable && w.climbable && Math.abs( w.height - 3.2 ) < 1e-9 ) );
	for ( const role of [ 'top', 'edge', 'ledge', 'wall' ] ) assert.ok( block.roles.has( role ), role );
	course.dispose();

} );

test( 'deriving obstacles: a thin box is one vault, a narrow ledge along a wall is walked, a steep wedge is slid', () => {

	const course = new Course( { name: 'o', prims: [
		{ type: 'box', id: 'floor', min: [ - 20, - 1, - 20 ], max: [ 20, 0, 20 ] },
		{ type: 'box', id: 'thin', min: [ - 1.5, 0, 0 ], max: [ 1.5, 1, 0.4 ] },
		{ type: 'box', id: 'deck', min: [ 5, 0, 0 ], max: [ 9, 3, 8 ] },
		{ type: 'box', id: 'wall', min: [ 9, 0, 0 ], max: [ 9.6, 6, 24 ] },
		{ type: 'box', id: 'ledge', min: [ 8.8, 2.7, 8 ], max: [ 9, 3, 18 ] },
		{ type: 'wedge', id: 'slope', p: [ - 10, 0, 0 ], size: [ 4, 3, 3 ] },
	] } );
	const thin = course.prims.find( ( p ) => p.id === 'thin' );
	assert.ok( thin.roles.has( 'vault' ) && thin.vaultTop );
	const thinEdges = course.edges.filter( ( e ) => e.prim === thin && e.length > 1 );
	assert.ok( thinEdges.length >= 2 && thinEdges.every( ( e ) => e.vault && e.tint === thin.tint ), 'the obstacle lights up as one' );
	const ledge = course.edges.find( ( e ) => e.prim.id === 'ledge' && e.narrow );
	assert.ok( ledge, 'a 20 cm ledge along a 6 m wall is a narrow ledge' );
	assert.equal( ledge.facing, 'chest' );
	const slope = course.slopes[ 0 ];
	near( slope.angle, 45 );
	assert.equal( slope.kind, 'slide' );
	assert.ok( slope.prim.roles.has( 'slide' ) );
	course.dispose();

} );

test( 'the reach rules read the metrics: gaps, obstacles, landings, wallruns, ledges, speeds', () => {

	const sprint = reach.gapReach( 3.6, 0 );
	near( sprint.max, 2.6 );
	near( sprint.comfortable, 2.2 );
	near( sprint.clearlyOut, 4.1 );
	assert.equal( reach.gapReach( 7.2, 1.2 ), null, 'higher than +1 m is a catch' );
	assert.equal( reach.grade( 3, sprint ), 'dead' );
	assert.equal( reach.grade( 4.2, sprint ), 'out' );
	assert.equal( reach.obstacleClass( 0.3, 0.4, 4 ).move, 'step' );
	assert.equal( reach.obstacleClass( 1.0, 0.4, 4 ).move, 'vaultOver' );
	assert.equal( reach.obstacleClass( 1.0, 3, 4 ).move, 'vaultOnto' );
	assert.equal( reach.obstacleClass( 1.0, 3, 1 ).move, 'climbOnto' );
	assert.equal( reach.obstacleClass( 2.5, 4, 4 ).move, 'wallclimbOver' );
	assert.equal( reach.obstacleClass( 3.9, 4, 4 ).move, null );
	assert.equal( reach.obstacleClass( 0.9, 0.9, 4 ).comfortable, false, 'an ambiguous depth is never comfortable' );
	assert.deepEqual( [ 1, 3, 6, 9, 11 ].map( ( h ) => reach.landingKind( h ) ), [ 'run', 'deep', 'hard', 'hard', 'fatal' ] );
	assert.equal( reach.landingKind( 6, { roll: true } ), 'roll' );
	assert.deepEqual( reach.wallrun( { height: 3.5, angle: 20, speed: 4 } ), { possible: true, comfortable: true } );
	assert.equal( reach.wallrun( { height: 1.8, angle: 20, speed: 4 } ).possible, false );
	assert.deepEqual( reach.wallrunLength( 3.6 ), [ 4, 5 ] );
	assert.deepEqual( reach.ledge( { depth: 0.2, headroom: 3, face: 1.2, drop: 3, wallBehind: 3 } ), { hangable: true, climbable: false, standable: true, braced: true, narrow: true, facing: 'chest' } );
	near( reach.speedAfterRun( 0, 0 ), 0 );
	near( reach.speedAfterRun( 3.6, 1000 ), 7.2 );
	assert.ok( reach.speedAfterRun( 3.6, 18 ) > 6.4, 'about 18 m of running builds 6.5 m/s' );
	near( reach.speedAfterRun( 0, reach.runUpBetween( 0, 5 ) ), 5, 1e-6 );
	near( reach.speedAfter( 'speedVault', 4 ), 4.8 );
	near( reach.speedAfter( 'slideExit', 4 ), 2 );
	near( reach.speedAfter( 'skillRoll', 2 ), 4 );
	assert.equal( reach.slopeKind( 40 ), 'walk' );
	assert.equal( reach.slopeKind( 50 ), 'slide' );
	assert.equal( reach.slopeKind( 61 ), 'wall' );

} );

test( 'route moves: what each needs, what each leaves the runner with, and a jump\'s arc', () => {

	assert.deepEqual( speedNeeded( 'vault', {} ), { min: 3.5, comfortable: 4 } );
	assert.equal( speedNeeded( 'jump', { gap: 20, rise: 0 } ).min, Infinity );
	assert.equal( SPEED_AFTER.wallclimb( 5 ), 0 );
	near( SPEED_AFTER.vault( 4 ), 4.8 );
	near( SPEED_AFTER.jump( 5, { params: { fall: 3 } } ), 5, 1e-12 );
	near( SPEED_AFTER.jump( 5, { params: { rise: 0 } } ), 4.35 );
	const arc = jumpArc( V( 0, 0, 0 ), V( 0, - 1, 4 ), 4 );
	assert.equal( arc.length, 17 );
	assert.deepEqual( arc[ 0 ].toArray(), [ 0, 0, 0 ] );
	near( arc[ 16 ].y, - 1, 1e-12 );
	assert.ok( arc[ 8 ].y > 0, 'it flies up before it comes down' );

} );

test( 'an authored route carries the runner\'s speed from start to finish and plans the way on', () => {

	const def = { name: 'r', spawn: { p: [ 0, 0, 0 ] }, prims: [
		{ type: 'box', id: 'a', min: [ - 2, - 5, - 2 ], max: [ 2, 0, 20 ] },
		{ type: 'box', id: 'b', min: [ - 2, - 5, 22 ], max: [ 2, 0, 30 ] },
	], route: {
		nodes: [ { id: 's', p: [ 0, 0, 0 ], kind: 'start' }, { id: 't', p: [ 0, 0, 19.7 ], kind: 'takeoff', ref: { prim: 'a', kind: 'edges', near: [ 0, 0, 20 ] } }, { id: 'f', p: [ 0, 0, 24 ], kind: 'finish' } ],
		links: [ { from: 's', to: 't', move: 'run' }, { from: 't', to: 'f', move: 'jump', params: { gap: 2, rise: 0 } } ],
	} };
	const course = new Course( def );
	const route = course.route;
	assert.equal( route.derived, false );
	const [ run, jump ] = route.links;
	assert.equal( run.speedIn, 0 );
	near( jump.speedIn, reach.speedAfterRun( 0, 19.7 ) );
	assert.equal( jump.from.affordance.collection, 'edges' );
	assert.equal( jump.path.length, 17, 'a jump flies an arc' );
	const target = route.nextTarget( V( 0, 0, 5 ), V( 0, 0, 4 ) );
	assert.equal( target.link, 'jump' );
	assert.equal( target.node, 't' );
	assert.deepEqual( route.planSteps( V( 0, 0, 5 ), V( 0, 0, 4 ) ).map( ( s ) => s.link.move ), [ 'run', 'jump' ] );
	const report = validate( course );
	assert.ok( report.ok, describe( report ) );
	assert.equal( report.counts.jump, 1 );
	course.dispose();

} );

test( 'a derived route jumps a gap between two roofs at the speed their run-up allows', () => {

	const course = new Course( { name: 'd', spawn: { p: [ 0, 0, 1 ] }, prims: [
		{ type: 'box', id: 'a', min: [ - 3, - 6, - 2 ], max: [ 3, 0, 20 ] },
		{ type: 'box', id: 'b', min: [ - 3, - 6, 22.5 ], max: [ 3, 0, 32 ] },
		{ type: 'box', id: 'street', min: [ - 40, - 7, - 40 ], max: [ 40, - 6, 60 ], roles: [ 'out' ] },
	] } );
	const { nodes, links } = deriveRoute( course );
	assert.equal( nodes[ 0 ].kind, 'start' );
	const jumps = links.filter( ( l ) => l.move === 'jump' && l.refs[ 0 ]?.prim.id === 'b' );
	assert.ok( jumps.length, 'the gap from a to b is jumped' );
	near( jumps[ 0 ].params.gap, 2.5, 0.06 );
	assert.ok( links.some( ( l ) => l.move === 'run' ) );
	const route = new Route( course, { nodes, links }, { derived: true } );
	assert.ok( route.links.every( ( l ) => l.from && l.to ) );
	course.dispose();

} );

test( 'the validator fails a gap past Max and warns past Comfortable; a lane built to fail is expected to', () => {

	const lane = ( gap, expect ) => ( { name: 'g', prims: [
		{ type: 'box', id: 'a', min: [ - 2, - 5, - 10 ], max: [ 2, 0, 0 ] },
		{ type: 'box', id: 'b', min: [ - 2, - 5, gap ], max: [ 2, 0, gap + 6 ] },
	], route: {
		nodes: [ { id: 't', p: [ 0, 0, - 0.3 ], kind: 'takeoff', ref: { prim: 'a', kind: 'edges', near: [ 0, 0, 0 ] } }, { id: 'l', p: [ 0, 0, gap + 1.5 ], kind: 'land' } ],
		links: [ { from: 't', to: 'l', move: 'jump', params: { gap, rise: 0, speed: 3.6, ...( expect ? { expect } : {} ) } } ],
	} } );
	const check = ( gap, expect ) => {

		const course = new Course( lane( gap, expect ) );
		const report = validate( course );
		course.dispose();
		return report;

	};

	const comfortable = check( 2.1 );
	assert.ok( comfortable.ok && comfortable.warnings.length === 0, describe( comfortable ) );
	const max = check( 2.5 );
	assert.ok( max.ok && max.warnings.some( ( w ) => /past Comfortable/.test( w.message ) ), describe( max ) );
	const out = check( 4.3 );
	assert.equal( out.ok, false );
	assert.ok( out.violations.some( ( v ) => /past Max/.test( v.message ) ), describe( out ) );
	assert.ok( out.violations.some( ( v ) => /needs/.test( v.message ) ), 'and no approach speed it has makes it' );
	const expected = check( 4.3, 'fail' );
	assert.ok( expected.ok );
	assert.equal( expected.expected.length, out.violations.length, 'its violations are listed as expected' );
	const notStopped = check( 2.1, 'fail' );
	assert.equal( notStopped.ok, false, 'a lane built to fail that passes is a violation' );

} );

test( 'every family course is what its builder writes, passes the validator, and fails where it is built to', () => {

	for ( const [ family, make ] of Object.entries( FAMILIES ) ) {

		const def = make();
		assert.deepEqual( readCourse( def.name ), JSON.parse( JSON.stringify( def ) ), `${ def.name } is up to date (node tools/courses/write-families.mjs)` );
		if ( family === 'gaps' || family === 'vaults' ) continue;
		const course = new Course( def );
		const report = validate( course );
		course.dispose();
		assert.ok( report.ok, `${ def.name }:\n${ describe( report ) }` );
		const failing = def.lanes.filter( ( l ) => l.expect === 'fail' ).length;
		assert.ok( report.expected.length >= failing, `${ def.name }: every lane built to fail fails` );

	}

} );

test( 'the gap lanes pass at Comfortable and Max and fail past Clearly out', () => {

	const course = new Course( readCourse( 'test_gaps' ) );
	const report = validate( course );
	assert.ok( report.ok, describe( report ) );
	const expectedLanes = new Set( report.expected.map( ( e ) => e.link.params.lane ) );
	for ( const [ i, lane ] of course.def.lanes.entries() ) assert.equal( expectedLanes.has( i ), lane.expect === 'fail', lane.name );
	course.dispose();

} );

test( 'the generator: one seed gives one course, and only failing challenges are rerolled', () => {

	assert.deepEqual( build( { seed: 7, length: 12, difficulty: 0.3 } ), build( { seed: 7, length: 12, difficulty: 0.3 } ) );
	assert.notDeepEqual( build( { seed: 7 } ).prims, build( { seed: 8 } ).prims );
	const challengesOf = ( def ) => def.route.links.filter( ( l ) => l.move !== 'run' ).map( ( l ) => l.params.challenge );
	const def = build( { seed: 3, length: 10 } );
	assert.deepEqual( [ ...new Set( challengesOf( def ) ) ], [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ] );
	const asked = [];
	const result = generate( { seed: 3, length: 10, check: ( d ) => {

		asked.push( d.generator.rerolls );
		return asked.length < 3 ? [ 4 ] : [];

	} } );
	assert.equal( result.tries, 3 );
	assert.deepEqual( result.failed, [] );
	assert.deepEqual( result.def.generator.rerolls, { 4: 2 } );
	const always = generate( { seed: 3, length: 10, tries: 2, check: () => [ 0 ] } );
	assert.deepEqual( [ always.tries, always.failed ], [ 2, [ 0 ] ] );

} );

test( 'a generated course validates', () => {

	const check = ( d ) => {

		const c = new Course( d );
		const report = validate( c );
		c.dispose();
		return [ ...new Set( report.violations.map( ( v ) => v.link.params.challenge ) ) ];

	};

	const { def, failed } = generate( { seed: 4242, length: 14, difficulty: 0.6, check } );
	assert.deepEqual( failed, [] );
	const course = new Course( def );
	assert.equal( course.route.finish.kind, 'finish' );
	assert.ok( course.volumes.some( ( v ) => v.kind === 'kill' ) );
	course.dispose();

} );

test( 'the look marks usable affordances, and the views switch it', () => {

	const course = new Course( BLOCK );
	const look = course.look;
	const edge = course.edges.find( ( e ) => e.hangable );
	assert.equal( look.data[ edge.tint * 4 + 1 ], 255, 'a hangable edge is usable' );
	const wall = course.walls[ 0 ];
	assert.equal( wall.usable, false, 'walls never turn red' );
	const stripes = course.group.getObjectByName( 'course stripes' );
	assert.ok( stripes.geometry.getAttribute( 'aff' ).array.includes( edge.tint ), 'its stripe lights up with it' );
	course.setView( 'full' );
	assert.equal( look.view.value, 3 );
	course.setView( 'nonsense' );
	assert.equal( look.mode, 'full' );
	course.setView( 'graybox' );
	course.dispose();

} );

test( 'Runner Vision: Classic tints the next move as the runner nears it, Full lays the trail', () => {

	const def = readCourse( 'test_jumps' );
	const course = new Course( def );
	const lane = def.lanes[ 1 ];
	const position = V( ...lane.start ), velocity = V( 0, 0, 5 );
	course.setView( 'classic' );
	for ( let i = 0; i < 60; i ++ ) course.vision( position, velocity, 1 / 60 );
	const lit = [ ...course.look.data ].filter( ( x, i ) => i % 4 === 0 && x > 0 ).length;
	assert.ok( lit > 0, 'some affordance is tinted' );
	course.setView( 'full' );
	course.vision( position, velocity, 1 / 60 );
	const trail = course.group.getObjectByName( 'runner vision trail' );
	assert.ok( trail.visible && trail.geometry.drawRange.count > 0 );
	course.setView( 'off' );
	assert.equal( [ ...course.look.data ].filter( ( x, i ) => i % 4 === 0 && x > 0 ).length, 0, 'leaving the view clears the tints' );
	course.dispose();

} );

test( 'the course tools generate, validate, draw the route and follow the runner with the envelope', async () => {

	const listeners = [];
	const game = {
		stage: { renderer: { domElement: { addEventListener: ( type, fn ) => listeners.push( type ) } } },
		metrics, params: { course: 'test_basic', freeCamera: false }, course: null,
		player: { sim: { runner: { position: V( 0, 0.9, 0 ) } } },
		loadCourse: async ( def ) => {

			game.course = new Course( def, { metrics } );
			tools.onCourse( game.course );

		},
		frameSpawn: () => {},
	};
	const tools = new CourseTools( game );
	assert.deepEqual( listeners, [ 'dblclick' ] );
	assert.equal( tools.resolve( 'test_basic' ), null );
	tools.params.length = 5;
	await tools.regenerate();
	assert.equal( game.params.course, 'generated' );
	assert.equal( tools.last.generator.length, 5 );
	assert.match( tools.info.text, /✗/ );
	assert.ok( game.course.group.getObjectByName( 'route' ), 'the route overlay is drawn' );
	game.player.sim.runner.position.copy( game.course.spawn.position ).setY( 0.9 );
	tools.params.envelope = true;
	tools.update( 1 / 60 );
	assert.ok( game.course.group.getObjectByName( 'envelope' ), 'the envelope is drawn round the runner' );
	game.course.dispose();

} );
