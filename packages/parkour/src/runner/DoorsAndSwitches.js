import { Vector3 } from 'three';
import { clamp, radians, wrapAngle } from '../math.js';
import { CAPSULE } from '../sim/tuning.js';
import { LEDGE_STATES, PIPE_AND_ZIPLINE_STATES, POLE_AND_BAR_STATES, WALL_STATES } from './states.js';

// Doors (METRICS: door). Run at a shut door this fast or faster (m/s), heading within BARGE_ANGLE of straight at it,
// and the runner barges it: the shoulder move (on the upper body, the legs running on beneath it) starts BARGE_LEAD
// (s) before the capsule meets the leaf, a little longer than its own length, so the shoulder is in before they meet,
// and the door bursts open. The move holds the shoulder in for BARGE_FOLLOW (s) more and blends back into the run. The runner goes on through at its speed plus BARGE_ADD, up to
// BARGE_TOP (m/s), or at its own if that was faster.
const BARGE_SPEED = 2.5;
const BARGE_ANGLE = radians( 45 );
const BARGE_LEAD = 0.6;
const BARGE_FOLLOW = 0.1;
const BARGE_ADD = 2;
const BARGE_TOP = 5;
// Slower, Interact kicks a shut door ahead open: from within KICK_REACH (m) of its leaf, facing it within KICK_ANGLE,
// the runner is set KICK_STAND (m) back from the leaf, where the kick's foot reaches it, and the door flies open as
// it does, KICK_HIT (s) into the kick (door_kick's `foot`: 0.45 s of its own, at a pace of 1.4).
const KICK_REACH = 1.6;
const KICK_ANGLE = radians( 60 );
const KICK_STAND = 0.95;
const KICK_HIT = 0.45 / 1.4;
// The centre of the runner within this much of the doorway's middle (m) is in the doorway.
const DOORWAY_SLACK = 0.05;
// An open door swings shut again DOOR_STAYS_OPEN (s) after it opened, once the runner is DOOR_CLEAR (m) further from
// its doorway than the door is wide (it would sweep over the runner).
const DOOR_STAYS_OPEN = 4;
const DOOR_CLEAR = 0.6;

// Valves and buttons (METRICS: switches). Interact works one from within SWITCH_REACH (m) of where the runner stands
// to work it, heading no further than SWITCH_ANGLE from its wall (along the wall will do): the runner is set there. A valve's wheel is turned facing
// the wall, VALVE_STAND (m) out from it; a button is pressed with an arm straight out to the side (as button_press and
// button_press_left have it), so the runner stands side-on, BUTTON_STAND out from the button and BUTTON_BACK short of
// it along the wall, facing whichever way along the wall is nearer its heading: the button is at the right shoulder
// one way and pressed with the right hand, at the left the other. Square on to the wall, the hand on the button's side
// presses it (the right when it is dead ahead).
const SWITCH_REACH = 1.2;
const SWITCH_ANGLE = radians( 100 );
const VALVE_STAND = 0.42;
const BUTTON_STAND = 0.7;
const BUTTON_BACK = 0.08;
// Facing within this of square on to the wall (the cosine of the heading against along the wall), the runner counts as
// square on; then a button more than this share of BUTTON_STAND to its left is pressed with the left hand.
const BUTTON_SQUARE = 0.1;
// A button is in at its press, BUTTON_HIT (s) into the move (button_press's `press`: 0.5 s of its own, at a pace of
// 1.2); a valve has done its work as the turn ends. Either opens every shut door within SWITCH_DOORS (m).
const BUTTON_HIT = 0.5 / 1.2;
const SWITCH_DOORS = 4;

// The runner is set where it works a door or a switch over this long (s), turning to face it.
const PLACE_TIME = 0.25;

// In first person the view turns to look at a switch as it is worked (and back up level after), from eyes this far
// above the body's centre (m).
const EYES_UP = 0.7;

// Doors' and switches' timers on the runner's clock.
const TIMERS = [ 'doorKicked', 'switchWorked', 'bargedThrough' ];

const UP = new Vector3( 0, 1, 0 );

function yawOf( direction ) {

	return Math.atan2( direction.x, direction.z );

}

/**
 * Doors and the valves and buttons that open them. A shut door stands in the doorway for the leaf the world leaves
 * out: running at it barges it open and goes on through, Interact kicks it open from a walk, and anything else is held
 * back by it. Interact in front of a valve turns it, in front of a button presses it, and either opens the shut doors
 * near it. An open door swings shut again a while after, once the runner is clear of it.
 *
 * What a door or switch is doing (`doors`, `switches`) is the run's own state; the page draws the leaves, wheels and
 * buttons from it. The runner's step calls `everyStep()` with the other systems' watches, `tryInteract()` from the
 * free step before the precision crouch (the two share a button), and `block()` once the body has moved.
 */
class DoorsAndSwitches {

	constructor( runner ) {

		this.runner = runner;

		this.reset();

	}

	reset() {

		const c = this.runner;

		// Each door: whether it is open, which side of the doorway it swung to (+1: away from its normal), how it was
		// opened ('barge', 'kick' or 'switch') and when it last opened or shut (the runner's time).
		this.doors = ( c.world.doors ?? [] ).map( ( door ) => ( { door, open: false, side: 1, how: null, since: - Infinity } ) );
		// Each switch: when it was last worked, and the stretch of the runner's time its move plays.
		this.switches = ( c.world.switches ?? [] ).map( ( item ) => ( { item, workedAt: - Infinity, from: - Infinity, to: - Infinity } ) );
		// What the runner is working: { kind: 'kick' | 'valve' | 'button', state (the door's or switch's), target, stunt,
		// from, fromYaw, yaw, hand (a button's: 'left' or 'right'), elapsed }.
		this.working = null;
		// The door the shoulder barge is turned toward.
		this.barging = null;
		c.clock.cancel( ...TIMERS );

	}

	everyStep( dt ) {

		const c = this.runner;

		this.shutBehind();

		// Set where the runner works a door or switch, facing it, while its move plays.
		const w = this.working;

		if ( w ) {

			if ( c.stunt !== w.stunt ) {

				// Cut short (a jump, a trick): nothing is done, and a valve's wheel stops with the hands.
				if ( w.kind !== 'kick' ) w.state.to = Math.min( w.state.to, c.time );
				this.working = null;
				c.clock.cancel( ...TIMERS );

			} else if ( w.elapsed < PLACE_TIME ) {

				w.elapsed = Math.min( PLACE_TIME, w.elapsed + dt );
				const t = w.elapsed / PLACE_TIME;
				c.position.x = w.from.x + ( w.target.x - w.from.x ) * t;
				c.position.z = w.from.z + ( w.target.z - w.from.z ) * t;
				c.yaw = w.fromYaw + wrapAngle( w.yaw - w.fromYaw ) * t;

			}

		}

		this.turnShoulder();

	}

	// ---- Doors

	// Where the runner is against a door: `ahead`, how far its centre is out from the leaf, on `side` (+1: the side the
	// normal points to); `across` the doorway from its middle; `closing`, how fast it nears the leaf (m/s).
	against( state, position = this.runner.position, velocity = this.runner.velocity ) {

		const door = state.door;
		const offset = position.clone().sub( door.position );
		const out = offset.dot( door.normal );
		const side = out >= 0 ? 1 : - 1;

		return {
			ahead: Math.abs( out ),
			side,
			across: offset.dot( door.across ),
			closing: - side * velocity.dot( door.normal ),
			height: offset.y
		};

	}

	// Whether the capsule's centre is in the doorway's width and its body in its height.
	inDoorway( state, where ) {

		const door = state.door, half = this.runner.capsule.halfHeight;

		return Math.abs( where.across ) < door.width / 2 - DOORWAY_SLACK && where.height - half < door.height && where.height + half > 0;

	}

	// Free to barge: running on its own (not held to anything, not in a stunt or a slide).
	freeToBarge() {

		const c = this.runner, s = c.state;

		return ! c.stunt && ! PIPE_AND_ZIPLINE_STATES.has( s ) && ! LEDGE_STATES.has( s ) && ! POLE_AND_BAR_STATES.has( s ) && ! WALL_STATES.has( s ) &&
			! [ 'sliding', 'aiming', 'bailing' ].includes( s );

	}

	// Fast enough, and heading at the door.
	bargesAt( state, where ) {

		const c = this.runner;
		const speed = c.speed;

		if ( speed < BARGE_SPEED || ! this.freeToBarge() ) return false;

		const toward = state.door.normal.clone().multiplyScalar( - where.side );
		const heading = new Vector3( c.velocity.x, 0, c.velocity.z ).divideScalar( speed );

		return heading.dot( toward ) >= Math.cos( BARGE_ANGLE );

	}

	// The shoulder turns in as a shut door comes within the barge's lead of the capsule.
	turnShoulder() {

		const c = this.runner;

		if ( this.barging ) {

			const where = this.against( this.barging );

			// Turned away, or stopped: the shoulder comes back out.
			if ( where.closing <= 0 || ! this.inDoorway( this.barging, where ) || ! this.bargesAt( this.barging, where ) ) {

				this.barging = null;
				c.motion.moves.stop( 'doorBarge' );

			}

			return;

		}

		for ( const state of this.doors ) {

			if ( state.open ) continue;

			const where = this.against( state );

			if ( where.closing <= 0 || ! this.inDoorway( state, where ) || ! this.bargesAt( state, where ) ) continue;

			const gap = where.ahead - CAPSULE.radius - state.door.thickness / 2;

			if ( gap > where.closing * BARGE_LEAD ) continue;

			this.barging = state;
			c.motion.moves.play( 'doorBarge' );

			return;

		}

	}

	/**
	 * Once the body has moved: a shut door it has run into is barged open if it came fast enough and straight enough,
	 * and otherwise holds it back on the side it came from.
	 */
	block() {

		const c = this.runner;

		for ( const state of this.doors ) {

			if ( state.open ) continue;

			const where = this.against( state );
			const reach = CAPSULE.radius + state.door.thickness / 2;

			if ( where.ahead >= reach || ! this.inDoorway( state, where ) ) continue;

			// The side it came from, by where it stood before the step.
			const before = this.against( state, c.previousPosition );

			if ( before.closing > 0 && this.bargesAt( state, before ) ) {

				this.barge( state, before.side );

				continue;

			}

			const normal = state.door.normal;
			const into = c.velocity.dot( normal ) * before.side;

			c.position.addScaledVector( normal, before.side * reach - ( c.position.clone().sub( state.door.position ).dot( normal ) ) );
			if ( into < 0 ) c.velocity.addScaledVector( normal, - into * before.side );

		}

	}

	barge( state, side ) {

		const c = this.runner;
		const speed = c.speed;
		const through = Math.max( speed, Math.min( speed + BARGE_ADD, BARGE_TOP ) );

		this.open( state, side, 'barge' );
		c.velocity.x *= through / speed;
		c.velocity.z *= through / speed;
		this.barging = null;
		c.clock.after( BARGE_FOLLOW, 'bargedThrough', () => c.motion.moves.stop( 'doorBarge' ) );
		c.events.push( { type: 'camera', name: 'barge' } );

	}

	// Opens a door, swinging away from the side the runner is on.
	open( state, side, how ) {

		state.open = true;
		state.side = side;
		state.how = how;
		state.since = this.runner.time;

	}

	// An open door swings shut a while after it opened, once the runner is clear of its sweep.
	shutBehind() {

		const c = this.runner;

		for ( const state of this.doors ) {

			if ( ! state.open || c.time - state.since < DOOR_STAYS_OPEN ) continue;

			const door = state.door;
			const away = Math.hypot( c.position.x - door.position.x, c.position.z - door.position.z );

			if ( away < door.width + DOOR_CLEAR ) continue;

			state.open = false;
			state.since = c.time;

		}

	}

	// ---- Interact

	/** Interact pressed on the ground, not at a run: kick the shut door ahead, or work the switch in front. */
	tryInteract( input ) {

		if ( ! input.pressed( 'interact' ) ) return false;

		const best = this.target();

		if ( ! best ) return false;

		this.work( best );

		return true;

	}

	/**
	 * What Interact would work now: the shut door ahead to kick ({ kind: 'kick' }) or the switch in front ({ kind:
	 * 'valve' | 'button' }), the nearest; null on a run, in the air, in a stunt or with nothing in reach. It changes
	 * nothing, so the page may ask it between frames (a prompt, a button that shows only then).
	 */
	target() {

		const c = this.runner;

		if ( ! c.grounded || c.stunt || c.speed >= BARGE_SPEED ) return null;

		const forward = c.forward();
		let best = null;

		for ( const state of this.doors ) {

			if ( state.open ) continue;

			const where = this.against( state );
			const toward = state.door.normal.clone().multiplyScalar( - where.side );

			if ( where.ahead > KICK_REACH || ! this.inDoorway( state, where ) || forward.dot( toward ) < Math.cos( KICK_ANGLE ) ) continue;

			const target = state.door.position.clone().addScaledVector( state.door.across, where.across ).addScaledVector( toward, - KICK_STAND ).setY( c.position.y );

			if ( ! best || where.ahead < best.distance ) best = { kind: 'kick', state, target, yaw: yawOf( toward ), distance: where.ahead };

		}

		for ( const state of this.switches ) {

			const { kind, position, normal } = state.item;
			const toward = normal.clone().negate();
			const target = position.clone().addScaledVector( normal, kind === 'valve' ? VALVE_STAND : BUTTON_STAND ).setY( c.position.y );
			// A valve is faced; a button is beside a shoulder, the runner facing along the wall.
			const hand = kind === 'button' ? this.pressingHand( position, toward ) : null;
			const facing = kind === 'valve' ? toward : new Vector3().crossVectors( UP, toward ).multiplyScalar( hand === 'right' ? 1 : - 1 );

			if ( kind === 'button' ) target.addScaledVector( facing, - BUTTON_BACK );

			const distance = Math.hypot( target.x - c.position.x, target.z - c.position.z );

			if ( distance > SWITCH_REACH || forward.dot( toward ) < Math.cos( SWITCH_ANGLE ) ) continue;
			if ( ! best || distance < best.distance ) best = { kind, state, target, yaw: yawOf( facing ), hand, distance };

		}

		return best;

	}

	// The hand that presses a button on a wall facing against `toward`: the right when facing along the wall with the
	// button at the right shoulder is nearer the runner's heading, else the left; square on, the hand on the button's
	// side.
	pressingHand( position, toward ) {

		const c = this.runner;
		const along = new Vector3().crossVectors( UP, toward ).dot( c.forward() );

		if ( Math.abs( along ) > BUTTON_SQUARE ) return along > 0 ? 'right' : 'left';
		return position.clone().sub( c.position ).dot( c.right() ) < - BUTTON_SQUARE * BUTTON_STAND ? 'left' : 'right';

	}

	// Sets about working a door or a switch: its move plays where the runner is set, and does its work as it lands.
	work( { kind, state, target, yaw, hand = null } ) {

		const c = this.runner;
		const move = kind === 'kick' ? 'doorKick' : kind === 'valve' ? 'valveTurn' : hand === 'left' ? 'buttonPressLeft' : 'buttonPress';

		c.startStunt( move, { onDone: () => {

			this.working = null;
			if ( kind !== 'kick' && c.firstPerson ) c.events.push( { type: 'camera', name: 'turnView', pitch: 0 } );

		} } );

		this.working = { kind, state, target, stunt: c.stunt, from: c.position.clone(), fromYaw: c.yaw, yaw, hand, elapsed: 0 };

		if ( kind !== 'kick' && c.firstPerson ) {

			const position = state.item.position, eyes = target.clone().setY( c.position.y + EYES_UP );
			const across = Math.hypot( position.x - eyes.x, position.z - eyes.z );
			c.events.push( { type: 'camera', name: 'turnView', yaw: yawOf( position.clone().sub( eyes ) ), pitch: Math.atan2( eyes.y - position.y, across ) } );

		}

		if ( kind === 'kick' ) {

			c.clock.after( KICK_HIT, 'doorKicked', () => {

				if ( state.open ) return;
				this.open( state, this.against( state ).side, 'kick' );
				c.events.push( { type: 'camera', name: 'landing', epicenter: state.door.position.clone() } );

			} );

			return;

		}

		const length = c.stunt.length;

		state.from = c.time;
		state.to = c.time + length;
		c.clock.after( kind === 'button' ? BUTTON_HIT : length, 'switchWorked', () => this.switched( state ) );

	}

	// A switch has done its work: the shut doors near it open, away from the runner.
	switched( state ) {

		const c = this.runner;

		state.workedAt = c.time;

		for ( const doorState of this.doors ) {

			const door = doorState.door;

			if ( doorState.open || door.position.distanceTo( state.item.position.clone().setY( door.position.y ) ) > SWITCH_DOORS ) continue;

			this.open( doorState, this.against( doorState ).side, 'switch' );

		}

	}

	/**
	 * How far a door has swung open, 0 (shut) to 1 (open), at a time: quick for a barge or a kick, slower for a switch,
	 * and slowly shut. For the page, which draws the leaves.
	 */
	openness( state, time = this.runner.time ) {

		const t = time - state.since;
		const swing = state.how === 'switch' ? 1.2 : state.how === 'kick' ? 0.25 : 0.18;
		const shut = 0.8;

		if ( state.open ) return smooth( clamp( t / swing, 0, 1 ) );

		return state.since === - Infinity ? 0 : 1 - smooth( clamp( t / shut, 0, 1 ) );

	}

}

function smooth( t ) {

	return t * t * ( 3 - 2 * t );

}

export { DoorsAndSwitches, BARGE_SPEED };
