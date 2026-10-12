// The Foundry: the demo's sandbox level, as the demo blueprint lays it out. 144 × 128 m, three times test_basic's area:
// a street-deep gap, the Cut (z -5 to 5), splits it into the Yard (south) and the Quay (north), joined by seven
// crossings that each ask for a different move. Three summits, the Crane and the Mill tower four storeys up and the
// Works top three, each have a fast way down. The street is 12 m down.
//
// Every route starts and ends at a hub: the Circuit (a bit of everything, home on the Long Line), the Low Road (never
// leaves the deck), Works (every way up, the chutes down), Mill (up the tower, the Long Chute) and the High Line (all
// two storeys over the street).

import { Level } from './level.js';

const DEG = Math.PI / 180;

// The street under the Cut, the tank pit and the map (m).
const STREET = - 12;

// A storey (m): every deck is a whole number of them up, each a comfortable wallclimb over the one below (METRICS: up
// to 3.2 m, kept clear of the limit). The blueprint planned 3.5, which the validator finds possible but not comfortable.
const STOREY = 3.1;
const up = ( n ) => + ( n * STOREY ).toFixed( 3 );

// The chutes' slope (°): just past METRICS's steepest walked slope (40°), so it is slid, and as long as it can be.
// The blueprint planned 30°, which the validator walks.
const CHUTE = 42;

// The chutes: the middle of the high end [ x, z ], the way down, the tops at each end; and the slide-under bar past the
// foot of two of them. Each is 4 m wide.
const CHUTES = [
	{ id: 'long_chute', high: [ 48, 46 ], dir: '-x', hi: up( 4 ), lo: 0, under: 'under_long' },
	{ id: 'roof_chute', high: [ 34, 18 ], dir: '-x', hi: up( 2 ), lo: 0, under: 'under_roof' },
	{ id: 'works_chute_upper', high: [ - 48, 8 ], dir: '+x', hi: up( 3 ), lo: up( 1 ) },
	{ id: 'works_chute_lower', high: [ - 26, 8 ], dir: '+x', hi: up( 1 ), lo: 0 },
];

// Where a chute's foot is, along x.
const footOf = ( { high, dir, hi, lo } ) => high[ 0 ] + ( dir === '-x' ? - 1 : 1 ) * ( hi - lo ) / Math.tan( CHUTE * DEG );

// A slide-under bar stands this far past its chute's foot (m), this high (METRICS's comfortable slide under).
const UNDER_PAST = 3.3;
const UNDER_HEIGHT = 1.3;

// The ziplines: the take-off edge [ x, z ] and the roof's height there, and the low end [ x, z, height ] (2.6 m over
// the floor it lands on).
const ZIPLINES = [
	{ id: 'zip_long', name: 'z1', roof: 'crane_roof_s', edge: [ 4.12, - 38 ], top: up( 4 ), low: [ 18, 30, 2.6 ] },
	{ id: 'zip_cross', name: 'z2', roof: 'mill_tower', edge: [ 48, 58 ], top: up( 4 ), low: [ - 40, 58, up( 1 ) + 2.6 ] },
	{ id: 'zip_works', name: 'z3', roof: 'works_top', edge: [ - 56.05, 5 ], top: up( 3 ), low: [ - 10, - 30, 2.6 ] },
];

function foundry() {

	const L = new Level( {
		name: 'foundry',
		about: 'The Foundry: two hubs, the Yard and the Quay, either side of the Cut, joined by seven crossings; three summits with a fast way down from each; three ziplines up to 88 m and three long chutes. Every route starts and ends at a hub.',
		street: STREET,
	} );

	// ---- The Yard, the south half, and the buildings round it.

	L.block( 'yard', [ - 26, 5, 34, 64 ], 0 );
	// The slot between the Mill's steps where the Long Chute comes down.
	L.block( 'chute_slot', [ 34, 44, 48, 48 ], 0 );
	L.block( 'works_terrace', [ - 48, 5, - 26, 64 ], up( 1 ) );
	L.block( 'works_roof', [ - 72, 26, - 48, 64 ], up( 2 ) );
	L.block( 'works_top', [ - 72, 5, - 48, 26 ], up( 3 ) );
	L.block( 'mill_roof', [ 34, 5, 72, 30 ], up( 2 ) );
	L.block( 'mill_step_a', [ 34, 30, 48, 44 ], up( 1 ) );
	L.block( 'mill_step_b', [ 34, 48, 48, 64 ], up( 1 ) );
	// Too tall to climb from any side: the drainpipe and the ladder go up it.
	L.block( 'mill_tower', [ 48, 30, 72, 64 ], up( 4 ), { roles: [ 'noRun' ] } );

	// The piers out into the Cut: the long jump's (3.8 m apart, METRICS's comfortable at a sprint) and the billboard's.
	L.block( 'pier_j1_s', [ - 8, 1.9, - 2, 5 ], 0 );
	L.block( 'pier_w1_s', [ 8, 2, 12, 5 ], 0 );

	// Two containers 3.5 m apart: a corridor to wall run down. The east one is open, a door at each end.
	L.block( 'container', [ - 16, 12, - 10, 30 ], 3.2, { from: 0 } );
	container( L );

	// ---- The Quay, the north half.

	L.block( 'quay', [ - 30, - 64, 30, - 5 ], 0 );
	L.block( 'pier_j1_n', [ - 8, - 5, - 2, - 1.9 ], 0 );
	L.block( 'pier_w1_n', [ 8, - 5, 12, - 2 ], 0 );
	L.block( 'pier_bar', [ 18, - 5, 24, - 3 ], 0 );
	L.block( 'store', [ - 48, - 30, - 30, - 5 ], up( 1 ) );
	L.block( 'works_annex', [ - 72, - 36, - 48, - 5 ], up( 2 ) );
	L.block( 'water_tower', [ - 72, - 64, - 48, - 36 ], up( 3 ) );
	L.block( 'store_roof', [ - 48, - 64, - 30, - 30 ], up( 2 ) );
	crane( L );
	L.gantry( 'gantry_w1', [ - 30, - 48, - 22, - 40 ], up( 2 ) );
	L.gantry( 'gantry_w2', [ - 18, - 48, - 6, - 40 ], up( 2 ) );
	L.gantry( 'gantry_e', [ 6, - 48, 30, - 40 ], up( 2 ) );
	L.block( 'pump_house', [ 30, - 20, 43, - 5 ], up( 2 ), { roles: [ 'noRun' ] } );
	L.block( 'tank_roof', [ 48, - 30, 72, - 5 ], up( 2 ) );
	L.block( 'tank_farm', [ 48, - 64, 72, - 30 ], up( 2 ) );

	// ---- Long chutes, each ending at a slide-under bar or another chute.

	for ( const chute of CHUTES ) {

		const [ x, z ] = chute.high, foot = footOf( chute );
		L.chute( chute.id, [ Math.min( x, foot ), z - 2, Math.max( x, foot ), z + 2 ], chute );
		if ( chute.under ) L.slideUnder( chute.under, [ foot - UNDER_PAST, z - 2.5 ], [ foot - UNDER_PAST, z + 2.5 ], { h: UNDER_HEIGHT } );

	}

	// ---- Wall runs: the billboard across the 4 m between the piers, the hoarding across the Gantry's 4 m gap two
	// storeys up. The containers' corridor is the third.

	L.wall( 'billboard', [ 7.6, - 4, 8, 4 ], 5.5 );
	L.wall( 'hoarding', [ - 24, - 48.4, - 16, - 48 ], up( 2 ) + 5.5, { from: 0 } );

	// ---- Vaults: the lane of fences by the spawn, cargo on the Quay. The blueprint had a springboard into a crate into a
	// catch at each hub, but the runner has no springboard move yet (a 0.6 m step stops a run dead unless it is jumped
	// onto) nor a wallclimb from a crate's top, so they are left out until it has.

	L.fence( 'fence_090', [ 2, 47.8, 6, 48.2 ], 0.9 );
	L.fence( 'fence_100', [ 2, 41.8, 6, 42.2 ], 1 );
	L.fence( 'fence_120', [ 2, 35.8, 6, 36.2 ], 1.2 );
	L.fence( 'cargo_120', [ - 4, - 18, 0, - 14 ], 1.2 );
	L.fence( 'cargo_170', [ 4, - 24, 8, - 20 ], 1.7 );
	L.fence( 'fence_quay', [ - 2, - 28.2, 4, - 27.8 ], 0.9 );

	// ---- Strides: girders 0.6 m deep over the Cut, gaps 1.8-2.6 m (a stride takes 1.6-2.95 m). G1 a storey up from the
	// Works terrace to the Store, G2 about two up from the Mill roof to the Tank roof (each a little off level), and the
	// stepping stones, G3, from the Pump house over the tank pit to the tank tops.

	for ( const [ i, [ z0, z1 ] ] of [ [ 2.4, 3 ], [ - 0.5, 0.1 ], [ - 2.9, - 2.3 ] ].entries() ) {

		L.block( `girder_g1_${i}`, [ - 34, z0, - 30, z1 ], up( 1 ) );
		L.block( `girder_g2_${i}`, [ 58, z0, 62, z1 ], up( 2 ) + [ 0.3, - 0.2, 0.2 ][ i ] );

	}

	[ [ - 22.8, - 22.2 ], [ - 26, - 25.4 ], [ - 28.5, - 27.9 ], [ - 31.5, - 30.9 ], [ - 34.1, - 33.5 ], [ - 37.2, - 36.6 ], [ - 39.9, - 39.3 ] ]
		.forEach( ( [ z0, z1 ], i ) => L.block( `stone_g3_${i}`, [ 38.7, z0, 39.3, z1 ], up( 2 ) ) );

	// ---- Precision: three round tank tops two storeys over the tank pit (the middle one the High Line's hub), and
	// three bollards by the spawn.

	L.post( 'tank_top_w', [ 33.4, - 44 ], { r: 0.6, top: up( 2 ) } );
	L.post( 'tank_top_hub', [ 39, - 44 ], { r: 1.6, top: up( 2 ) } );
	L.post( 'tank_top_e', [ 44, - 44 ], { r: 0.6, top: up( 2 ) } );
	for ( const [ i, x ] of [ - 14, - 17.2, - 20.4 ].entries() ) L.post( `bollard_${i}`, [ x, 58 ], { r: 0.3, top: 1, from: 0 } );

	// ---- Beams and bars: B1 over the Cut at the deck, B2 two storeys up; the bar pair over the Cut; a bar from the
	// Pump house to the Tank roof. A bar hangs 2.4 m over its take-off (METRICS's comfortable).

	L.beam( 'beam_b1', [ - 14, 5 ], [ - 14, - 5 ], 0, 0.15 );
	L.beam( 'beam_b2', [ 39, 5 ], [ 39, - 5 ], up( 2 ), 0.2 );
	L.bar( 'bar_b1', [ 20, 3 ], [ 22, 3 ], 2.4 );
	L.bar( 'bar_b2', [ 20, - 1 ], [ 22, - 1 ], 2.4 );
	L.bar( 'bar_b3', [ 45.5, - 14 ], [ 45.5, - 11 ], up( 2 ) + 2.4 );

	// ---- The way up: ladders, drainpipes (the routes below list them); and down: poles, 1.1 m over the roof beside.

	for ( const [ id, at, yaw, from, to ] of LADDERS ) L.ladder( id, at, yaw, from, to );
	for ( const [ id, at, yaw, from, to ] of PIPES ) L.pipe( id, at, yaw, from, to );
	L.pole( 'pole_po1', [ 32, 10 ], 0, up( 2 ) + 1.1 );
	L.pole( 'pole_po2', [ 18, - 37.5 ], 0, up( 2 ) + 1.1 );
	L.pole( 'pole_po3', [ - 46, 34 ], up( 1 ), up( 2 ) + 1.1 );

	// ---- Ziplines, each landing with 4 m or more to run out: the Long Line from the Crane to the Yard, the Cross Line
	// from the Mill tower to the Works terrace, the Works Line from the Works top to the Quay.

	for ( const { id, edge, top, low } of ZIPLINES ) L.zip( id, edge, top, low );

	// ---- Where runs start: the Yard (A), and the Mill roof (B) for the High Line.

	L.spawn( [ 4, 58 ], 180 );
	L.flag( 'mill_roof', [ 44, 24 ], 180, up( 2 ) );

	routes( L );

	// Parapets where the decks meet the edge of the map.
	L.parapets( [ [ - 72, 64, 72, 64 ], [ - 72, 5, - 72, 64 ], [ 72, 5, 72, 64 ], [ - 72, - 64, 30, - 64 ], [ 48, - 64, 72, - 64 ], [ - 72, - 64, - 72, - 5 ], [ 72, - 64, 72, - 5 ] ], [ - 72, - 64, 72, 64 ] );

	return L.done();

}

// Ladders and drainpipes: a face's foot [ x, z ] facing out along a yaw, from one floor to the top; and the top they
// climb onto.
const LADDERS = [
	[ 'ladder_l1', [ - 26, 54 ], 90, 0, up( 1 ), 'works_terrace' ],
	[ 'ladder_l2', [ - 6, - 44 ], 270, up( 2 ), up( 4 ), 'crane_roof_n' ],
	[ 'ladder_l3', [ - 30, - 34 ], 90, 0, up( 2 ), 'store_roof' ],
	[ 'ladder_l4', [ 60, 30 ], 180, up( 2 ), up( 4 ), 'mill_tower' ],
];
const PIPES = [
	[ 'pipe_p1', [ - 48, 44 ], 90, up( 1 ), up( 2 ), 'works_roof' ],
	[ 'pipe_p2', [ 48, 38 ], 270, up( 1 ), up( 4 ), 'mill_tower' ],
	[ 'pipe_p3', [ - 48, - 18 ], 90, up( 1 ), up( 2 ), 'works_annex' ],
];

// The open container: two side walls and a roof 3.2 m up, a door at each end. D1 at the south end is barged; D2 at the
// north end opens from its button inside.
function container( L ) {

	const x0 = - 6.5, x1 = - 0.5, z0 = 12, z1 = 30, top = 3.2, skin = 0.2;
	L.wall( 'box_west', [ x0, z0, x0 + skin, z1 ], top - skin, { from: 0 } );
	L.wall( 'box_east', [ x1 - skin, z0, x1, z1 ], top - skin, { from: 0 } );
	L.wall( 'box_roof', [ x0, z0, x1, z1 ], top, { from: top - skin } );
	const wall = { width: x1 - x0 - 2 * skin, height: top - skin, depth: skin };
	L.door( 'door_d1', [ - 3.5, z1 - skin / 2 ], 180, { wall } );
	L.door( 'door_d2', [ - 3.5, z0 + skin / 2 ], 180, { wall } );
	L.button( 'button_d2', [ - 1.6, 1.2, z0 + skin + 0.015 ], 0 );

}

// The Crane: a tower four storeys tall with a room in its base. The valve door D3 lets in from the Quay (2.5 m tall: a
// running lane's headroom); inside, a ladder up a core against the north wall comes out through a hatch on top.
// Outside, a ladder goes up its west face from the Gantry.
function crane( L ) {

	const x0 = - 6, x1 = 6, z0 = - 50, z1 = - 38, top = up( 4 ), skin = 0.5, roof = 0.4;
	L.decks.push( { r: [ x0, z0, x1, z1 ], top } );
	L.wall( 'crane_north', [ x0, z0, x1, z0 + skin ], top, { from: 0, roles: [ 'noRun' ] } );
	L.wall( 'crane_west', [ x0, z0 + skin, x0 + skin, z1 - skin ], top, { from: 0, roles: [ 'noRun' ] } );
	L.wall( 'crane_east', [ x1 - skin, z0 + skin, x1, z1 - skin ], top, { from: 0, roles: [ 'noRun' ] } );
	L.door( 'door_d3', [ 0, z1 - skin / 2 ], 0, { height: 2.5, wall: { width: x1 - x0, height: top, depth: skin } } );
	L.valve( 'valve_d3', [ 2.6, 1.2, z1 + 0.015 ], 0 );

	// The core the ladder climbs, and the roof round the hatch over the ladder.
	const core = [ - 1.5, z0 + skin, 1.5, - 44 ], hatch = [ - 1, - 44, 1, - 42.8 ];
	L.wall( 'crane_core', core, top - roof, { from: 0 } );
	L.ladder( 'ladder_l5', [ 0, core[ 3 ] ], 0, 0, top );
	L.wall( 'crane_roof_n', [ x0 + skin, z0 + skin, x1 - skin, hatch[ 1 ] ], top, { from: top - roof } );
	L.wall( 'crane_roof_w', [ x0 + skin, hatch[ 1 ], hatch[ 0 ], z1 - skin ], top, { from: top - roof } );
	L.wall( 'crane_roof_e', [ hatch[ 2 ], hatch[ 1 ], x1 - skin, z1 - skin ], top, { from: top - roof } );
	L.wall( 'crane_roof_s', [ hatch[ 0 ], hatch[ 3 ], hatch[ 2 ], z1 - skin ], top, { from: top - roof } );

}

// The level's moves, a stretch of route each: every crossing of the Cut, every way up and every fast way down, so the
// course validator checks each one and npm run reach drives it.
function routes( L ) {

	const edge = ( prim, near ) => ( { prim, kind: 'edges', near } );
	const wall = ( prim, near ) => ( { prim, kind: 'walls', near } );
	const thing = ( prim, kind ) => ( { prim, kind } );
	// A point `d` metres out from a face along a heading (degrees), at a height.
	const out = ( [ x, z ], yaw, d, y ) => [ x + Math.sin( yaw * DEG ) * d, y, z + Math.cos( yaw * DEG ) * d ];

	// ---- The crossings: the long jump, the beams, the billboard, the bars.

	L.route( 'j1', [ - 4, 0, 11.4 ], [
		{ move: 'run', to: [ - 4, 0, 2.2 ], kind: 'takeoff', ref: edge( 'pier_j1_s', [ - 4, 0, 1.9 ] ) },
		{ move: 'jump', to: [ - 4, 0, - 3.4 ], kind: 'land', ref: edge( 'pier_j1_n', [ - 4, 0, - 1.9 ] ), params: { gap: 3.8, rise: 0 } },
	] );
	for ( const [ name, x, y, z0 ] of [ [ 'b1', - 14, 0, 11 ], [ 'b2', 39, up( 2 ), 13 ] ] ) {

		const beam = thing( `beam_${name}`, 'beam' );
		L.route( name, [ x, y, z0 ], [
			{ move: 'run', to: [ x, y, 5.3 ], kind: 'line', ref: beam },
			{ move: 'beam', to: [ x, y, - 5.3 ], refs: [ beam ] },
			{ move: 'run', to: [ x, y, - 9 ] },
		] );

	}

	L.route( 'w1', [ 11.5, 0, 14 ], [
		{ move: 'run', to: [ 8.5, 0, 3.5 ], kind: 'wall', ref: wall( 'billboard', [ 8, 1, 3.5 ] ) },
		{ move: 'wallrun', to: [ 8.6, 0, - 3.5 ], refs: [ wall( 'billboard', [ 8, 1, 3.5 ] ) ] },
		{ move: 'run', to: [ 9, 0, - 9 ] },
	] );
	L.route( 'bars', [ 21, 0, - 14 ], [
		{ move: 'run', to: [ 21, 0, - 3.3 ], kind: 'takeoff', ref: edge( 'pier_bar', [ 21, 0, - 3 ] ) },
		{ move: 'swing', to: [ 21, 2.4, 3 ], kind: 'line', ref: thing( 'bar_b1', 'bar' ), refs: [ thing( 'bar_b2', 'bar' ) ], params: { height: 2.4, distance: 4 } },
		{ move: 'swing', to: [ 21, 0, 7.5 ], kind: 'land', refs: [ thing( 'bar_b1', 'bar' ) ] },
	] );

	// ---- Wall runs: the Gantry's hoarding, the containers' corridor.

	L.route( 'w3', [ - 29.5, up( 2 ), - 44 ], [
		{ move: 'run', to: [ - 22.6, up( 2 ), - 47.4 ], kind: 'wall', ref: wall( 'hoarding', [ - 22.6, up( 2 ) + 1, - 48 ] ) },
		{ move: 'wallrun', to: [ - 17.4, up( 2 ), - 47.4 ], refs: [ wall( 'hoarding', [ - 22.6, up( 2 ) + 1, - 48 ] ) ] },
		{ move: 'run', to: [ - 12, up( 2 ), - 46 ] },
	] );
	L.route( 'w2', [ - 6.5, 0, 38 ], [
		{ move: 'run', to: [ - 9.4, 0, 29 ], kind: 'wall', ref: wall( 'container', [ - 10, 1, 29 ] ) },
		{ move: 'wallrun', to: [ - 9.4, 0, 22 ], refs: [ wall( 'container', [ - 10, 1, 29 ] ) ] },
		{ move: 'run', to: [ - 8.25, 0, 10 ] },
	] );

	// ---- Swing bar b3 from the Pump house to the Tank roof.

	L.route( 'b3', [ 33, up( 2 ), - 12.5 ], [
		{ move: 'run', to: [ 42.7, up( 2 ), - 12.5 ], kind: 'takeoff', ref: edge( 'pump_house', [ 43, up( 2 ), - 12.5 ] ) },
		{ move: 'swing', to: [ 50, up( 2 ), - 12.5 ], kind: 'land', refs: [ thing( 'bar_b3', 'bar' ) ], params: { height: 2.4 } },
	] );

	// ---- Wallclimbs: up a face (its foot [ x, z ], facing the runner along yaw), a storey from a floor to its top.

	for ( const [ name, prim, at, yaw, floor ] of [
		[ 'f1', 'works_terrace', [ - 26, 48 ], 90, 0 ],
		[ 'f2', 'works_roof', [ - 48, 38 ], 90, up( 1 ) ],
		[ 'f3', 'works_top', [ - 63, 26 ], 0, up( 2 ) ],
		[ 'f4', 'mill_step_a', [ 34, 37 ], 270, 0 ],
		[ 'f5', 'mill_roof', [ 41, 30 ], 0, up( 1 ) ],
		[ 'f6', 'store', [ - 30, - 22 ], 90, 0 ],
		[ 'f7', 'store_roof', [ - 40, - 30 ], 0, up( 1 ) ],
		[ 'f9', 'water_tower', [ - 48, - 50 ], 90, up( 2 ) ],
		[ 'f10', 'water_tower', [ - 60, - 36 ], 0, up( 2 ) ],
	] ) {

		const top = floor + STOREY;
		L.route( name, out( at, yaw, 8, floor ), [
			{ move: 'run', to: out( at, yaw, 0.4, floor ) },
			{ move: 'wallclimb', to: out( at, yaw, 0, top ), kind: 'edge', ref: edge( prim, out( at, yaw, 0, top ) ), params: { height: STOREY } },
			{ move: 'climbUp', to: out( at, yaw, - 1, top ), ref: edge( prim, out( at, yaw, 0, top ) ) },
		] );

	}

	// ---- Ladders and drainpipes, from their foot to the top they climb onto.

	for ( const [ move, list ] of [ [ 'ladder', LADDERS ], [ 'pipe', PIPES ] ] ) {

		for ( const [ prim, at, yaw, floor, top, onto ] of list ) {

			const line = thing( prim, move );
			L.route( prim.replace( /^\w+_/, '' ), out( at, yaw, 6, floor ), [
				{ move: 'run', to: out( at, yaw, 0.15, floor ), kind: 'line', ref: line },
				{ move, to: out( at, yaw, 0.15, top ), kind: 'line', ref: line },
				{ move: 'climbUp', to: out( at, yaw, - 1, top ), ref: edge( onto, out( at, yaw, 0, top ) ) },
			] );

		}

	}

	// ---- The doors: D1 barged into the container, D2 opened from its button, D3 from its valve, and the ladder up
	// inside the Crane.

	L.route( 'd1', [ - 3.5, 0, 41 ], [
		{ move: 'run', to: [ - 3.5, 0, 30.4 ], kind: 'object', ref: thing( 'door_d1', 'door' ) },
		{ move: 'door', to: [ - 3.5, 0, 27 ], refs: [ thing( 'door_d1', 'door' ) ] },
		{ move: 'run', to: [ - 3.5, 0, 20 ] },
	] );
	L.route( 'd2', [ - 1.6, 0, 18 ], [
		{ move: 'run', to: [ - 1.6, 0, 12.9 ], kind: 'object', ref: thing( 'button_d2', 'button' ) },
		{ move: 'interact', to: [ - 1.6, 0, 12.85 ], refs: [ thing( 'button_d2', 'button' ) ] },
	] );
	L.route( 'd3', [ 2.6, 0, - 31 ], [
		{ move: 'run', to: [ 2.6, 0, - 37.3 ], kind: 'object', ref: thing( 'valve_d3', 'valve' ) },
		{ move: 'interact', to: [ 2.6, 0, - 37.25 ], refs: [ thing( 'valve_d3', 'valve' ) ] },
	] );
	L.route( 'l5', [ 0, 0, - 37 ], [
		{ move: 'run', to: [ 0, 0, - 43.85 ], kind: 'line', ref: thing( 'ladder_l5', 'ladder' ) },
		{ move: 'ladder', to: [ 0, up( 4 ), - 43.85 ], kind: 'line', ref: thing( 'ladder_l5', 'ladder' ) },
		{ move: 'climbUp', to: [ 0, up( 4 ), - 45 ], ref: edge( 'crane_roof_n', [ 0, up( 4 ), - 44 ] ) },
	] );

	// ---- Vaults: the fence lane from the spawn, the cargo and the fence on the Quay.

	for ( const [ name, prim, x, near, far, h, depth, z0, top ] of [
		[ 'v1', 'fence_090', 4, 48.2, 47.8, 0.9, 0.4, 58, 0 ],
		[ 'v2', 'fence_100', 4, 42.2, 41.8, 1, 0.4, 47, 0 ],
		[ 'v3', 'fence_120', 4, 36.2, 35.8, 1.2, 0.4, 41, 0 ],
		[ 'v4', 'fence_quay', 1, - 28.2, - 27.8, 0.9, 0.4, - 37, 0 ],
		[ 'v5', 'cargo_170', 6, - 24, - 20, 1.7, 4, - 33, 1.7 ],
		[ 'v6', 'cargo_120', - 2, - 18, - 14, 1.2, 4, - 27, 1.2 ],
	] ) {

		const dir = Math.sign( far - near );
		L.route( name, [ x, 0, z0 ], [
			{ move: 'run', to: [ x, 0, near - dir * 0.4 ], ref: edge( prim, [ x, h, near ] ) },
			{ move: 'vault', to: [ x, top, top ? near + dir * 1.5 : far + dir * 1.9 ], kind: 'land', params: { height: h, depth } },
		] );

	}

	// ---- Chutes: slid from the top of the slope to its foot, and the slide-under bars after two of them.

	CHUTES.forEach( ( chute, i ) => {

		const { id, high: [ x, z ], hi, lo } = chute, foot = footOf( chute ), d = Math.sign( foot - x ), slope = thing( id, 'slopes' );
		L.route( `s${i + 1}`, [ x - d * 7, hi, z ], [
			{ move: 'run', to: [ x + d * 0.3, hi, z ], kind: 'slope', ref: slope },
			{ move: 'slide', to: [ foot + d * 0.5, lo, z ], refs: [ slope ] },
		] );
		if ( chute.under ) L.route( `u${i + 1}`, [ foot + d * 0.8, lo, z ], [
			{ move: 'slideUnder', to: [ foot + d * ( UNDER_PAST + 2.5 ), lo, z ] },
			{ move: 'run', to: [ foot + d * ( UNDER_PAST + 6 ), lo, z ] },
		] );

	} );

	// ---- Ziplines: run off the take-off edge at the cable, ride it to its low end.

	for ( const { id, name, roof, edge: [ ex, ez ], top, low: [ lx, lz, lh ] } of ZIPLINES ) {

		const run = Math.hypot( lx - ex, lz - ez ), ux = ( lx - ex ) / run, uz = ( lz - ez ) / run;
		const ground = lh - 2.6;
		L.route( name, [ ex - ux * 9, top, ez - uz * 9 ], [
			{ move: 'run', to: [ ex - ux * 0.3, top, ez - uz * 0.3 ], kind: 'takeoff', ref: edge( roof, [ ex, top, ez ] ) },
			{ move: 'zipline', to: [ lx + ux, ground, lz + uz ], kind: 'land', refs: [ thing( id, 'cable' ) ] },
		] );

	}

	// ---- Drops worth a roll: two storeys off the Mill roof, off the Gantry, off the Works top.

	for ( const [ name, prim, at, heading, floor, below ] of [
		[ 'dr1', 'mill_roof', [ 34, 24 ], 270, up( 2 ), 0 ],
		[ 'dr2', 'gantry_w2', [ - 8.6, - 40 ], 0, up( 2 ), 0 ],
		[ 'dr3', 'works_top', [ - 48, 21 ], 90, up( 3 ), up( 1 ) ],
	] ) {

		L.route( name, out( at, heading, - 7, floor ), [
			{ move: 'run', to: out( at, heading, - 0.3, floor ), kind: 'takeoff', ref: edge( prim, [ at[ 0 ], floor, at[ 1 ] ] ) },
			{ move: 'drop', to: out( at, heading, 3, below ), kind: 'land', params: { fall: floor - below } },
			{ move: 'run', to: out( at, heading, 7, below ) },
		] );

	}

}

export { foundry };
