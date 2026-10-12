import { Vector3 } from 'three';
import { approach, clamp, wrapAngle } from '../math.js';
import { HANGING, ON_LEDGE } from './states.js';

// Held to something other than a ledge (the ledge states are read on their own).
const ATTACHED = new Set( [ 'onPole', 'onBar', 'onRope', 'wallRunning', 'onPipe', 'onLadder', 'toppingOut', 'onZipline' ] );

const UP = new Vector3( 0, 1, 0 );

// Above this speed (m/s) a held jump on the ground shows as the charging crouch.
const CHARGING_SPEED = 4.5;

// How fast the foot-placement weights follow their targets (1/s).
const IK_RATE = 15;

// The ground's foot placement only while the runner is all but still (m/s).
const STILL = 0.2;

// How fast the lean follows its target (1/s).
const LEAN_RATE = 3.25;

// Off a rope the body comes upright at this rate (1/s), rather than at once from the rope's lean.
const UPRIGHT_RATE = 10;

// Up a pipe, each hand pulls PIPE_STROKE (m) while it grips, for PIPE_GRIP (s) of pipe_climb_up at its own speed: the
// take plays at the rate that pulls the body up at the climb's speed.
const PIPE_STROKE = 0.55;
const PIPE_GRIP = 1;

// In the air, a wall the flight meets within WALL_COMING.time (s), nearly head on (its face within WALL_COMING.facing of
// straight against the heading, as a cosine), shows as coming: a sphere this size swept from this far above the body's
// centre along the way it flies (m).
const WALL_COMING = { time: 0.3, facing: 0.6, up: 0.25, radius: 0.15 };

// The ledge feet: probes this far below the hips (m), this far out to each side, reaching this far ahead for the wall
// with a ball of this radius; the foot stands that radius back from where the ball stops.
const FOOT_DROP = 0.2;
const FOOT_SPREAD = 0.15;
const FOOT_REACH = 0.55;
const FOOT_PROBE = 0.08;

// How fast the grip's weight follows what the hands hold (1/s): in as they take hold, out as they let go.
const GRIP_RATE = { in: 8, out: 5 };
// A valve wheel's rim is this thick (m), and a button's face this far out from its place (as course/mesh.js draws
// them).
const RIM_RADIUS = 0.022;
const BUTTON_FACE = 0.04;
// The vaults whose hands plant on the top.
const VAULTS = new Set( [ 'speedVault', 'kongVault', 'dashVaultA', 'dashVaultB', 'dashVaultC', 'dashVaultD' ] );

/**
 * What the pose graph reads of the runner, gathered once a step after the runner's own step: its situation as flags,
 * how it moves (speed, turn, lean), the stick while hanging, and, for the pose alone, the slide's tilt, where the feet
 * go against a wall and how much the feet are put on the ground. Metres, seconds, radians.
 */
class PoseInputs {

	/**
	 * @param {Runner} runner
	 * @param {Motion} motion its moves playing hold back the foot placement
	 */
	constructor( runner, motion ) {

		this.runner = runner;
		this.motion = motion;

		/** The runner's speed (m/s). */
		this.speed = 0;
		/** How fast it turns (rad/s), turning right positive: its heading now against the step before's. */
		this.turnRate = 0;
		/** In the air: off the ground and not held to anything, not limp. */
		this.inAir = false;
		/** The take-off was a plain jump (not styled). */
		this.plainJump = true;
		this.sprinting = false;
		this.thirdPerson = true;
		/** The runner has bailed: the body goes limp. */
		this.limp = false;
		this.sliding = false;
		this.slideTucked = false;
		this.slideUpright = false;
		/** Hanging from a ledge (catching it, holding on, leaping from it). */
		this.hanging = false;
		/** Hanging with no wall under the ledge for the feet. */
		this.hangingFree = false;
		this.shimmyLeft = false;
		this.shimmyRight = false;
		this.onPipe = false;
		/** 'up', 'down' or null. */
		this.pipeGoing = null;
		/** How fast the pipe climb plays (its own speed is 1): in step with the climb's speed. */
		this.pipeClimbRate = 1;
		this.onLadder = false;
		/** 'up', 'down' or null. */
		this.ladderGoing = null;
		this.onPole = false;
		/** Coiled on the pole to kick off (jump held). */
		this.poleKicking = false;
		this.onZipline = false;
		this.onRope = false;
		/** How the body swings on the rope along its heading, -1 (back) to 1 (forward). */
		this.ropeSwing = 0;
		/** A wall right ahead (the bump against it). */
		this.wallAhead = false;
		/** In the air, a wall the flight meets in a moment, nearly head on (the body readies to push off it). */
		this.wallComing = false;
		/** Landing a back flip. */
		this.backflipLanding = false;
		/** The left foot was the last down (the take-off leads with it). */
		this.leftFootLeads = false;
		/** A jump held on the ground at speed. */
		this.jumpCharging = false;
		/** The stick (-1…1 each way), for looking about while hanging. */
		this.stick = { x: 0, y: 0 };
		/**
		 * The body's lean along its heading, -1 (into the run) to 1 (back): the velocity of the step before as the
		 * braking it would take to stop within a step, in shares of the braking the runner has, eased in. Full at any
		 * pace above a few tens of centimetres a second.
		 */
		this.lean = 0;
		/** How much the feet are put on the ground, eased (pose only). */
		this.groundIK = 0;
		/** How much the feet stand against the wall while hanging, eased (pose only). */
		this.ledgeIK = 0;
		/** Where the feet stand against the wall, in the world (m; pose only). */
		this.leftFootTarget = new Vector3();
		this.rightFootTarget = new Vector3();
		/** The body's tilt: with the slide, or along a rope (rad; pose only). */
		this.tilt = { pitch: 0, roll: 0 };
		/**
		 * What the hands hold (pose only; HandGrips): `kind` 'line' (a bar, a pole, a pipe or a cable: its ends `a` and
		 * `b`, its `radius`), 'rim' (a valve's wheel: `centre`, `normal` out of the wall, the wheel's radius `rim`, the
		 * rim's `radius`), 'point' (a button: its face `at`, `normal`, the `hand` that presses it) or 'plant' (the `top`
		 * of what is vaulted, its height), or null; and `weight`, how much, eased. A `firm` line or rim is held
		 * whatever the take does with the hands; else the hands go to it as the take brings them near. The kind stays while the
		 * weight eases out.
		 */
		this.grip = { kind: null, weight: 0, a: new Vector3(), b: new Vector3(), radius: 0, firm: false, centre: new Vector3(), normal: new Vector3(), rim: 0, at: new Vector3(), hand: null, top: 0 };
		/** On the ground the body's own (standing or sliding on it; pose only: the body keeps clear of all else). */
		this.onGround = false;
		/** Standing on a balance beam (the walk there holds the arms out). */
		this.onBeam = false;
		/** The hands are on a ledge: hanging from it, catching it, climbing onto it (pose only). */
		this.handsOnLedge = false;
		// The tilt is the rope's, or coming upright from it.
		this.tiltFromRope = false;

		// The step before's heading and velocity, for the turn and the lean.
		this.lastYaw = null;
		this.lastVelocity = new Vector3();

	}

	/**
	 * @param {number} dt
	 * @param {Input} input
	 */
	update( dt, input ) {

		const c = this.runner;
		const hanging = ON_LEDGE.has( c.state );
		const sliding = c.state === 'sliding';
		const moving = this.motion.moves.busy();
		const held = hanging || ATTACHED.has( c.state );
		const inAir = ! c.grounded && ! held && c.state !== 'bailing';
		const speed = c.velocity.length();

		this.speed = speed;
		this.turnRate = this.lastYaw === null ? 0 : wrapAngle( this.lastYaw - c.yaw ) / dt;
		this.lastYaw = c.yaw;
		this.inAir = inAir;
		this.plainJump = c.plainJump;
		this.sprinting = c.sprinting;
		this.thirdPerson = ! c.firstPerson;
		this.limp = c.state === 'bailing';
		this.sliding = sliding;
		this.slideTucked = !! c.slides.tucked;
		this.slideUpright = !! c.slides.upright;
		this.hanging = HANGING.has( c.state );
		this.hangingFree = !! c.hangingFree;
		this.shimmyLeft = c.ledges.shimmyLeft;
		this.shimmyRight = c.ledges.shimmyRight;
		this.onPipe = c.state === 'onPipe';
		this.pipeGoing = c.pipesAndZiplines.going;
		this.pipeClimbRate = c.tuning.values.pipeClimbSpeed * PIPE_GRIP / PIPE_STROKE;
		this.onLadder = c.state === 'onLadder';
		this.ladderGoing = c.pipesAndZiplines.going;
		this.onPole = c.state === 'onPole';
		this.poleKicking = !! c.polesAndBars.kicking;
		this.onZipline = c.state === 'onZipline';
		this.onRope = c.state === 'onRope';
		this.ropeSwing = this.onRope ? c.polesAndBars.ropeSwing : 0;
		this.wallAhead = !! c.wallAhead;
		this.wallComing = inAir && this.wallComes();
		this.backflipLanding = !! c.backflipLanding;
		this.leftFootLeads = !! c.leftFootLeads;
		this.jumpCharging = ! inAir && speed > CHARGING_SPEED && ! c.tricks.cartwheeling && input.held( 'jump' );
		this.stick.x = input.move.x;
		this.stick.y = input.move.y;
		if ( this.onRope || ( this.tiltFromRope && ! sliding ) ) {

			const rope = this.onRope ? c.polesAndBars.ropeTilt : null;
			this.tilt.pitch = rope ? rope.pitch : approach( this.tilt.pitch, 0, UPRIGHT_RATE, dt );
			this.tilt.roll = rope ? rope.roll : approach( this.tilt.roll, 0, UPRIGHT_RATE, dt );
			this.tiltFromRope = this.onRope || Math.abs( this.tilt.pitch ) + Math.abs( this.tilt.roll ) > 1e-4;
			if ( ! this.tiltFromRope ) this.tilt.pitch = this.tilt.roll = 0;

		} else {

			this.tilt.pitch = sliding ? c.slides.tilt.pitch || 0 : 0;
			this.tilt.roll = sliding ? c.slides.tilt.roll || 0 : 0;

		}

		this.updateLean( dt );
		this.updateGrip( dt );
		this.onGround = c.grounded || sliding;
		this.onBeam = c.grounded && Boolean( c.mover?.floor?.solid?.tags.includes( 'beam' ) );
		this.handsOnLedge = hanging || Boolean( c.climbingLedge );

		// The feet stand against the wall while the hang is still: not free, not shimmying, no move, not climbing or
		// leaping. Else, on the ground, they are put on it while the runner stands all but still.
		const againstWall = this.hanging && ! this.hangingFree && ! this.shimmyLeft && ! this.shimmyRight && ! moving && ! c.climbingLedge && c.state !== 'leapingToLedge';
		this.ledgeIK = approach( this.ledgeIK, againstWall ? 1 : 0, IK_RATE, dt );

		if ( againstWall ) {

			this.footAgainstWall( - 1, this.leftFootTarget );
			this.footAgainstWall( 1, this.rightFootTarget );

		} else {

			const standing = ! inAir && ! held && speed < STILL && ! sliding && ! moving;
			this.groundIK = approach( this.groundIK, standing ? 1 : 0, IK_RATE, dt );

		}

	}

	// The lean follows the velocity of the step before, turned against it (the braking that would stop it), as a share of
	// the braking the runner has, along its heading. With no braking at all it holds.
	updateLean( dt ) {

		const c = this.runner;
		const braking = c.slideBraking ?? c.tuning.values.braking;

		if ( braking === 0 ) return;

		const stop = this.lastVelocity.clone().setY( 0 ).multiplyScalar( - 1 / dt );
		if ( stop.length() > braking ) stop.setLength( braking );

		const along = stop.x * Math.sin( c.yaw ) + stop.z * Math.cos( c.yaw );
		this.lean += ( along / braking - this.lean ) * clamp( dt * LEAN_RATE, 0, 1 );
		this.lastVelocity.copy( c.velocity );

	}

	// What the hands hold, eased.
	updateGrip( dt ) {

		const grip = this.grip, kind = this.holding();

		grip.weight = clamp( grip.weight + ( kind ? GRIP_RATE.in : - GRIP_RATE.out ) * dt, 0, 1 );
		if ( kind ) grip.kind = kind;
		else if ( grip.weight === 0 ) grip.kind = null;

	}

	// What the hands hold this step, its place written into the grip: the kind, or null.
	holding() {

		const c = this.runner, grip = this.grip;
		const line = ( a, b, radius, firm ) => {

			grip.a.copy( a );
			grip.b.copy( b );
			grip.radius = radius;
			grip.firm = firm;
			return 'line';

		};

		// A bar until the swing launches the body off it (reached for as the body settles on it, then held); a pole
		// until let go.
		const swing = c.polesAndBars.attachment;
		if ( c.state === 'onBar' && swing?.kind === 'bar' && swing.phase !== 'launched' ) return line( swing.line.a, swing.line.b, swing.line.radius, swing.phase === 'holding' );
		if ( c.state === 'onPole' && swing?.kind === 'pole' ) return line( swing.pole.start, swing.pole.end, swing.pole.radius, true );

		const route = c.pipesAndZiplines.attachment?.route;
		if ( route && ( c.state === 'onPipe' || c.state === 'onZipline' ) ) return line( route.start, route.end, route.radius, true );

		grip.firm = false;

		const working = c.doorsAndSwitches.working;
		const item = working?.state.item;

		// A valve's wheel is held firmly: the take turns a wheel of its own, higher or lower than this one, and the
		// hands go round this one's rim with it.
		if ( working?.kind === 'valve' ) {

			grip.centre.copy( item.position );
			grip.normal.copy( item.normal );
			grip.rim = item.radius;
			grip.radius = RIM_RADIUS;
			grip.firm = true;
			return 'rim';

		}

		if ( working?.kind === 'button' ) {

			grip.at.copy( item.position ).addScaledVector( item.normal, BUTTON_FACE );
			grip.normal.copy( item.normal );
			grip.hand = working.hand;
			return 'point';

		}

		if ( Number.isFinite( c.ledges.vaultTop ) && VAULTS.has( this.motion.moves.playing()?.name ) ) {

			grip.top = c.ledges.vaultTop;
			return 'plant';

		}

		return null;

	}

	// A wall the flight meets within WALL_COMING.time, nearly head on.
	wallComes() {

		const c = this.runner;
		const across = new Vector3( c.velocity.x, 0, c.velocity.z );
		const speed = across.length();

		if ( speed < 1e-3 ) return false;
		across.divideScalar( speed );
		if ( across.dot( c.forward() ) < WALL_COMING.facing ) return false;

		const from = c.position.clone().addScaledVector( UP, WALL_COMING.up );
		const hit = c.queries.sphereCast( from, from.clone().addScaledVector( across, speed * WALL_COMING.time + WALL_COMING.radius ), WALL_COMING.radius, { group: 'probe' } );
		const normal = hit?.faceNormal ?? hit?.normal;

		return Boolean( hit && ! hit.startedInside && Math.abs( normal.y ) < 0.5 && - normal.dot( across ) > WALL_COMING.facing );

	}

	// Where a foot stands against the wall: a ball probed ahead from beside the hips, the foot just short of where it
	// stops; the runner's own place when there is no wall.
	footAgainstWall( side, into ) {

		const c = this.runner;
		const origin = c.position.clone().addScaledVector( UP, - FOOT_DROP ).addScaledVector( c.right(), side * FOOT_SPREAD );
		const hit = c.queries.sphereCast( origin, origin.clone().addScaledVector( c.forward(), FOOT_REACH ), FOOT_PROBE, { group: 'probe' } );

		return into.copy( hit ? hit.centre.clone().addScaledVector( c.forward(), - FOOT_PROBE ) : c.position );

	}

}

export { PoseInputs };
