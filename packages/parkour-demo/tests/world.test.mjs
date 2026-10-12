import test from 'node:test';
import assert from 'node:assert/strict';
import '../tools/headless/env.mjs';

const { Vector3 } = await import( 'three' );
const { courseFor } = await import( '../tools/headless/courses.mjs' );
const { World } = await import( '@trizen/parkour/world/World.js' );
const { fromCourse } = await import( '../src/world/fromCourse.js' );
const { EVERY_GROUP, GROUPS } = await import( '@trizen/parkour/world/solids.js' );
const { pipeVolume, ziplineVolume } = await import( '@trizen/parkour/world/catchVolumes.js' );
const { createEngine } = await import( '../src/engines.js' );

// A course as the simulation sees it: solids with their groups and tags, the poles, pipes and ziplines, the spawns,
// and the query worlds an engine builds from them.

const engine = await createEngine( 'rapier' );

test( 'a course becomes boxes and hulls that block every group, tagged for what the runner may do on them', () => {

	const world = new World( fromCourse( courseFor( 'test_basic' ) ) );
	const tagged = ( tag ) => world.solids.filter( ( solid ) => solid.tags.includes( tag ) ).map( ( solid ) => solid.id );

	assert.ok( world.solids.length > 50 );
	assert.equal( new Set( world.solids.map( ( solid ) => solid.id ) ).size, world.solids.length );

	for ( const solid of world.solids ) {

		assert.equal( solid.groups, EVERY_GROUP );
		assert.ok( [ 'box', 'hull' ].includes( solid.shape.kind ) );

		if ( solid.shape.kind === 'box' ) {

			assert.equal( solid.position.length, 3 );
			assert.ok( Math.abs( Math.hypot( ...solid.rotation ) - 1 ) < 1e-12 );
			assert.ok( solid.shape.halfExtents.every( ( half ) => half > 0 ) );

		} else {

			// A hull's faces point out of it, and every corner of a face lies on its plane.
			const points = solid.shape.points;
			const centre = new Vector3();

			for ( let k = 0; k < points.length; k += 3 ) centre.add( new Vector3().fromArray( points, k ) );
			centre.divideScalar( points.length / 3 );
			assert.ok( solid.faces.length >= 5 );

			for ( const { normal, triangles } of solid.faces ) {

				const plane = normal.dot( triangles[ 0 ].a );

				assert.ok( Math.abs( normal.length() - 1 ) < 1e-12 );
				assert.ok( plane > normal.dot( centre ) );
				for ( const triangle of triangles ) for ( const corner of [ triangle.a, triangle.b, triangle.c ] ) assert.ok( Math.abs( normal.dot( corner ) - plane ) < 1e-9 );

			}

		}

	}

	// The swing bar, and the two posts it stands on.
	assert.deepEqual( tagged( 'bar' ), [ 'swing_bar' ] );
	assert.deepEqual( tagged( 'barPost' ), [ 'swing_bar/postL', 'swing_bar/postR' ] );
	assert.equal( world.solids.find( ( solid ) => solid.id === 'swing_bar/postL' ).owner, 'swing_bar' );

	// What is out of bounds is no place to climb either.
	assert.equal( tagged( 'outOfBounds' ).length, 1 );
	assert.deepEqual( tagged( 'noClimb' ), tagged( 'outOfBounds' ) );

} );

test( 'poles are the thin, tall cylinders; a pipe is faced towards its wall; ziplines run down from their high end', () => {

	const world = new World( fromCourse( courseFor( 'test_basic' ) ) );

	assert.equal( world.poles.length, 2 );

	for ( const pole of world.poles ) {

		assert.ok( pole.radius <= 0.25 && pole.top.y - pole.bottom.y >= 2 );
		assert.ok( world.solids.some( ( solid ) => solid.id === pole.id ) );

	}

	const [ pipe ] = world.pipes;
	assert.equal( pipe.id, 'drainpipe' );
	assert.equal( pipe.end.y - pipe.start.y, 4.5 );
	assert.deepEqual( pipe.forward.toArray(), [ 0, 0, 1 ] );

	// A zipline is ridden, not run into: no solid.
	const [ zipline ] = world.ziplines;
	assert.ok( zipline.start.y > zipline.end.y );
	assert.equal( zipline.forward.y, 0 );
	assert.ok( Math.abs( zipline.forward.length() - 1 ) < 1e-12 );
	assert.equal( world.solids.some( ( solid ) => solid.id === zipline.id ), false );

} );

test( 'a ladder is faced towards its wall and caught like a pipe; a rope hangs from its anchor; a door is its doorway, its leaf no solid', () => {

	const world = new World( fromCourse( courseFor( 'test_basic' ) ) );

	// The ladder up the tower's face, faced into the tower, its catch volume after the pipes' and ziplines'.
	assert.equal( world.ladders.length, 1 );
	const [ ladder ] = world.ladders;
	assert.ok( ladder.forward.distanceTo( new Vector3( 0, 0, 1 ) ) < 1e-12 );
	assert.equal( ladder.end.y - ladder.start.y, 4.5 );
	assert.deepEqual( world.catchVolumes.map( ( volume ) => volume.kind ), [ 'pipe', 'zipline', 'ladder' ] );
	assert.ok( world.solids.some( ( solid ) => solid.id === 'ladder' ) );

	// The rope: no solid, 3.5 m down from its anchor.
	assert.equal( world.ropes.length, 1 );
	assert.equal( world.ropes[ 0 ].length, 3.5 );
	assert.ok( ! world.solids.some( ( solid ) => solid.id === 'rope' ) );

	// The door stands in its wall, which is solid either side and over it; the leaf is not, the doors stand in for it.
	assert.equal( world.doors.length, 1 );
	const [ door ] = world.doors;
	assert.deepEqual( [ door.width, door.height ], [ 1, 2.2 ] );
	assert.ok( Math.abs( door.normal.z + 1 ) < 1e-12 );
	assert.ok( [ 'door/wallL', 'door/wallR', 'door/lintel' ].every( ( id ) => world.solids.some( ( solid ) => solid.id === id ) ) );
	assert.ok( ! world.solids.some( ( solid ) => solid.id === 'door/leaf' ) );

	// The valve and the button by it, facing out of their wall.
	assert.deepEqual( world.switches.map( ( item ) => item.kind ), [ 'valve', 'button' ] );
	assert.ok( world.switches.every( ( item ) => Math.abs( item.normal.z + 1 ) < 1e-12 ) );

	// A breach panel keeps its leaf: it is no door.
	const ropes = new World( fromCourse( courseFor( 'test_ropes' ) ) );
	assert.equal( ropes.doors.length, 0 );
	assert.ok( ropes.solids.some( ( solid ) => solid.id === 'panel1/leaf' ) );

} );

test( 'runs start at the course\'s spawn, then at each lane\'s, with the capsule\'s centre 0.9215 m up', () => {

	const world = new World( fromCourse( courseFor( 'test_pipes' ) ) );
	const course = courseFor( 'test_pipes' );

	assert.equal( world.spawns.length, 1 + course.def.lanes.length );
	assert.equal( world.spawn( 0 ).position.y, course.spawn.position.y + 0.9215 );

	const lane = course.def.lanes[ 2 ];
	const start = world.spawn( 3 );
	assert.deepEqual( start.position.toArray(), [ lane.start[ 0 ], lane.start[ 1 ] + 0.9215, lane.start[ 2 ] ] );
	assert.equal( start.yaw, ( lane.yaw ?? 0 ) * Math.PI / 180 );

	// Past the last, round again; and a spawn handed out is the run's own to move.
	assert.deepEqual( world.spawn( world.spawns.length ).position, world.spawn( 0 ).position );
	world.spawn( 0 ).position.x += 5;
	assert.equal( world.spawn( 0 ).position.x, world.spawns[ 0 ].position.x );

} );

test( 'built on an engine, the course answers the runner\'s queries, and its catch volumes answer apart', () => {

	const world = new World( fromCourse( courseFor( 'test_basic' ) ) ).build( engine );
	const spawn = world.spawn( 0 ).position;

	// The floor under the spawn, in every group.
	for ( const group of Object.keys( GROUPS ) ) assert.ok( Math.abs( world.queries.ray( spawn, new Vector3( 0, - 1, 0 ), 2, group ).distance - 0.9215 ) < 1e-6 );

	// The drainpipe's volume stands out from the pipe on the runner's side; the zipline's hangs under its cable.
	const capsule = { kind: 'capsule', radius: 0.185, halfHeight: 0.9 };
	const [ pipe ] = world.pipes, [ zipline ] = world.ziplines;
	const inside = ( at ) => world.catchWorld.overlap( capsule, at ).map( ( volume ) => volume.kind );

	assert.deepEqual( inside( pipe.start.clone().add( new Vector3( 0, 2, - 0.6 ) ) ), [ 'pipe' ] );
	assert.deepEqual( inside( pipe.start.clone().add( new Vector3( 0, 2, 1.5 ) ) ), [] );
	assert.deepEqual( inside( zipline.start.clone().lerp( zipline.end, 0.5 ).add( new Vector3( 0, - 1, 0 ) ) ), [ 'zipline' ] );
	assert.deepEqual( inside( spawn ), [] );

	// The course's own queries never see a catch volume.
	assert.equal( world.queries.overlapCapsule( pipe.start.clone().add( new Vector3( 0, 2, - 0.6 ) ), 0.185, 0.9 ), null );

} );

test( 'a pipe\'s catch volume is 1.08 m square; a zipline\'s is a square round the cable, 1.25 m at the top, 1.2 m at the bottom', () => {

	const world = new World( fromCourse( courseFor( 'test_basic' ) ) );
	const [ pipe ] = world.pipes, [ zipline ] = world.ziplines;

	// The pipe's: from its foot to 1.8 m short of its top, 38 cm out on the runner's side.
	const box = pipeVolume( pipe );
	assert.deepEqual( [ box.halfExtents[ 0 ] * 2, box.halfExtents[ 2 ] * 2 ], [ 1.08, 1.08 ] );
	assert.equal( box.halfExtents[ 1 ] * 2, 4.5 - 1.8 );
	assert.ok( Math.abs( new Vector3().fromArray( box.position ).sub( pipe.start ).dot( pipe.forward ) + 0.38 ) < 1e-12 );

	// The zipline's: eight corners, the top end's four first, each four a square of its size with the cable inside it.
	const points = ziplineVolume( zipline );
	assert.equal( points.length, 8 * 3 );

	for ( const [ first, size, end ] of [ [ 0, 1.25, zipline.start ], [ 4, 1.2, zipline.end ] ] ) {

		const corner = ( k ) => new Vector3().fromArray( points, ( first + k ) * 3 );
		assert.ok( Math.abs( corner( 0 ).distanceTo( corner( 1 ) ) - size ) < 1e-9 );
		assert.ok( Math.abs( corner( 0 ).distanceTo( corner( 2 ) ) - size ) < 1e-9 );
		assert.ok( Math.abs( corner( 0 ).distanceTo( corner( 3 ) ) - size * Math.SQRT2 ) < 1e-9 );

		// The cable runs through the square, near its middle.
		const middle = corner( 0 ).lerp( corner( 3 ), 0.5 );
		const along = zipline.end.clone().sub( zipline.start ).normalize();
		const off = middle.sub( end );
		assert.ok( off.addScaledVector( along, - off.dot( along ) ).length() < 0.15 );

	}

} );
