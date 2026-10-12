// The tutorial's course, as the demo blueprint lays it out: one path, a lesson to a bay (src/tutorial/lessons.js has
// what each teaches), on three terraced rows a storey apart. Row 1 runs east, Row 2 back west, Row 3 east again, and
// each turn between rows is a climb, so the way on is always up and always in view. It ends with a zipline into a
// plaza, a door to barge, and the gate into the Foundry.
//
// Teach, then test: each bay shows its move where missing costs nothing, then asks for it where missing drops the
// runner into a soft pit and back to the bay's flag. The rows' faces are no-climb, so the way on is always the
// lesson's move; every gap and height is inside METRICS's bands.

import { Level } from './level.js';

// Under everything (m): below the deepest pit's floor.
const STREET = - 5;

// A storey (m), as the Foundry's: a comfortable wallclimb (METRICS: up to 3.2 m; the blueprint planned 3.5, which the
// validator finds possible but not comfortable). The rows' tops are a storey apart.
const STOREY = 3.1;
const ROW1 = 0, ROW2 = STOREY, ROW3 = 2 * STOREY;

// The jump pits' floor (m): 2 m down, soft.
const PIT = - 2;

// The drop pit's floor (m): 6.1 m under Row 2, where a fall wants a roll (METRICS: from 4.55 m).
const DROP = - 3;

// The rows' faces: no ledge and no wall run on them, and drawn so (no-run grey, not a wall's blue).
const NO_CLIMB = [ 'noClimb', 'noRun' ];

// The walls between the rows stand this far (m) over the higher side, and are this thick.
const DIVIDER = 2;
const WALL = 0.3;

// The inside of the parapet along the map's north edge (m): what runs up to it stops there.
const EDGE = 30 - 0.3;

// Where the runner starts and each lesson's flag (a spawn named by the lesson's id), facing the way on, each at least
// 4.5 m from a wall behind it so the camera (3 m back) does not start behind one.
const FLAGS = [
	[ 'run', [ 17, 25 ], 90, ROW1 ], [ 'jump', [ 28, 25 ], 90, ROW1 ], [ 'charge', [ 35.5, 25 ], 90, ROW1 ],
	[ 'vault', [ 55.5, 25 ], 90, ROW1 ], [ 'climb', [ 66.5, 25 ], 90, ROW1 ], [ 'wallclimb', [ 87, 25.5 ], 180, ROW1 ],
	[ 'wallrun', [ 91, 17.5 ], 270, ROW2 ], [ 'balance', [ 65, 15 ], 270, ROW2 ], [ 'stride', [ 51, 15 ], 270, ROW2 ],
	[ 'roll', [ 31, 15 ], 270, ROW2 ], [ 'pipes', [ 2.5, 24 ], 180, DROP ], [ 'slide', [ 5.5, 5 ], 90, ROW3 ],
	[ 'swing', [ 22.5, 5 ], 90, ROW3 ], [ 'precision', [ 39, 5 ], 90, ROW3 ], [ 'zipline', [ 57, 5 ], 90, ROW3 ],
	[ 'doors', [ 101, 5 ], 90, ROW1 ], [ 'finish', [ 113, 5 ], 90, ROW1 ],
];

function tutorial() {

	const L = new Level( {
		name: 'tutorial',
		about: 'The tutorial: every control in sixteen lessons on one path, from the first run to the zipline, a flag at each.',
		street: STREET,
	} );

	// ---- Row 1, east: moving and obstacles. Three posts to steer round; a 2.5 m gap after a 4 m run-up; a 4.2 m gap
	// after 15 m, which takes a full charge (METRICS: past Comfortable at the 6.1 m/s it builds); fences 0.9 and 1.2 m;
	// a 1.7 m wall to get up onto. The jump pits are soft, 2 m down.

	L.block( 'row1_a', [ 12, 20, 32, 30 ], ROW1 );
	L.block( 'pit_jump', [ 32, 20, 34.5, 30 ], PIT );
	L.block( 'row1_b', [ 34.5, 20, 50.5, 30 ], ROW1 );
	L.block( 'pit_charge', [ 50.5, 20, 54.7, 30 ], PIT );
	L.block( 'row1_c', [ 54.7, 20, 72, 30 ], ROW1 );
	L.block( 'climb_wall', [ 72, 20, 84, 30 ], 1.7 );
	L.block( 'row1_turn', [ 84, 20, 96, 30 ], ROW1 );
	for ( const [ i, [ x, z ] ] of [ [ 20, 22.5 ], [ 23, 27.5 ], [ 26, 22.5 ] ].entries() ) L.post( `post_${i}`, [ x, z ], { r: 0.3, top: 1.2, from: ROW1 } );
	L.fence( 'fence_090', [ 58.8, 20, 59.2, EDGE ], 0.9 );
	L.fence( 'fence_120', [ 63.3, 20, 63.7, EDGE ], 1.2 );

	// ---- Row 2, west: walls and beams. Its face over Row 1 is no-climb but for the wallclimb's 12 m at the east end,
	// where a railing over the left half leaves 0.3 m of edge: enough to hang from (METRICS: 0.15), too little to
	// climb onto (0.6), so a shimmy right comes before the climb. Trenches a storey deep.

	// Up to the wall along Row 1 (where it stands), so no face of a row lies in the wall's.
	const R2 = 20 - WALL;
	L.block( 'row2_a', [ 12, 10, 36, R2 ], ROW2, { roles: NO_CLIMB } );
	L.block( 'trench_stride', [ 36, 10, 48, R2 ], ROW1 );
	L.block( 'row2_b', [ 48, 10, 56, R2 ], ROW2, { roles: NO_CLIMB } );
	L.block( 'trench_beam', [ 56, 10, 62, R2 ], ROW1 );
	L.block( 'row2_c', [ 62, 10, 70.5, R2 ], ROW2, { roles: NO_CLIMB } );
	L.block( 'trench_wallrun', [ 70.5, 10, 74, R2 ], ROW1 );
	L.block( 'row2_d', [ 74, 10, 84, R2 ], ROW2, { roles: NO_CLIMB } );
	L.block( 'row2_climb', [ 84, 10, 96, 20 ], ROW2 );
	L.wall( 'railing', [ 84, 19.4, 90, 19.7 ], ROW2 + 1.3, { from: ROW2, roles: [ 'noClimb', 'noRun' ] } );

	// A wall 5.5 m over Row 2 along a 3.5 m trench, 5 m of it before the trench to run onto (the blueprint's 4 m, as
	// test_basic's span, was made only by a jump within a metre of the trench); a 0.15 m beam 6 m long; four girders,
	// gaps 1.8-2.1 m.
	L.wall( 'wallrun_wall', [ 67, 12.6, 79, 13 ], ROW2 + 5.5, { from: ROW1 } );
	L.beam( 'beam', [ 62, 15 ], [ 56, 15 ], ROW2, 0.15 );
	for ( const [ i, x ] of [ 45.6, 42.9, 40.4, 37.8 ].entries() ) L.block( `girder_${i}`, [ x, 13, x + 0.6, 17 ], ROW2, { from: ROW1 } );

	// ---- The drop off Row 2's west end into a pit; a drainpipe up to a ledge and a ladder on to Row 3 (its stretch
	// over the ladder climbable, to top out onto).

	L.block( 'pit_drop', [ 0, 14, 12, 30 ], DROP );
	L.block( 'pit_drop_side', [ 5, 10, 12, 14 ], DROP );
	L.block( 'ledge', [ 0, 10, 5, 14 ], ROW2 );
	L.pipe( 'drainpipe', [ 2.5, 14 ], 0, DROP, ROW2 );
	L.ladder( 'ladder', [ 2.5, 10 ], 0, ROW2, ROW3 );

	// ---- Row 3, east: the apparatus. Nets a storey down under the swing and the precision posts.

	// Up to the wall along Row 2 (where it stands).
	const R3 = 10 - WALL;
	L.block( 'row3_ladder', [ 0, 0, 5, 10 ], ROW3 );
	L.block( 'row3_a', [ 5, 0, 28, R3 ], ROW3, { roles: NO_CLIMB } );
	L.block( 'net_swing', [ 28, 0, 33, R3 ], ROW2 );
	L.block( 'row3_b', [ 33, 0, 40, R3 ], ROW3, { roles: NO_CLIMB } );
	L.block( 'net_precision', [ 40, 0, 54, R3 ], ROW2 );
	L.block( 'row3_c', [ 54, 0, 66, R3 ], ROW3, { roles: NO_CLIMB } );

	// A bar 1.3 m up to slide under (METRICS's comfortable) after 14 m of run-up; a swing bar 2.4 m over Row 3, 2 m out
	// over the 5 m net; three posts 0.8 m square, 2.6-3.2 m apart.
	L.slideUnder( 'slide_under', [ 18, 0.6 ], [ 18, 9.4 ], { on: ROW3, h: 1.3 } );
	L.bar( 'swing_bar', [ 30, 3 ], [ 30, 7 ], ROW3 + 2.4 );
	for ( const [ i, x ] of [ 43, 47, 51 ].entries() ) L.post( `precision_${i}`, [ x, 5 ], { r: 0.4, top: ROW3, from: ROW2, square: true } );

	// ---- The zipline off Row 3's east end into the plaza, a door to barge, and the finish with the gate.

	L.zip( 'zipline', [ 66, 5 ], ROW3, [ 96, 5, 2.6 ] );
	L.block( 'plaza', [ 66, 0, 108, 10 ], ROW1 );
	L.door( 'plaza_door', [ 107.85, 5 ], 90, { wall: { width: 10, height: 3, depth: 0.3 } } );
	L.block( 'plant_room', [ 96, 10, 108, 30 ], 10, { roles: [ 'noClimb', 'noRun' ] } );
	L.block( 'finish', [ 108, 0, 124, 30 ], ROW1 );
	L.door( 'gate', [ 123.85, 22 ], 90, { wall: { width: 3, height: 3, depth: 0.3 } } );
	L.valve( 'gate_valve', [ 123.685, 1.2, 20.9 ], 270 );
	L.block( 'gate_landing', [ 124, 20, 128, 24 ], ROW1 );

	// ---- Walls between the rows, 2 m over the higher side and out of bounds (no ledge on them, no wall run): Row 2's
	// trenches and nets and the plaza are as low as the row beside them, so without them a walk or a drop would take the
	// runner on to a later lesson (or back to an earlier one). The way from row to row is only the lessons' climbs: the
	// wallclimb at Row 2's east end, the drop and the ladder at the west.

	L.wall( 'divider_row1', [ 12, 20 - WALL, 84, 20 ], ROW2 + DIVIDER, { from: ROW1, roles: [ 'out' ] } );
	L.wall( 'divider_row3', [ 5, 10 - WALL, 66, 10 ], ROW3 + DIVIDER, { from: ROW1, roles: [ 'out' ] } );
	L.wall( 'divider_plaza', [ 66, 10 - WALL, 96, 10 ], ROW2 + DIVIDER, { from: ROW1, roles: [ 'out' ] } );

	// ---- The start, and the flags.

	L.spawn( FLAGS[ 0 ][ 1 ], FLAGS[ 0 ][ 2 ], FLAGS[ 0 ][ 3 ] );
	for ( const [ id, p, yaw, on ] of FLAGS ) L.flag( id, p, yaw, on );

	routes( L );

	// Parapets round the edge, the plaza door's wall and the gate's gap left out; and one between Row 1's start and
	// the drop pit, up to the edge's.
	L.parapets( [ [ 0, 0, 107.7, 0 ], [ 108, 0, 124, 0 ], [ 0, 0, 0, 30 ], [ 0, 30, 124, 30 ], [ 124, 0, 124, 20.5 ], [ 124, 23.5, 124, 30 ] ], [ 0, 0, 124, 30 ] );
	L.wall( 'parapet_start', [ 12, 20, 12.3, EDGE ], ROW1 + 1.3, { from: ROW1, roles: [ 'out' ] } );

	return L.done();

}

// The lessons' moves as the course's route, which the course validator checks and npm run reach drives. The strides
// and the precision posts have none: the benchmark's stations cover them.
function routes( L ) {

	const edge = ( prim, near ) => ( { prim, kind: 'edges', near } );
	const wall = ( prim, near ) => ( { prim, kind: 'walls', near } );
	const thing = ( prim, kind ) => ( { prim, kind } );

	L.route( 'jump', [ 28, ROW1, 25 ], [
		{ move: 'run', to: [ 31.7, ROW1, 25 ], kind: 'takeoff', ref: edge( 'row1_a', [ 32, ROW1, 25 ] ) },
		{ move: 'jump', to: [ 36, ROW1, 25 ], kind: 'land', ref: edge( 'row1_b', [ 34.5, ROW1, 25 ] ), params: { gap: 2.5, rise: 0 } },
	] );
	L.route( 'charge', [ 35.5, ROW1, 25 ], [
		{ move: 'run', to: [ 50.2, ROW1, 25 ], kind: 'takeoff', ref: edge( 'row1_b', [ 50.5, ROW1, 25 ] ) },
		{ move: 'jump', to: [ 56.2, ROW1, 25 ], kind: 'land', ref: edge( 'row1_c', [ 54.7, ROW1, 25 ] ), params: { gap: 4.2, rise: 0 } },
	] );
	for ( const [ name, prim, near, h, z0 ] of [ [ 'vault1', 'fence_090', 58.8, 0.9, 55.5 ], [ 'vault2', 'fence_120', 63.3, 1.2, 59.6 ] ] ) {

		L.route( name, [ z0, ROW1, 25 ], [
			{ move: 'run', to: [ near - 0.4, ROW1, 25 ], ref: edge( prim, [ near, h, 25 ] ) },
			{ move: 'vault', to: [ near + 2.3, ROW1, 25 ], kind: 'land', params: { height: h, depth: 0.4 } },
		] );

	}

	L.route( 'climb', [ 66.5, ROW1, 25 ], [
		{ move: 'run', to: [ 71.6, ROW1, 25 ], ref: edge( 'climb_wall', [ 72, 1.7, 25 ] ) },
		{ move: 'vault', to: [ 73.5, 1.7, 25 ], kind: 'land', params: { height: 1.7, depth: 12 } },
	] );
	L.route( 'wallclimb', [ 87, ROW1, 25.5 ], [
		{ move: 'run', to: [ 87, ROW1, 20.4 ] },
		{ move: 'wallclimb', to: [ 87, ROW2, 20 ], kind: 'edge', ref: edge( 'row2_climb', [ 87, ROW2, 20 ] ), params: { height: STOREY } },
		{ move: 'shimmy', to: [ 91.5, ROW2, 20 ], kind: 'edge', ref: edge( 'row2_climb', [ 91.5, ROW2, 20 ] ) },
		{ move: 'climbUp', to: [ 91.5, ROW2, 19 ], ref: edge( 'row2_climb', [ 91.5, ROW2, 20 ] ) },
	] );
	// Into the wall at about 18° (METRICS's comfortable 15-40°), onto it 1.5 m before the trench: the wall run and the
	// jump off it carry about 5 m. (npm run reach heads straight for the run's far end, so its run by hand never meets
	// the wall at this angle; Easy makes it.)
	L.route( 'wallrun', [ 86, ROW2, 17 ], [
		{ move: 'run', to: [ 75.5, ROW2, 13.6 ], kind: 'wall', ref: wall( 'wallrun_wall', [ 75.5, ROW2 + 1, 13 ] ) },
		{ move: 'wallrun', to: [ 68.5, ROW2, 13.6 ], refs: [ wall( 'wallrun_wall', [ 75.5, ROW2 + 1, 13 ] ) ] },
		{ move: 'run', to: [ 64, ROW2, 14 ] },
	] );
	L.route( 'balance', [ 65, ROW2, 15 ], [
		{ move: 'run', to: [ 62.3, ROW2, 15 ], kind: 'line', ref: thing( 'beam', 'beam' ) },
		{ move: 'beam', to: [ 55.7, ROW2, 15 ], refs: [ thing( 'beam', 'beam' ) ] },
		{ move: 'run', to: [ 52, ROW2, 15 ] },
	] );
	L.route( 'roll', [ 20, ROW2, 15 ], [
		{ move: 'run', to: [ 12.3, ROW2, 15 ], kind: 'takeoff' },
		{ move: 'drop', to: [ 9, DROP, 15 ], kind: 'land', params: { fall: ROW2 - DROP } },
		{ move: 'run', to: [ 5, DROP, 18 ] },
	] );
	L.route( 'pipe', [ 2.5, DROP, 20 ], [
		{ move: 'run', to: [ 2.5, DROP, 14.15 ], kind: 'line', ref: thing( 'drainpipe', 'pipe' ) },
		{ move: 'pipe', to: [ 2.5, ROW2, 14.15 ], kind: 'line', ref: thing( 'drainpipe', 'pipe' ) },
		{ move: 'climbUp', to: [ 2.5, ROW2, 13 ], ref: edge( 'ledge', [ 2.5, ROW2, 14 ] ) },
	] );
	L.route( 'ladder', [ 2.5, ROW2, 13 ], [
		{ move: 'run', to: [ 2.5, ROW2, 10.15 ], kind: 'line', ref: thing( 'ladder', 'ladder' ) },
		{ move: 'ladder', to: [ 2.5, ROW3, 10.15 ], kind: 'line', ref: thing( 'ladder', 'ladder' ) },
		{ move: 'climbUp', to: [ 2.5, ROW3, 9 ], ref: edge( 'row3_ladder', [ 2.5, ROW3, 10 ] ) },
	] );
	L.route( 'slide', [ 5.5, ROW3, 5 ], [
		{ move: 'slideUnder', to: [ 20.5, ROW3, 5 ] },
		{ move: 'run', to: [ 22, ROW3, 5 ] },
	] );
	L.route( 'swing', [ 22.5, ROW3, 5 ], [
		{ move: 'run', to: [ 27.7, ROW3, 5 ], kind: 'takeoff', ref: edge( 'row3_a', [ 28, ROW3, 5 ] ) },
		{ move: 'swing', to: [ 34, ROW3, 5 ], kind: 'land', refs: [ thing( 'swing_bar', 'bar' ) ], params: { height: 2.4 } },
	] );
	L.route( 'zipline', [ 57, ROW3, 5 ], [
		{ move: 'run', to: [ 65.7, ROW3, 5 ], kind: 'takeoff', ref: edge( 'row3_c', [ 66, ROW3, 5 ] ) },
		{ move: 'zipline', to: [ 97, ROW1, 5 ], kind: 'land', refs: [ thing( 'zipline', 'cable' ) ] },
	] );
	L.route( 'door', [ 101, ROW1, 5 ], [
		{ move: 'run', to: [ 107.4, ROW1, 5 ], kind: 'object', ref: thing( 'plaza_door', 'door' ) },
		{ move: 'door', to: [ 110, ROW1, 5 ], refs: [ thing( 'plaza_door', 'door' ) ] },
		{ move: 'run', to: [ 113, ROW1, 5 ] },
	] );
	L.route( 'gate', [ 119, ROW1, 20.9 ], [
		{ move: 'run', to: [ 123.1, ROW1, 20.9 ], kind: 'object', ref: thing( 'gate_valve', 'valve' ) },
		{ move: 'interact', to: [ 123.15, ROW1, 20.9 ], refs: [ thing( 'gate_valve', 'valve' ) ] },
	] );

}

export { tutorial };
