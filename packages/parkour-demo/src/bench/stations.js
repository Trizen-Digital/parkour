// The benchmark's stations, in the order the run takes them: every move and trick the runner has, most at four sizes
// (heights, gaps, drops) across the range the game allows. Each station is written in its own coordinates (x across,
// y up from its floor, z along from its entry; course.js lays them end to end) and says:
//
//   id        stable across changes (comments on the benchmark name it)
//   family    the group it belongs to (the timeline colours by it); name, and the size it is about (`size`, m)
//   length    from its entry to its exit (m); `ground: false` when it lays its own floor
//   build(b)  its features (course.js's StationBuilder)
//   steps     how the autopilot drives it (script.js); then it runs (`then`: 'sprint' by default) to the exit
//   expect    what must be seen for it to count: `states`, `moves` (names or patterns), `bail` (it must go limp); or a
//             function of `{ view }` giving them
//   done      when it is over, if not on foot within 2 m of its exit; `low` how far below its floor it may go (m);
//             `limit` how long it may take (s)

import * as obstacles from './stations/obstacles.js';
import * as gaps from './stations/gaps.js';
import * as strides from './stations/strides.js';
import * as walls from './stations/walls.js';
import * as ledges from './stations/ledges.js';
import * as swings from './stations/swings.js';
import * as climbs from './stations/climbs.js';
import * as doors from './stations/doors.js';
import * as ground from './stations/ground.js';
import * as landings from './stations/landings.js';
import * as tricks from './stations/tricks.js';

// Four heights across what each move takes: the vaults go over 0.7-1.2 m.
const VAULT_HEIGHTS = [ 0.75, 0.9, 1.05, 1.2 ];

// The air tricks short enough to land from a running jump on the level; the rest are timed to their landing but
// never played faster than they were captured, so they need a drop to finish before touchdown.
const SHORT_TRICKS = new Set( [ 'sideFlip', 'vortex', 'spin', 'frontFlip' ] );

const STATIONS = [
	obstacles.warmUp(),
	...[ 0.4, 0.5, 0.6 ].map( obstacles.hurdle ),
	...[ 'dash', 'speed', 'kong' ].flatMap( ( kind ) => VAULT_HEIGHTS.map( ( height ) => obstacles.vault( kind, height ) ) ),
	...VAULT_HEIGHTS.map( obstacles.powerJump ),
	...[ 0.8, 0.9, 1.6, 1.7 ].map( obstacles.hop ),
	obstacles.catchEdge( 1.4, { before: 1 } ), obstacles.catchEdge( 1.7, { before: 1.4 } ),
	obstacles.catchEdge( 2, { hold: obstacles.FULL, before: 1.6 } ), obstacles.catchEdge( 2.3, { hold: obstacles.FULL, before: 2.4 } ),
	...[ 2.9, 3.3, 3.6, 3.9 ].map( obstacles.wallclimb ),
	gaps.walkingJump(),
	gaps.gapJump( 0, 3.2 ), gaps.gapJump( 1, 3.4, { hold: obstacles.FULL } ), gaps.gapJump( 0, 4.5, { hold: obstacles.FULL } ),
	gaps.gapJump( - 1, 4, { hold: obstacles.TAP } ), gaps.gapJump( - 2, 5.5, { hold: obstacles.FULL } ), gaps.gapJump( - 3, 5, { roll: true } ),
	gaps.precisionJump( 2.4, 'jump' ), gaps.precisionJump( 3, 'step' ), gaps.precisionJump( 3.6, 'jump' ), gaps.precisionJump( 4.2, 'step' ),
	gaps.stride( 2.4 ), gaps.stride( 3 ),
	...[ 'level', 'steps', 'stones' ].map( strides.strides ),
	walls.wallRun( 2, 'left' ), walls.wallRun( 2.5, 'right' ), walls.wallRun( 3, 'left' ), walls.wallRun( 4, 'right' ),
	walls.offWallRun( 'jump', 'left' ), walls.offWallRun( 'jump', 'right' ), walls.offWallRun( 'turn', 'left' ), walls.offWallRun( 'dive', 'right' ),
	walls.wallRunGap( 2, 'right' ), walls.wallRunGap( 3, 'left' ),
	walls.wallKick(), walls.wallPlant(),
	ledges.shimmy( 2.3, 'left' ), ledges.shimmy( 3, 'right' ), ledges.shimmy( 3.4, 'left' ), ledges.shimmy( 3.8, 'right' ),
	ledges.corner( 'left' ), ledges.corner( 'right' ),
	ledges.leapUp( 1 ), ledges.leapUp( 1.4 ),
	ledges.leapAcross( 1, 'left' ), ledges.leapAcross( 1.5, 'right' ),
	ledges.letGo( 'drop' ), ledges.letGo( 'kick' ),
	ledges.freeHang(),
	swings.pole( 2.5, 6, 'slide' ), swings.pole( 3.5, 7, 'kick' ), swings.pole( 4.5, 8, 'turn' ), swings.pole( 6, 9.5, 'kick' ),
	...[ 2, 2.4, 2.8, 3.2 ].map( swings.bar ),
	swings.barToBar( 3 ), swings.barToBar( 3.5 ),
	...[ 4.5, 5.5, 6.5, 7.5 ].map( swings.rope ),
	...[ 3, 4.5, 6, 8 ].map( ( height ) => climbs.climb( 'pipe', height ) ),
	climbs.climbDown( 'pipe' ),
	...[ 3, 4.5, 6, 8 ].map( ( height ) => climbs.climb( 'ladder', height ) ),
	climbs.climbDown( 'ladder' ),
	climbs.zipline( 5 ), climbs.zipline( 10 ), climbs.zipline( 15 ), climbs.zipline( 20 ),
	doors.barge( 0.9, 2.1 ), doors.barge( 1, 2.2 ), doors.barge( 1.2, 2.4 ), doors.barge( 1.5, 2.6 ),
	doors.kick( 0.9, 2.1 ), doors.kick( 1.2, 2.4 ),
	doors.doorSwitch( 'valve', 0.9 ), doors.doorSwitch( 'valve', 1.4 ), doors.doorSwitch( 'button', 1 ), doors.doorSwitch( 'button', 1.5 ),
	ground.slide(),
	...[ 0.9, 1.1, 1.3, 1.5 ].map( ground.slideUnder ),
	...[ 15, 25, 35, 45 ].map( ground.slideDown ),
	...[ 0.1, 0.2, 0.35, 0.5 ].map( ground.beam ),
	ground.skidStop(),
	...[ 15, 30, 45, 60 ].map( ground.slope ),
	landings.drop( 1.5, false ), landings.drop( 3, false ), landings.drop( 4, false ),
	landings.drop( 3, true ), landings.drop( 6, true ), landings.drop( 8, true ), landings.drop( 9.5, true ),
	landings.fatalFall( 12 ),
	landings.goLimp(),
	landings.diveRoll(),
	tricks.cartwheel(), tricks.spinDive(), tricks.standingBackflip(),
	...tricks.AIR.flatMap( ( [ , , move ] ) => ( SHORT_TRICKS.has( move ) ? [ 0, 2, 4, 6 ] : [ 2, 4, 6, 8 ] ).map( ( drop ) => tricks.airTrick( move, drop ) ) ),
	tricks.airTrick( 'sideFlip', 6, { repeat: true } ), tricks.airTrick( 'vortex', 6, { repeat: true } ),
	tricks.airTrick( 'frontFlip', 6, { repeat: true } ), tricks.airTrick( 'spin', 6, { repeat: true } ),
];

// Ids are how comments find a station again: no two alike.
const ids = new Set();
for ( const station of STATIONS ) {

	if ( ids.has( station.id ) ) throw new Error( `bench: two stations are called ${station.id}` );
	ids.add( station.id );

}

export { STATIONS };
