import { Vector3 } from 'three';
import { random } from '../sim/random.js';
import { clamp, radians, wrapAngle } from '../math.js';
import { Probes, hasTag, faceNormal } from './Probes.js';
import { MOVES_ENDED_BY_LANDING } from './Landings.js';
import { HANGING, LEDGE_STATES, ON_LEDGE } from './states.js';

const UP = new Vector3( 0, 1, 0 );

// States in which something already carries the body: no ledge move starts from them.
const CARRIED = new Set( [ 'catchingLedge', 'leapingToLedge', 'vaulting', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'onPole', 'onBar', 'onRope' ] );

// The dash vault is one of four, picked at random (stream vaultChoice).
const DASH_VAULTS = [ 'dashVaultA', 'dashVaultB', 'dashVaultC', 'dashVaultD' ];
// The corner leap's move by side, holding on with the feet against the wall or hanging free.
const CORNER = { L: 'ledgeLeapSideLeft', R: 'ledgeLeapSideRight' };
const CORNER_FREE = { L: 'ledgeLeapFreeLeft', R: 'ledgeLeapFreeRight' };

// A ledge caught in the air pulls the body to hang from it over this long (s).
const CATCH_TIME = 0.2;
// A high ledge reached by running up the wall below it takes this long (s).
const HIGH_CATCH_TIME = 0.7;
// A catch settles this long after the body hangs (s): the wall abilities and the air tricks come back.
const CATCH_SETTLE = 0.1;
// A leap from one ledge to another, or round a corner, takes this long (s).
const LEAP_TIME = 0.5;
// A climb up from a hang lifts the body onto the top as its take's root rises (the root keyed along the body, so the
// runner is carried as the body climbs); movement comes back this much later, as the take steps off (s), and the air
// tricks come back this long after it is placed (s).
const CLIMB_UNLOCK = 0.15;
const CLIMB_AIR_TRICKS = 0.8;
// After letting go, the next ledge catch waits this long, so the same ledge is not caught again at once (s).
const CATCH_LOCK = 0.35;
// After a catch, a kick off the ledge waits this long (s).
const KICK_OFF_LOCK = 0.25;
// Falling faster than this (m/s) onto a ledge is a bail, not a catch.
const CATCH_MAX_FALL = 15.5;
// No run up to a high ledge while falling faster than this (m/s), nor with the wall turned this far away (rad).
const HIGH_CATCH_MIN_VY = - 8.5;
const HIGH_CATCH_MAX_ANGLE = radians( 80 );
// The run up needs room overhead: a thin capsule this far above the body's centre (m), from 1.2 m to 3 m up.
const HIGH_CATCH_HEADROOM = { up: 2.1, radius: 0.05, halfHeight: 0.9 };
// No catch in the air with a floor right under the feet: a capsule swept down between these heights about the body's
// centre (m).
const AIR_CATCH_FLOOR = { from: - 0.86, to: - 1, radius: 0.1, halfHeight: 0.55 };
// The hands need room just past the edge: a sphere this far out in front of the wall from the top (m), swept this far
// down.
const CATCH_HANDS = { out: 0.12, down: 0.25, radius: 0.08 };
// How fast a shimmy eases toward the next hold each step, to the right (per second).
const SHIMMY_RATE_RIGHT = 5.5;
// The same to the left: the left-hand step is a little slower.
const SHIMMY_RATE_LEFT = 4.5;
// With no shimmy key held, the stick is read for a shimmy on a beat this often (s), pushed past this far sideways.
const SHIMMY_STICK_CHECK = 0.1;
const SHIMMY_STICK = 0.5;
// A shimmy step looks along the ledge at the hands' height (m above the body's centre, toward the wall), with a ray
// from just behind the hands to this far out to the side; and for the body's own room, a capsule a little back from
// the wall and out to the side. Either blocked, the step tries the corner.
const SHIMMY_ALONG = { up: 1, ahead: 0.25, behind: 0.1, out: 0.25 };
const SHIMMY_BODY = { back: 0.15, out: 0.15, radius: 0.1, halfHeight: 0.9 };
// The hand to that side reaches for the wall: a sphere from where the hand hangs (m: up, toward the wall, out to the
// side) swept this far toward the wall. The hold is the top above the wall it meets (a small sphere dropped from this
// high above the hit, this far down).
const SHIMMY_HAND = { up: 0.8345, ahead: 0.022, out: 0.16, reach: 0.185, radius: 0.065 };
const SHIMMY_TOP = { radius: 0.03, start: 0.2, depth: 0.25 };
// Shimmying, the body hangs this far below the top (m): a little lower than a still hang.
const SHIMMY_BELOW_TOP = 0.935;
// While hanging, how often the feet look for a wall to stand against; with none the hang is free (s). They look with a
// sphere swept this far ahead from this far below the body's centre (m).
const HANG_FREE_CHECK = 0.1;
const HANG_FREE_PROBE = { down: 0.2, ahead: 0.4, radius: 0.08 };
// A vault, and the power jump's approach, carry the body onto the obstacle over this long (s).
const VAULT_PLACE_TIME = 0.25;
// A vault falls free this long after it is placed (s).
const VAULT_RELEASE = 0.225;
// Too close to vault: the runner stumbles up at this speed (m/s) and bails this long after (s).
const VAULT_STUMBLE = 2;
const VAULT_STUMBLE_BAIL = 0.15;
// A hop onto a waist-high wall carries the body up onto the top along its take's root, and on at the run's pace: as far
// onto the top as the speed takes it by touchdown, from HOP_LAND.near to HOP_LAND.far past the edge (m), where there is
// room to stand. Movement comes back this much later (s); another hop may start this long after it is placed (s).
const HOP_LAND = { near: 0.3, far: 1.5 };
const HOP_UNLOCK = 0.05;
const HOP_AGAIN = 0.2;
// A hop onto a head-high wall places the body as its take's root rises (as a climb up does); movement comes back this
// much later, as the take steps off, and another hop may start this long after it is placed (s).
const HIGH_HOP_UNLOCK = 0.15;
const HIGH_HOP_AGAIN = 0.3;
// A hop of a kind (onto a waist-high wall, a head-high wall, or the power jump's approach) does not repeat within this
// long (s).
const SAME_HOP_LOCK = 0.55;
// A hop onto a head-high wall needs its edge clear for the hands: nothing in a sphere this far out in front of the wall
// from the top (m).
const HIGH_HOP_EDGE = { out: 0.12, radius: 0.1 };
// The power jump's approach needs this much speed (m/s); the next hop waits this long after it is on top (s). It leaps
// onto the obstacle along its take's root and lands a foot on the top POWER_PLANT.in (m) past the edge, the foot
// POWER_PLANT.ahead (m) ahead of the body as it plants (vault_power_on_right's left foot), so the body is placed that
// far short of it; then it drives on over the foot (the jump off's first POWER_DRIVE, s, its root carrying the body
// along the top) before it leaps.
const POWER_APPROACH_SPEED = 2.5;
const POWER_APPROACH_HOP_LOCK = 0.35;
const POWER_PLANT = { in: 0.15, ahead: 0.54 };
const POWER_DRIVE = 0.12;
// The power jump leaves the obstacle rising at this speed (m/s), if there is room ahead for it: low, a sphere swept
// this far ahead from a little above the body's centre (m); high, one swept between these distances ahead, overhead.
const POWER_JUMP_SPEED = 8.25;
const POWER_JUMP_LOW_ROOM = { up: 0.26, ahead: 1, radius: 0.2 };
const POWER_JUMP_HIGH_ROOM = { up: 1.8, from: 0.85, to: 1.15, radius: 0.2 };
// For this long after the power jump leaves the obstacle it passes through solids, then it falls (s).
const POWER_JUMP_GHOST = 0.2;
// The body's centre over a top it is placed on (m), and the room it needs standing there (a capsule this far up).
const STAND_ON_TOP = 0.9;
const ROOM_ON_TOP = { up: 0.91, radius: 0.18, halfHeight: 0.9 };
// Hanging, the body's centre is this far below the top (m) and this far out from the wall (m).
const HANG_BELOW_TOP = 0.9;
const HANG_OFF_WALL = 0.185;
// A climb up from a hang carries the body this far up and forward (m).
const CLIMB_UP = 1.95;
const CLIMB_FORWARD = 0.35;
// The leap's sectors by the steer's angle from straight up (rad): up (either hand), up to a side, sideways, down to a
// side, down.
const SECTOR_UP = Math.PI / 12;
const SECTOR_UP_SIDE = ( 11 * Math.PI ) / 36;
const SECTOR_SIDE = ( 23 * Math.PI ) / 36;
const SECTOR_DOWN_SIDE = ( 11 * Math.PI ) / 12;
// Sprint held with the stick pushed forward past this much ends a climb's or a hop's move early, sprinting, the move
// blending into the run over this long (s).
const BOOST_STICK = 0.5;
const BOOST_BLEND = 0.15;

// The ledges' timers, holds and beats on the runner's clock.
const TIMERS = [
	'vaultFailBail', 'vaultRelease', 'catchSettled', 'climbAirTricks', 'climbUnlock', 'hopUnlock',
	'hopAgain', 'powerJumpRelease',
	'ledgeKickOffLock', 'ledgeCatchLock', 'midHopLock', 'highHopLock', 'powerApproachLock',
	'hangFreeCheck', 'shimmyStickCheck'
];

/**
 * The move of a ledge leap by the steer's angle (rad, + to the right, 0 up): up a ledge (with one hand or the other in
 * turn), up to either side, sideways (not hanging free), down, or down to either side. The sector edges lean the way
 * the moves were authored.
 */
function ledgeLeapMove( angle, forwardSign, free, alternate ) {

	if ( ( angle > 0 && angle <= SECTOR_UP ) || ( angle < 0 && angle > - SECTOR_UP ) || ( angle === 0 && forwardSign > 0 ) ) {

		return alternate ? 'ledgeLeapUpRightHand' : 'ledgeLeapUpLeftHand';

	}

	if ( angle > SECTOR_UP && angle <= SECTOR_UP_SIDE ) return 'ledgeLeapUpRight';
	if ( angle <= - SECTOR_UP && angle > - SECTOR_UP_SIDE ) return 'ledgeLeapUpLeft';
	if ( angle > SECTOR_UP_SIDE && angle <= SECTOR_SIDE ) return free ? null : 'ledgeLeapSideRight';
	if ( angle <= - SECTOR_UP_SIDE && angle > - SECTOR_SIDE ) return free ? null : 'ledgeLeapSideLeft';

	if ( ( angle === 0 && forwardSign < 0 ) || ( angle <= - SECTOR_DOWN_SIDE && angle > - Math.PI ) || ( angle > SECTOR_DOWN_SIDE && angle <= Math.PI ) ) return alternate ? 'ledgeLeapDownAlt' : 'ledgeLeapDown';
	if ( angle <= - SECTOR_SIDE && angle > - SECTOR_DOWN_SIDE ) return 'ledgeLeapDownLeft';
	if ( angle > SECTOR_SIDE && angle <= SECTOR_DOWN_SIDE ) return 'ledgeLeapDownRight';

	return null;

}

// The heading that faces a wall with this normal.
function yawOf( normal ) {

	return Math.atan2( - normal.x, - normal.z );

}

/**
 * Ledges and obstacles: vaults over low obstacles, hops onto walls, the power jump off an obstacle, catching a ledge
 * (in the air, or running up the wall below it), hanging, shimmying, leaping to another ledge or round a corner,
 * climbing up and letting go.
 *
 * Every move here is a placement: the body is carried from where it is onto a target over a set time (eased for the
 * catches and leaps), then a timer or the next state lets go. The ledge states (states.js LEDGE_STATES) are run by
 * `update()`; vaults, hops and catches start from the runner's step through `tryCatch()` and
 * `tryPowerJumpApproach()`.
 */
class Ledges {

	constructor( runner ) {

		this.runner = runner;

		this.probes = new Probes( runner );

		this.reset();

	}

	reset() {

		const c = this.runner;

		c.clock.cancel( ...TIMERS );

		// The move carrying the body, or null: { kind, target, yaw, placeTime, from, fromYaw, elapsed, phase ('placing'
		// then 'after'), mode (its movement mode), guided, ghost, clip, ease, variant (vaults), side (corners) }.
		this.placement = null;

		// The sides being shimmied along (a key held, or the stick pushed), and the shimmy keys as last seen.
		this.shimmying = { left: false, right: false };
		this.keysHeld = { left: false, right: false };
		// The leaps up and down alternate hands.
		this.upAlternate = this.downAlternate = false;

		c.hangingFree = false;
		c.climbingLedge = c.climbing = false;
		c.precisionAllowed = true;

		// Whether a vault or a hop may start (not while one carries the body), and whether a hop may start again (a
		// while after the last one stood on top).
		this.hopReady = this.hopAgainReady = true;
		// A shimmy step found a wall to that side (the hang pose shows the shimmy).
		this.shimmyLeft = this.shimmyRight = false;
		// The height of the top the last vault went over (m; the hands plant on it, for the pose alone).
		this.vaultTop = null;

	}

	everyStep( dt, input ) {

		const c = this.runner;

		// A placement whose state something else took (a timer that came due over it) no longer has the body.
		if ( this.placement && ! LEDGE_STATES.has( c.state ) ) this.abandon();

		// Hanging free: no wall in reach of the feet (looked for on a beat).
		if ( c.clock.every( 'hangFreeCheck', HANG_FREE_CHECK ) && HANGING.has( c.state ) ) {

			const origin = c.position.clone().addScaledVector( UP, - HANG_FREE_PROBE.down );

			c.hangingFree = ! this.probes.sphereCast( origin, origin.clone().addScaledVector( c.forward(), HANG_FREE_PROBE.ahead ), HANG_FREE_PROBE.radius );

		}

		this.updateShimmy( dt, input );

	}

	/** Runs the ledge states: the placement carrying the body, or the hang (let go, leap, climb up). */
	update( dt, input ) {

		const c = this.runner;

		if ( input.pressed( 'dive' ) && this.letGo( input ) ) return;
		if ( input.pressed( 'flip' ) && this.letGo( input, true ) ) return;

		const placement = this.placement;

		if ( placement ) {

			placement.elapsed += dt;

			if ( placement.phase === 'drive' ) {

				this.updateDrive( dt, input );

			} else if ( placement.phase === 'placing' ) {

				const alpha = clamp( placement.elapsed / placement.placeTime, 0, 1 );

				if ( placement.curve ) {

					// Along the take's root: up as it rises, on as it moves on, each the share of what it does by the
					// time it has risen.
					const before = c.position.clone();
					const { up, on } = c.motion.rootShare( placement.clip, placement.elapsed, placement.placeTime );
					const span = placement.target.clone().sub( placement.from );

					c.position.set( placement.from.x + span.x * on, placement.from.y + span.y * up, placement.from.z + span.z * on );
					c.velocity.copy( c.position ).sub( before ).divideScalar( dt );
					c.yaw = placement.fromYaw + wrapAngle( placement.yaw - placement.fromYaw ) * on;

				} else {

					// The move's root motion runs (for its effect on the velocity and the floor); the placement sets the
					// place. Eased placements ease in and out (quadratic: halfway at half time).
					if ( placement.clip ) c.applyRootMotion( dt, placement.mode );

					const t = placement.ease ? ( alpha < 0.5 ? 2 * alpha * alpha : 1 - Math.pow( - 2 * alpha + 2, 2 ) / 2 ) : alpha;

					c.position.copy( placement.from ).lerp( placement.target, t );
					c.yaw = placement.fromYaw + wrapAngle( placement.yaw - placement.fromYaw ) * t;

				}

				if ( alpha === 1 ) this.placed( input );

			} else {

				c.applyRootMotion( dt, placement.mode );

			}

			return;

		}

		if ( input.pressed( 'jump' ) && ! this.leap( input ) ) this.climbUp( input );

	}

	/** Grab held: a vault or a hop on the ground, else a ledge to catch. True if one started. */
	tryCatch( input ) {

		const c = this.runner;

		if ( ! input.held( 'grab' ) || this.placement ) return false;

		if ( c.grounded ) {

			if ( this.tryVault( input ) ) return true;
			if ( this.tryHop() ) return true;

		}

		if ( this.tryHighCatch() ) return true;

		return this.tryAirCatch( input );

	}

	// ---- Vaults and hops

	/**
	 * Whether grab held on the ground has something ahead to take, as tryVault and tryHop find it: a low obstacle to
	 * vault, a wall to hop onto. It changes nothing, so the jump can ask whether grab held makes it one of these instead.
	 */
	groundTarget() {

		const low = this.canVault() && this.probes.scan( 'lowObstacle' );

		if ( low && ! this.probes.vaultBlocked( low ) ) return true;
		if ( ! this.canHop() ) return false;
		if ( this.probes.scan( 'midObstacle' ) ) return true;

		return this.probes.wallToClimb() && Boolean( this.probes.scan( 'highObstacle' ) );

	}

	canVault() {

		const c = this.runner;

		return (
			c.grounded &&
			! c.rollComing &&
			! this.carried() &&
			this.hopReady &&
			! c.jumpLocked &&
			! c.clock.held( 'jumpLock' ) &&
			! HANGING.has( c.state ) &&
			! c.tricking &&
			c.tricks.cartwheelReady &&
			c.state !== 'sliding' &&
			this.playing() !== 'highHopOnto'
		);

	}

	// The vault by the trick button held with grab: flip a speed vault, wheel a kong, jump a dash.
	tryVault( input ) {

		if ( ! this.canVault() ) return false;

		const variant =
			input.held( 'flip' ) ? 'speed' :
			input.held( 'wheel' ) ? 'kong' :
			input.held( 'jump' ) ? 'dash' :
			null;

		if ( ! variant ) return false;

		const ledge = this.probes.scan( 'lowObstacle' );

		if ( ! ledge || this.probes.vaultBlocked( ledge ) ) return false;
		if ( this.probes.tooCloseToVault() ) return this.stumble();

		const c = this.runner;
		const clip =
			variant === 'speed' ? 'speedVault' :
			variant === 'kong' ? 'kongVault' :
			DASH_VAULTS[ Math.floor( random.next( 'vaultChoice' ) * DASH_VAULTS.length ) ];

		this.hopReady = false;
		this.vaultTop = ledge.top.point.y;

		if ( variant === 'speed' ) c.cameraLag = false;

		this.place( 'vaulting', ledge.top.point.clone().addScaledVector( UP, STAND_ON_TOP ), c.yaw, VAULT_PLACE_TIME, {
			clip,
			kind: 'vault',
			variant,
			guided: true,
			ghost: true
		} );

		return true;

	}

	// Too close to an obstacle to vault it: a stumble into it, and the game's bail.
	stumble() {

		const c = this.runner;

		c.velocity.y = VAULT_STUMBLE;
		c.grounded = false;
		c.setState( 'falling' );
		c.motion.moves.play( 'diveOut' );
		c.clock.after( VAULT_STUMBLE_BAIL, 'vaultFailBail', () => c.bail.request() );

		return true;

	}

	canHop() {

		const c = this.runner;

		return (
			c.grounded &&
			! c.rollComing &&
			! this.carried() &&
			this.hopAgainReady &&
			this.hopReady &&
			c.tricks.cartwheelReady &&
			! c.tricking &&
			! HANGING.has( c.state ) &&
			! c.rolling &&
			c.state !== 'rolling' &&
			c.state !== 'sliding'
		);

	}

	// A hop onto a waist-high wall (a mid obstacle), else onto a head-high one (a high obstacle with a wall to climb).
	tryHop() {

		const c = this.runner;

		if ( ! this.canHop() || this.playing() ) return false;

		let ledge = this.probes.scan( 'midObstacle' );

		if ( ledge ) {

			if ( ! this.roomOnTop( ledge ) || c.clock.held( 'midHopLock' ) ) return false;
			c.clock.hold( 'midHopLock', SAME_HOP_LOCK );
			this.hop( ledge, false );

			return true;

		}

		if ( ! this.probes.wallToClimb() ) return false;
		ledge = this.probes.scan( 'highObstacle' );
		if ( ! ledge || c.clock.held( 'highHopLock' ) ) return false;

		const edge = ledge.top.point.clone().addScaledVector( faceNormal( ledge.wall ), HIGH_HOP_EDGE.out );

		if ( this.probes.overlapSphere( edge, HIGH_HOP_EDGE.radius ) || ! this.probes.roomAbove() || ! this.roomOnTop( ledge ) ) return false;
		c.clock.hold( 'highHopLock', SAME_HOP_LOCK );
		this.hop( ledge, true );

		return true;

	}

	hop( ledge, high ) {

		const c = this.runner;

		this.hopAgainReady = false;
		c.cameraLag = true;
		c.canMove = false;
		c.precisionAllowed = false;
		this.hopReady = false;
		c.climbing = high;

		const clip = high ? 'highHopOnto' : 'hopOnto';
		const target = ledge.top.point.clone().addScaledVector( UP, STAND_ON_TOP );

		if ( ! high ) {

			const flat = target.clone().sub( c.position ).setY( 0 ), edge = flat.length();
			const along = clamp( c.speed * c.motion.riseTime( clip ), edge + HOP_LAND.near, edge + HOP_LAND.far );
			const onto = c.position.clone().addScaledVector( flat.normalize(), along ).setY( target.y );

			if ( ! this.probes.overlapCapsule( onto.clone().addScaledVector( UP, ROOM_ON_TOP.up - STAND_ON_TOP ), ROOM_ON_TOP.radius, ROOM_ON_TOP.halfHeight ) ) target.copy( onto );

		}

		this.place( 'climbingUp', target, c.yaw, null, { clip, kind: high ? 'highHop' : 'hop', curve: true, guided: false, ghost: true } );

	}

	/** Jump held at speed toward a low obstacle: hop onto it, to jump off its top. True if the approach started. */
	tryPowerJumpApproach( input ) {

		const c = this.runner;

		if (
			! input.held( 'jump' ) ||
			input.held( 'precision' ) ||
			! this.canHop() ||
			this.playing() ||
			c.velocity.length() <= POWER_APPROACH_SPEED ||
			this.placement ||
			c.clock.held( 'powerApproachLock' )
		) {

			return false;

		}

		const ledge = this.probes.scan( 'lowObstacle' );

		if ( ! ledge || ! this.roomOnTop( ledge ) ) return false;

		c.clock.hold( 'powerApproachLock', SAME_HOP_LOCK );
		this.hopAgainReady = this.hopReady = false;

		const target = ledge.top.point.clone().addScaledVector( c.forward(), POWER_PLANT.in - POWER_PLANT.ahead ).addScaledVector( UP, STAND_ON_TOP );

		this.place( 'climbingUp', target, c.yaw, null, { kind: 'powerApproach', clip: 'powerJumpOnRight', curve: true, guided: true, ghost: true } );

		return true;

	}

	// The foot is down on the top: the jump off's drive carries the body on over it, along the top.
	drive( placement ) {

		const c = this.runner;

		placement.phase = 'drive';
		placement.driven = 0;
		this.hopReady = true;
		c.velocity.set( 0, 0, 0 );
		c.motion.moves.play( 'powerJumpOffLeft' );

		// The next hop may start a while after the top, whether the power jump goes from it or not.
		c.clock.after( POWER_APPROACH_HOP_LOCK, 'hopAgain', () => {

			this.hopAgainReady = true;

		} );

	}

	// Driving over the planted foot, then the power jump with jump still held (and room for it), or standing on the top.
	updateDrive( dt, input ) {

		const c = this.runner;
		const placement = this.placement;
		const motion = c.motion.rootMotion( dt );

		if ( motion ) {

			const step = motion.translation.clone().setY( 0 ).multiplyScalar( c.tuning.values.rootMotionScale ).applyAxisAngle( UP, c.yaw );
			c.position.add( step );
			c.velocity.copy( step ).divideScalar( dt );

		}

		placement.driven += dt;
		if ( placement.driven < POWER_DRIVE ) return;

		if ( input.held( 'jump' ) && this.powerJump() ) return;

		c.clock.release( 'noCollision' );
		c.motion.moves.stop( 'powerJumpOffLeft' );
		c.standOnFloor();
		this.release( placement, c.grounded );

	}

	// Over the obstacle's top with jump held: the power jump, if there is room ahead (low and high). True if it jumped.
	powerJump() {

		const c = this.runner;
		const low = c.position.clone().addScaledVector( UP, POWER_JUMP_LOW_ROOM.up );

		if ( this.probes.sphereCast( low, low.clone().addScaledVector( c.forward(), POWER_JUMP_LOW_ROOM.ahead ), POWER_JUMP_LOW_ROOM.radius ) ) return false;

		const room = POWER_JUMP_HIGH_ROOM;
		const high = c.position.clone().addScaledVector( UP, room.up );

		if ( this.probes.sphereCast( high.clone().addScaledVector( c.forward(), room.from ), high.clone().addScaledVector( c.forward(), room.to ), room.radius ) ) return false;

		// The jump off's move is already playing (from the drive).
		const placement = ( this.placement = {
			kind: 'powerJump',
			clip: 'powerJumpOffLeft',
			elapsed: 0,
			phase: 'after',
			guided: false,
			mode: 'air'
		} );

		c.stunt = null;
		c.clock.hold( 'noCollision', POWER_JUMP_GHOST );
		c.velocity.y = POWER_JUMP_SPEED;
		c.grounded = false;
		c.jumps ++;
		c.setState( 'vaulting' );
		this.camera( 'powerJump' );
		c.clock.after( POWER_JUMP_GHOST, 'powerJumpRelease', () => {

			placement.guided = false;
			c.airComboOpen = true;
			this.release( placement, false );

		} );

		return true;

	}

	// Room to stand on top of an obstacle.
	roomOnTop( ledge ) {

		const at = ledge.top.point.clone().addScaledVector( UP, ROOM_ON_TOP.up );

		return ! this.probes.overlapCapsule( at, ROOM_ON_TOP.radius, ROOM_ON_TOP.halfHeight );

	}

	// ---- Catches

	// Running up the wall below a ledge just out of reach.
	tryHighCatch() {

		const c = this.runner;

		if (
			this.placement ||
			this.carried() ||
			! this.hopAgainReady ||
			c.clock.held( 'ledgeCatchLock' ) ||
			c.rolling ||
			c.state === 'rolling' ||
			c.tricking ||
			c.velocity.y <= HIGH_CATCH_MIN_VY ||
			HANGING.has( c.state ) ||
			c.balancing
		) {

			return false;

		}

		// Room overhead for the run up, and a wall in front to run up.
		const overhead = c.position.clone().addScaledVector( UP, HIGH_CATCH_HEADROOM.up );

		if ( this.probes.overlapCapsule( overhead, HIGH_CATCH_HEADROOM.radius, HIGH_CATCH_HEADROOM.halfHeight ) || ! this.probes.wallToClimb() ) return false;

		const ledge = this.probes.scan( 'highLedge' );

		if ( ! ledge || faceNormal( ledge.wall ).angleTo( c.forward().negate() ) >= HIGH_CATCH_MAX_ANGLE || ! this.probes.wideEnough( ledge ) || hasTag( ledge.wall, 'noClimb' ) ) {

			return false;

		}

		this.catch( ledge, true );

		return true;

	}

	tryAirCatch( input ) {

		const c = this.runner;
		const move = this.playing();

		if (
			c.grounded ||
			this.carried() ||
			input.held( 'jump', 'pad' ) ||
			c.diving ||
			c.tricking ||
			c.clock.held( 'ledgeCatchLock' ) ||
			c.state === 'onBar' ||
			HANGING.has( c.state ) ||
			c.balancing ||
			move === 'cartwheel'
		) {

			return false;

		}

		// Not with a floor right under the feet.
		const floor = AIR_CATCH_FLOOR;

		if ( this.probes.capsuleCast( c.position.clone().addScaledVector( UP, floor.from ), c.position.clone().addScaledVector( UP, floor.to ), floor.radius, floor.halfHeight ) ) return false;

		const ledge = this.probes.scan( 'airLedge' );

		if ( ! ledge || ! this.probes.wideEnough( ledge ) ) return false;

		// Room for the hands just past the edge; not on a bar (that is a swing) nor a part that may not be climbed.
		const hands = ledge.top.point.clone().addScaledVector( faceNormal( ledge.wall ), CATCH_HANDS.out );

		if ( this.probes.sphereCast( hands, hands.clone().addScaledVector( UP, - CATCH_HANDS.down ), CATCH_HANDS.radius ) || hasTag( ledge.wall, 'bar' ) || hasTag( ledge.wall, 'noClimb' ) ) {

			return false;

		}

		// Too fast to hold on: the game bails the runner.
		if ( Math.abs( c.velocity.y ) > CATCH_MAX_FALL ) {

			c.bail.request();

			return true;

		}

		this.catch( ledge, false );

		return true;

	}

	catch( ledge, high ) {

		const c = this.runner;
		const normal = faceNormal( ledge.wall );

		// A catch ends the flips a landing would.
		for ( const name of MOVES_ENDED_BY_LANDING ) c.motion.moves.stop( name );

		c.hangingFree = false;
		c.climbingLedge = high;
		c.canMove = false;
		if ( high ) c.jumpLocked = true;
		c.fromWallRun = false;
		c.velocity.set( 0, 0, 0 );
		// A kick off the ledge waits a moment.
		c.clock.hold( 'ledgeKickOffLock', KICK_OFF_LOCK );

		if ( ! high ) c.tricks.resetAir();

		if ( c.firstPerson ) this.camera( 'faceView', { yaw: yawOf( normal ), ...( high ? { pitch: 0 } : {} ) } );
		this.place(
			'catchingLedge',
			ledge.top.point.clone().addScaledVector( UP, - HANG_BELOW_TOP ).addScaledVector( normal, HANG_OFF_WALL ),
			yawOf( normal ),
			high ? HIGH_CATCH_TIME : CATCH_TIME,
			{
				kind: high ? 'highCatch' : 'catch',
				clip: high ? 'runUpToHang' : null,
				ease: high,
				guided: true,
				ghost: false
			}
		);

	}

	// ---- Hanging

	// Let go of the ledge: dive drops straight down, flip (with grab released) kicks off. True if it did.
	letGo( input, kick = false ) {

		const c = this.runner;

		if ( ! HANGING.has( c.state ) || c.state === 'leapingToLedge' || c.climbingLedge || ( kick && ( c.clock.held( 'ledgeKickOffLock' ) || input.held( 'grab' ) ) ) || ( ! kick && input.held( 'precision' ) ) ) return false;

		// The next catch waits a moment, so the same ledge is not caught again at once.
		c.clock.hold( 'ledgeCatchLock', CATCH_LOCK );
		c.canMove = true;
		this.shimmyLeft = this.shimmyRight = false;
		this.shimmying.left = this.shimmying.right = false;
		c.clock.release( 'noCollision' );
		c.grounded = false;
		c.setState( 'falling' );
		this.placement = null;

		return true;

	}

	// A jump from a hang toward the steer: leap to the ledge the fan of probes finds. True if it leapt.
	leap( input ) {

		const c = this.runner;

		if ( c.state !== 'hanging' ) return false;

		const ledge = this.probes.leapFan( input.move.y, input.move.x );

		if ( ! ledge ) return false;

		const upward = ( Math.abs( ledge.angle ) < SECTOR_UP || ledge.angle === SECTOR_UP ) && ledge.forwardSign > 0;
		const clip = ledgeLeapMove( ledge.angle, ledge.forwardSign, c.hangingFree, upward ? this.upAlternate : this.downAlternate );

		if ( ! clip ) return false;

		if ( clip === 'ledgeLeapUpLeftHand' || clip === 'ledgeLeapUpRightHand' ) this.upAlternate = ! this.upAlternate;
		if ( clip === 'ledgeLeapDown' || clip === 'ledgeLeapDownAlt' ) this.downAlternate = ! this.downAlternate;

		const target = ledge.top.point.clone().addScaledVector( UP, - HANG_BELOW_TOP ).addScaledVector( c.forward(), - HANG_OFF_WALL );

		this.place( 'leapingToLedge', target, yawOf( faceNormal( ledge.wall ) ), LEAP_TIME, { kind: 'leap', clip, ease: true, guided: true } );

		return true;

	}

	// A jump from a hang with forward held (or the stick's flick up): climb onto the top, if there is room.
	climbUp( input ) {

		const c = this.runner;

		if ( ! ON_LEDGE.has( c.state ) || ! ( input.held( 'forward' ) || c.trickGesture.stick.up ) || ! this.probes.roomToClimb() || ! this.probes.roomAbove() ) return false;

		c.airComboOpen = false;
		c.cameraLag = true;
		c.canMove = false;
		c.climbingLedge = true;
		c.kickedOffWall = false;
		c.jumps = 0;
		c.walls.kickNormal.set( 0, 0, 0 );
		c.precisionAllowed = false;
		this.hopReady = false;
		c.jumpLocked = true;
		this.place( 'climbingUp', c.position.clone().addScaledVector( UP, CLIMB_UP ).addScaledVector( c.forward(), CLIMB_FORWARD ), c.yaw, null, {
			kind: 'climbUp',
			clip: 'climbUp',
			curve: true,
			guided: true,
			ghost: false
		} );

		return true;

	}

	// ---- Shimmying

	// A shimmy key pressed (or the stick pushed, read on a beat with no key held) starts a shimmy that way; each step it
	// lasts, the runner steps sideways while it hangs. A step that finds no hold tries the corner.
	updateShimmy( dt, input ) {

		const c = this.runner;
		const left = input.held( 'left' ), right = input.held( 'right' );

		for ( const [ name, held, side ] of [ [ 'left', left, - 1 ], [ 'right', right, 1 ] ] ) {

			if ( held && ! this.keysHeld[ name ] ) this.startShimmy( side );
			if ( ! held && this.keysHeld[ name ] ) this.stopShimmy( side );
			this.keysHeld[ name ] = held;

		}

		if ( c.clock.every( 'shimmyStickCheck', SHIMMY_STICK_CHECK ) && ! left && ! right ) {

			const x = input.value( 'stick' ).x;

			for ( const [ side, pushed ] of [ [ - 1, x < - SHIMMY_STICK ], [ 1, x > SHIMMY_STICK ] ] ) {

				if ( pushed ) this.startShimmy( side );
				if ( ! pushed ) this.stopShimmy( side );

			}

		}

		if ( c.state === 'leapingToLedge' || ! HANGING.has( c.state ) ) return;

		for ( const [ name, side ] of [ [ 'right', 1 ], [ 'left', - 1 ] ] ) {

			if ( this.shimmying[ name ] ) this.shimmyStep( side, dt );

		}

	}

	startShimmy( side ) {

		const c = this.runner;

		if ( ! HANGING.has( c.state ) || c.climbingLedge || c.state === 'leapingToLedge' ) return;
		this.shimmying[ side > 0 ? 'right' : 'left' ] = true;

	}

	stopShimmy( side ) {

		this.shimmying[ side > 0 ? 'right' : 'left' ] = false;
		this.setShimmySide( side, false );

	}

	setShimmySide( side, found ) {

		if ( side > 0 ) {

			this.shimmyRight = found;

		} else {

			this.shimmyLeft = found;

		}

	}

	// One step sideways along the ledge: the hands reach for the wall a little to that side and ease toward the hold on
	// its top. Blocked (along the ledge, or at the body), or with no wall there, the step tries the corner instead.
	shimmyStep( side, dt ) {

		const c = this.runner;
		const base = c.position.clone().addScaledVector( c.forward(), SHIMMY_ALONG.ahead ).addScaledVector( UP, SHIMMY_ALONG.up );
		const along = this.probes.rayBetween( base.clone().addScaledVector( c.right(), - side * SHIMMY_ALONG.behind ), base.clone().addScaledVector( c.right(), side * SHIMMY_ALONG.out ) );
		const body = c.position.clone().addScaledVector( c.forward(), - SHIMMY_BODY.back ).addScaledVector( c.right(), side * SHIMMY_BODY.out );

		if ( along || this.probes.overlapCapsule( body, SHIMMY_BODY.radius, SHIMMY_BODY.halfHeight ) ) return this.tryCorner( side );

		const reach = SHIMMY_HAND;
		const hand = c.position.clone().addScaledVector( UP, reach.up ).addScaledVector( c.forward(), reach.ahead ).addScaledVector( c.right(), side * reach.out );
		const wall = this.probes.sphereCast( hand, hand.clone().addScaledVector( c.forward(), reach.reach ), reach.radius );

		if ( ! wall ) return this.tryCorner( side );

		this.setShimmySide( side, true );

		const ledge = this.probes.ledgeTop( wall, SHIMMY_TOP.radius, SHIMMY_TOP.start, SHIMMY_TOP.depth );

		if ( ! ledge ) return false;

		const target = wall.point.clone().addScaledVector( faceNormal( wall ), HANG_OFF_WALL );

		target.y = ledge.top.point.y - SHIMMY_BELOW_TOP;

		const alpha = clamp( dt * ( side > 0 ? SHIMMY_RATE_RIGHT : SHIMMY_RATE_LEFT ), 0, 1 );

		c.position.lerp( target, alpha );
		c.yaw += wrapAngle( yawOf( faceNormal( wall ) ) - c.yaw ) * alpha;

		return true;

	}

	// Round the corner at the end of a ledge: a leap onto the ledge round it, if there is room for the body.
	tryCorner( side ) {

		const c = this.runner;

		this.setShimmySide( side, false );

		if ( c.state === 'leapingToLedge' ) return false;

		const ledge = this.probes.corner( side );

		if ( ! ledge || ! this.probes.cornerClear( ledge, side ) ) return false;

		this.shimmying[ side > 0 ? 'right' : 'left' ] = false;

		const clip = ( c.hangingFree ? CORNER_FREE : CORNER )[ side > 0 ? 'R' : 'L' ];

		this.place(
			'leapingToLedge',
			ledge.top.point.clone().addScaledVector( UP, - HANG_BELOW_TOP ).addScaledVector( faceNormal( ledge.wall ), HANG_OFF_WALL ),
			yawOf( faceNormal( ledge.wall ) ),
			LEAP_TIME,
			{ kind: 'corner', clip, ease: true, guided: true, side }
		);

		return true;

	}

	// ---- Placements

	// A placement over `placeTime`, or (`curve`) along its move's root for as long as the root takes to rise.
	place( state, target, yaw, placeTime, options ) {

		const c = this.runner;
		const placement = ( this.placement = {
			...options,
			target,
			yaw,
			placeTime: options.curve ? c.motion.riseTime( options.clip ) : placeTime,
			from: c.position.clone(),
			fromYaw: c.yaw,
			elapsed: 0,
			phase: 'placing'
		} );

		c.stunt = null;

		placement.mode = placement.guided ? 'guided' : c.grounded ? 'ground' : 'air';
		if ( placement.guided ) c.grounded = false;
		if ( placement.ghost ) c.clock.hold( 'noCollision', Infinity );
		c.setState( state );
		if ( placement.clip ) c.motion.moves.play( placement.clip );

		return placement;

	}

	// The body has arrived: hang, carry on, or stand on the top and let go when the move's timer says.
	placed( input ) {

		const c = this.runner;
		const placement = this.placement;

		placement.phase = 'after';

		if ( placement.kind === 'powerApproach' ) {

			this.drive( placement );

			return;

		}

		if ( placement.kind === 'catch' || placement.kind === 'highCatch' ) {

			c.canMove = false;
			c.velocity.set( 0, 0, 0 );
			c.setState( 'hanging' );

			if ( placement.kind === 'highCatch' ) c.jumpLocked = false;

			c.clock.after( CATCH_SETTLE, 'catchSettled', () => {

				c.climbingLedge = false;
				c.walls.rearm();
				c.tricks.resetAir();

			} );
			this.placement = null;

			return;

		}

		if ( placement.kind === 'leap' || placement.kind === 'corner' ) {

			c.setState( 'hanging' );

			// Round a corner the shimmy carries on along the new ledge.
			if ( placement.kind === 'corner' ) {

				this.startShimmy( placement.side );
				if ( c.firstPerson ) this.camera( 'faceView', { yaw: placement.yaw } );

			}

			this.placement = null;

			return;

		}

		if ( placement.kind === 'vault' ) {

			if ( placement.variant !== 'speed' ) c.velocity.set( 0, 0, 0 );
			c.jumps = 1;
			c.clock.after( VAULT_RELEASE, 'vaultRelease', () => {

				placement.guided = false;
				c.clock.release( 'noCollision' );
				this.hopReady = true;
				c.grounded = false;
				this.release( placement, false );
				if ( placement.variant === 'speed' ) c.cameraLag = false;
				c.airComboOpen = ! c.grounded;

			} );

			return;

		}

		// On top (a hop, a climb up, the power jump's approach): stand on the floor there.
		c.clock.release( 'noCollision' );
		this.hopReady = true;
		c.standOnFloor();
		placement.guided = false;
		placement.mode = c.grounded ? 'ground' : 'air';
		c.setState( 'climbingUp' );

		if ( placement.kind === 'climbUp' ) {

			this.camera( 'recenterView' );
			this.camera( 'viewFree' );
			c.clock.after( CLIMB_AIR_TRICKS, 'climbAirTricks', () => {

				c.tricks.resetAir();

			} );
			c.clock.after( CLIMB_UNLOCK, 'climbUnlock', ( nextInput ) => {

				c.cameraLag = false;
				c.canMove = c.precisionAllowed = true;
				c.jumpLocked = false;
				c.climbingLedge = false;
				this.boostAfterClimb( nextInput );
				this.release( placement, c.grounded );

			} );

			return;

		}

		const high = placement.kind === 'highHop';

		if ( high ) this.camera( 'recenterView' );
		c.clock.after( high ? HIGH_HOP_UNLOCK : HOP_UNLOCK, 'hopUnlock', ( nextInput ) => {

			c.canMove = c.precisionAllowed = true;
			c.climbing = false;
			this.boostAfterClimb( nextInput );
			c.tricks.resetAir();
			this.release( placement, c.grounded );

		} );
		c.clock.after( high ? HIGH_HOP_AGAIN : HOP_AGAIN, 'hopAgain', () => {

			c.cameraLag = false;
			this.hopAgainReady = true;

		} );

	}

	// Lets go of a placement that no longer has the body. Its ghost ends here, as nothing else would end it: a ghost held
	// on past its placement takes the runner through every solid, down through the floor. Its timers still fire, giving
	// back what it locked (release() then finds it gone).
	abandon() {

		this.placement = null;
		this.hopReady = true;
		this.runner.clock.release( 'noCollision' );

	}

	// If this placement still has the body, let go of it: standing or falling.
	release( placement, grounded ) {

		const c = this.runner;

		if ( this.placement !== placement ) return;

		c.stunt = null;
		this.placement = null;
		c.setState( grounded ? 'standing' : 'falling' );

	}

	// Sprint held with the stick forward cuts a climb's or a hop's move short, sprinting off.
	boostAfterClimb( input ) {

		const c = this.runner;

		if ( ! input.held( 'sprint' ) || input.move.y <= BOOST_STICK ) return;

		c.sprinting = true;
		for ( const name of [ 'highHopOnto', 'climbUp', 'hopOnto' ] ) c.motion.moves.stop( name, BOOST_BLEND );

	}

	// ---- Shared

	// In a state or placement that carries the body.
	carried() {

		return CARRIED.has( this.runner.state ) || Boolean( this.placement?.guided );

	}

	// The move playing (not blending out), or null.
	playing() {

		return this.runner.motion.moves.playing()?.name || null;

	}

	event( type, name, options = {} ) {

		this.runner.events.push( { type, name, ...options } );

	}

	camera( name, options ) {

		this.event( 'camera', name, options );

	}

}

export { ledgeLeapMove, Ledges };
