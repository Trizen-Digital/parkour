import { BLENDS } from '../blends.js';
import { ClipPlayer } from '../ClipPlayer.js';
import { DirectionalBlend } from '../DirectionalBlend.js';
import { IdleShuffle } from '../IdleShuffle.js';
import { StateMachine } from '../StateMachine.js';
import { Switch } from '../Switch.js';

// Speeds the states change at (m/s).
// Moving at all: standing about gives way to a walk, and a walk slowing below it stands.
const MOVING = 0.15;
// A walk breaks into a run above this, and a run slows to a walk below it.
const RUN = 3;
// Getting up from a landing already running.
const RUN_FROM_LANDING = 2.5;
// Walking off from a back flip's landing.
const WALK_FROM_BACKFLIP = 1.25;
// A standing take-off lands to stand below this (above it, it goes on into the fall).
const STAND_FROM_TAKEOFF = 2;
// A landing at a run runs on (with the landing dip) above this; slower, it lands to stand.
const LAND_AT_A_RUN = 3.5;

// A landing at a run dips the body (the `landingDip` move, on the landing layer), seen from behind and only when no
// other move plays.
function landingDip( graph ) {

	if ( graph.inputs.thirdPerson && ! graph.moves.playing() ) graph.moves.play( 'landingDip' );

}

/**
 * On foot: standing about, walking, running, taking off and landing, bumping into a wall.
 * @param {TakeLibrary} library
 * @returns {StateMachine}
 */
function locomotion( library ) {

	const turning = ( v ) => [ v.turnRate, v.speed ];

	// The run, leaning into its turns.
	const runTurn = new DirectionalBlend( BLENDS.runTurn, turning, library );

	// Breaking into a run: from behind, the run start; in first person the run itself.
	const runStart = new ClipPlayer( 'ground_run_start' );
	const runStartTurn = new DirectionalBlend( BLENDS.runTurn, turning, library );

	// The walk, or along a beam the balance walk with the arms out.
	const walkTurn = new DirectionalBlend( BLENDS.walkTurn, turning, library );
	const balance = new DirectionalBlend( BLENDS.balanceWalk, turning, library );
	const walk = new Switch( ( v ) => v.onBeam, { on: 0.3, off: 0.3 }, balance, walkTurn );

	// A running take-off: a plain jump, else a leap off the leading foot.
	const runJump = new ClipPlayer( 'air_takeoff_run' );
	const left = new ClipPlayer( 'air_takeoff_left' );
	const right = new ClipPlayer( 'air_takeoff_right' );
	const takeoff = new Switch( ( v ) => v.plainJump, { on: 0.25, off: 0.25 }, runJump,
		new Switch( ( v ) => v.leftFootLeads, { on: 0.1, off: 0.1 }, left, right ) );

	const machine = new StateMachine( 'locomotion', {
		entry: null,
		idle: new IdleShuffle( [ 'ground_idle', 'ground_idle_shift', 'ground_idle_look' ], { fade: 0.25 } ),
		inAir: new ClipPlayer( 'air_hold' ),
		land: new ClipPlayer( 'land_to_stand' ),
		run: runTurn,
		walk: { pose: walk, players: [ walkTurn, balance ] },
		runTakeoff: { pose: takeoff, players: [ left, right, runJump ] },
		wallBump: new ClipPlayer( 'ground_wall_bump' ),
		// A wall coming up in the air: the push-off held (hands and feet toward it, as the kick off it starts) before the
		// body meets it.
		wallReach: new ClipPlayer( 'wall_kick_left', { rate: () => 0, start: 0.1 } ),
		standTakeoff: new ClipPlayer( 'air_takeoff_standing' ),
		runStart: { pose: new Switch( ( v ) => v.thirdPerson, { on: 0.1, off: 0.1 }, runStart, runStartTurn ), players: [ runStart, runStartTurn ] },
		backflipLand: new ClipPlayer( 'land_to_stand' ),
	}, 'entry' );

	const grounded = ( v ) => ! v.inAir;

	// Where a restart goes once it has held for its first update (a move that covered the body has ended): on into the
	// run at running speed, breaking into it from standing with sprint held, else the walk.
	machine.from( 'entry' )
		.to( 'inAir', 0.2, ( v ) => v.inAir && ! v.backflipLanding )
		.to( 'backflipLand', 0.2, ( v ) => v.backflipLanding )
		.to( 'run', 0.2, ( v ) => grounded( v ) && v.speed > RUN )
		.to( 'runStart', 0.2, ( v ) => grounded( v ) && v.sprinting )
		.to( 'walk', 0.2, ( v ) => ! v.inAir && ! v.backflipLanding );

	machine.from( 'idle' )
		.to( 'runStart', 0.3, ( v ) => v.speed > MOVING && grounded( v ) && v.sprinting )
		.to( 'walk', 0.2, ( v ) => v.speed > MOVING && grounded( v ) && ! v.sprinting )
		.to( 'standTakeoff', 0.2, ( v ) => v.inAir );

	machine.from( 'inAir' )
		.to( 'wallBump', 0.15, ( v ) => v.wallAhead )
		.to( 'wallReach', 0.2, ( v ) => v.wallComing )
		.to( 'land', 0.2, ( v ) => v.speed < LAND_AT_A_RUN && grounded( v ) )
		.to( 'run', 0.2, ( v ) => v.speed > LAND_AT_A_RUN && grounded( v ), { onStart: landingDip } );

	machine.from( 'land' )
		.to( 'run', 0.35, ( v ) => v.speed > RUN_FROM_LANDING && grounded( v ) )
		.to( 'walk', 0.35, ( v ) => v.speed > MOVING && grounded( v ) )
		.to( 'standTakeoff', 0.1, ( v ) => v.inAir )
		.toWhenDone( 'idle', 0.35 );

	machine.from( 'run' )
		.to( 'walk', 0.55, ( v ) => v.speed < RUN )
		.to( 'runTakeoff', 0.15, ( v ) => v.inAir );

	// A walk speeding up runs on from it (the run start is for breaking into a run from standing).
	machine.from( 'walk' )
		.to( 'run', 0.35, ( v ) => v.speed > RUN && grounded( v ) )
		.to( 'runTakeoff', 0.2, ( v ) => v.inAir )
		.to( 'idle', 0.25, ( v ) => v.speed < MOVING );

	machine.from( 'runTakeoff' )
		.to( 'run', 0.2, ( v ) => v.speed > LAND_AT_A_RUN && grounded( v ), { onStart: landingDip } )
		.to( 'wallBump', 0.15, ( v ) => v.wallAhead )
		.to( 'wallReach', 0.2, ( v ) => v.wallComing )
		.to( 'land', 0.1, ( v ) => v.speed < LAND_AT_A_RUN && grounded( v ) )
		.toWhenDone( 'inAir', 0.35 );

	machine.from( 'wallReach' )
		.to( 'wallBump', 0.15, ( v ) => v.wallAhead )
		.to( 'land', 0.2, grounded )
		.to( 'inAir', 0.3, ( v ) => ! v.wallComing );

	machine.from( 'wallBump' )
		.toWhenDone( 'inAir', 0.35 )
		.to( 'land', 0.2, grounded );

	machine.from( 'standTakeoff' )
		.toWhenDone( 'inAir', 0.35 )
		.to( 'wallBump', 0.2, ( v ) => v.wallAhead )
		.to( 'wallReach', 0.2, ( v ) => v.wallComing )
		.to( 'land', 0.15, ( v ) => v.speed < STAND_FROM_TAKEOFF && grounded( v ) );

	machine.from( 'runStart' )
		.to( 'runTakeoff', 0.2, ( v ) => v.inAir )
		.to( 'idle', 0.3, ( v ) => v.speed < MOVING && grounded( v ) )
		.toWhenDone( 'run', 0.25 );

	machine.from( 'backflipLand' )
		.to( 'walk', 0.25, ( v ) => v.speed > WALK_FROM_BACKFLIP )
		.toWhenDone( 'idle', 0.35 );

	return machine;

}

export { locomotion };
