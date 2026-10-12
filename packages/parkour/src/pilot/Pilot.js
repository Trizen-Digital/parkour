import { Figure } from '../figure/Figure.js';
import { takeSnapshot, restoreSnapshot } from '../sim/snapshot.js';

// The keys the pilot presses for the player, as a player would: Space, E, and the left mouse button (button 0 among
// the input's mouse buttons) for grab.
const OWNED = {
	jump: { key: 'Space' },
	grab: { key: 'Mouse0', button: 0 },
	precision: { key: 'KeyE' },
};
const OWNED_KEYS = new Set( Object.values( OWNED ).map( ( owned ) => owned.key ) );

// The frames after the jump press at which letting go of it is tried (each a look-ahead), the earliest first.
const RELEASES = [ 1, 4, 9, 16, 26, 40 ];
// A look-ahead that runs into a wall while still holding jump on the ground adds releases this many frames before it
// stopped: a charged jump let go just short of the wall carries the run-up's speed, at the wall it is a standing jump.
const BEFORE_STOP = [ 1, 2 ];
// Stopped: running at least this fast (m/s), the runner kept less than this share of its speed over one frame.
const STOPPED = { from: 2, kept: 0.5 };
// The frames a precision crouch is held before its jump is pressed, tried in this order.
const CHARGES = [ 50, 22, 36, 29, 43 ];
// Look-aheads tried per frame while a jump is in the air: the budget is a count, so the pilot decides the same on any
// machine.
const TRIES_PER_FRAME = 2;
// A plan gives up after this many frames.
const PLAN_FRAMES = 240;
// A look-ahead runs at most this many frames; after a landing it follows on for RUN_OFF.frames, or RUN_OFF.after once
// the runner leaves that floor again; it has run off a ledge if it is then in the air or RUN_OFF.drop (m) below it.
const LOOK_AHEAD_FRAMES = 150;
const RUN_OFF = { frames: 30, after: 20, drop: 0.6 };
// A good catch is followed for this many frames before the look-ahead stops.
const AFTER_GOOD = 20;
// The precision crouch is tried only with the stick pushed past this, nearly still (m/s); it must score this much
// better than a plain jump.
const AIM_STICK = 0.2;
const AIM_MAX_SPEED = 2.5;
const AIM_MARGIN = 1;
// A precision jump's plan ends this many frames after it lands.
const AIM_SETTLE = 30;
// Falling faster than this (m/s), every ROLL_CHECK_EVERY frames the pilot looks ROLL_LOOK_AHEAD frames ahead; a hard
// landing (falling faster than HARD_FALL, m/s) within ROLL_WITHIN frames is rolled by holding jump ROLL_HOLD frames.
const ROLL_FALL = - 7;
const ROLL_CHECK_EVERY = 6;
const ROLL_LOOK_AHEAD = 30;
const ROLL_WITHIN = 18;
const HARD_FALL = - 10;
const ROLL_HOLD = 6;

// Held to something: not on the ground for the pilot's purposes.
const ATTACHED = new Set( [ 'hanging', 'catchingLedge', 'leapingToLedge', 'vaulting', 'climbingUp', 'onBar', 'onRope', 'onPole', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'wallRunning', 'wallPlanted', 'wallKicking' ] );
// The states that count as reaching something: a catch, a climb, a swing, a rope, a pole, a pipe, a ladder, a zipline,
// a wall run.
const GOOD = new Set( [ 'hanging', 'catchingLedge', 'climbingUp', 'onBar', 'onRope', 'onPole', 'onPipe', 'onLadder', 'toppingOut', 'onZipline', 'wallRunning' ] );

// What a candidate holds at a frame of its look-ahead: a precision jump crouches until it lands again and presses jump
// at its charge; a plain jump holds jump until its release, then grabs (or, for a run off a ledge, aims a precision
// landing) in the air.
function wants( candidate, frame, c, memo ) {

	if ( candidate.charge !== undefined ) {

		memo.air ||= frame > candidate.charge && ! c.grounded;
		memo.down ||= memo.air && c.grounded;

		return { precision: ! memo.down, jump: frame >= candidate.charge && frame < candidate.charge + 2, grab: false };

	}

	const air = frame >= candidate.release && ! c.grounded;

	return { jump: frame < candidate.release, grab: air && ! candidate.precision, precision: air && Boolean( candidate.precision ) };

}

/**
 * Easy mode. The pilot never touches the runner: it presses jump, grab and precision for the player through the raw
 * device state, as a player would. When the player presses jump it snapshots the run and looks ahead (with the
 * timing-only figure) at when to let go, whether a precision crouch would do better, and when to grab, keeping the
 * best; falling hard, it looks ahead for a landing to roll. What the player holds of those keys still counts.
 */
class Pilot {

	constructor( sim ) {

		this.sim = sim;
		this.enabled = false;
		this.stub = new Figure();
		// The owned keys as the player holds them, their presses and releases since the last frame, and as the pilot does.
		this.user = { jump: false, grab: false, precision: false };
		this.requests = [];
		this.holding = { jump: false, grab: false, precision: false };
		// The jump being planned, or null.
		this.plan = null;
		// Frames left holding jump for a roll, and frames to the next roll check.
		this.roll = 0;
		this.rollCheck = 0;
		// What the pilot is doing, for the HUD.
		this.label = '';
		this.perFrame = TRIES_PER_FRAME;
		this.install();

	}

	// The player's presses of the owned keys reach the pilot instead of the input while it is on.
	install() {

		const input = this.sim.input, pass = input.queueKey, base = Object.getPrototypeOf( input ).queueKey;

		this.emit = ( key, edge ) => pass.call( input, key, edge );
		this.emitAhead = ( key, edge ) => base.call( input, key, edge );
		input.queueKey = ( key, edge ) => {

			const owned = this.enabled && Object.entries( OWNED ).find( ( [ , o ] ) => o.key === key );

			if ( ! owned ) return pass.call( input, key, edge );
			this.requests.push( [ owned[ 0 ], edge ] );

		};

	}

	toggle( on = ! this.enabled ) {

		this.enabled = on;
		this.release();
		this.plan = null;
		this.label = '';

	}

	release() {

		for ( const name of Object.keys( this.holding ) ) this.set( name, false );

	}

	set( name, on ) {

		if ( this.holding[ name ] === on ) return;
		this.holding[ name ] = on;
		this.emit( OWNED[ name ].key, on ? 'pressed' : 'released' );

	}

	/** Once a frame, before the frame runs: decide what to hold. */
	think( dt ) {

		if ( ! this.enabled ) return;

		const sim = this.sim, c = sim.runner;
		const limp = c.state === 'bailing' || sim.ragdoll.active;

		for ( const [ name, edge ] of this.requests.splice( 0 ) ) {

			const was = this.user[ name ];

			this.user[ name ] = edge === 'pressed';
			if ( name === 'jump' && edge === 'pressed' && ! was && ! limp ) this.startJump( dt );

		}

		const grounded = c.grounded && ! ATTACHED.has( c.state );

		// Limp, there is nothing to plan: the owned keys are held as the player holds them, so Space (the jump key)
		// stands the runner up as it does without the pilot.
		if ( limp ) {

			for ( const name of Object.keys( this.holding ) ) this.set( name, this.user[ name ] );
			this.plan = null;
			this.label = '';

			return;

		}

		if ( this.plan ) this.flyJump( dt );

		const plan = this.plan, best = plan?.best;
		let jump, grab, precision;

		if ( plan?.aim ) {

			precision = ! plan.down;
			jump = plan.pressedAt !== null && plan.frame - plan.pressedAt < 2;
			grab = false;

		} else {

			const air = ! grounded && ! plan?.holding;

			precision = air && Boolean( best?.precision );
			grab = air && ! best?.precision;
			jump = Boolean( plan?.holding || this.user.jump );

		}

		this.set( 'grab', this.user.grab || grab );
		this.set( 'precision', this.user.precision || precision );

		if ( ! grounded && ! plan?.holding && ! plan?.aim && ! best?.precision && ! this.user.jump && c.velocity.y < ROLL_FALL && -- this.rollCheck <= 0 ) {

			this.rollCheck = ROLL_CHECK_EVERY;
			this.checkRoll( dt );

		}

		if ( this.roll > 0 ) this.roll --;

		this.set( 'jump', jump || this.roll > 0 );
		this.label = [
			plan?.aim && `precision jump (${plan.pressedAt === null ? `charging to ${best?.charge ?? '…'}` : 'off'})`,
			plan?.holding && `jump (letting go at ${plan.release ?? '…'})`,
			this.roll > 0 && 'roll', this.holding.grab && 'grab', this.holding.precision && 'precision',
		].filter( Boolean ).join( ' · ' );

	}

	/** Before the frame samples the devices: the owned keys as the pilot holds them. */
	apply( input ) {

		if ( ! this.enabled ) return;

		for ( const code of [ ...input.keys ] ) if ( OWNED_KEYS.has( code ) ) input.keys.delete( code );
		input.mouseButtons.delete( OWNED.grab.button );
		if ( this.holding.jump ) input.keys.add( OWNED.jump.key );
		if ( this.holding.precision ) input.keys.add( OWNED.precision.key );
		if ( this.holding.grab ) input.mouseButtons.add( OWNED.grab.button );

	}

	// The player pressed jump: plan it from a snapshot, the first two releases at once, and a precision crouch when the
	// runner is nearly still with the stick pushed.
	startJump( dt ) {

		const c = this.sim.runner, input = this.sim.input;

		this.plan = { frame: - 1, holding: true, release: null, releases: [ ...RELEASES ], stopped: false, best: null, tried: [], snapshot: takeSnapshot( this.sim ), dt, user: this.userFrame(), held: { ...this.holding }, aim: false, pressedAt: null, air: false, down: false };

		if ( ! this.plan.snapshot.restorable ) {

			this.plan = null;

			return;

		}

		this.tryRelease( RELEASES[ 0 ] );
		this.tryRelease( RELEASES[ 1 ] );

		const stick = input.moveAmount > AIM_STICK;

		if ( stick && c.grounded && c.speed <= AIM_MAX_SPEED && c.precisionAllowed && ! c.balancing && ! c.stunt ) {

			const plain = this.bestOf( this.plan.tried );

			this.tryJump( { charge: CHARGES[ 0 ] } );
			this.tryJump( { charge: CHARGES[ 1 ] } );

			const aim = this.bestOf( this.plan.tried.filter( ( t ) => t.charge !== undefined ) );

			if ( aim.score > plain.score + AIM_MARGIN ) {

				this.plan.aim = true;
				this.plan.holding = false;
				this.plan.best = aim;

			}

		}

	}

	// Each frame of a plain jump's plan: try the next releases within the budget, and let go at the best one's frame.
	flyJump() {

		const plan = this.plan, c = this.sim.runner;

		plan.frame ++;
		if ( plan.aim ) return this.flyAim();

		if ( ! plan.holding ) {

			plan.air ||= ! c.grounded;
			if ( plan.air && c.grounded || plan.frame > PLAN_FRAMES ) this.plan = null;

			return;

		}

		let tries = 0;

		for ( const k of plan.releases ) {

			if ( plan.tried.some( ( t ) => t.release === k ) ) continue;
			if ( k <= plan.frame || tries ++ >= this.perFrame ) break;
			this.tryRelease( k );

		}

		const best = this.bestOf( plan.tried );

		plan.best = best;
		plan.release = best?.release ?? null;

		if ( ! this.user.jump && ( best && best.release <= plan.frame || plan.frame >= RELEASES[ RELEASES.length - 1 ] ) ) {

			plan.holding = false;
			plan.release = plan.frame;
			if ( best?.release !== plan.frame ) plan.best = { release: plan.frame };

		}

	}

	// Each frame of a precision jump's plan: try the next charges within the budget and press jump at the best one's
	// frame; the plan ends a while after the landing.
	flyAim() {

		const plan = this.plan, c = this.sim.runner;

		if ( plan.pressedAt === null ) {

			let tries = 0;

			for ( const charge of CHARGES ) {

				if ( charge <= plan.frame || plan.tried.some( ( t ) => t.charge === charge ) ) continue;
				if ( tries ++ >= this.perFrame ) break;
				this.tryJump( { charge } );

			}

			plan.best = this.bestOf( plan.tried.filter( ( t ) => t.charge !== undefined ) );
			if ( plan.best.charge <= plan.frame ) plan.pressedAt = plan.frame;

			return;

		}

		plan.air ||= plan.frame > plan.pressedAt && ! c.grounded;

		if ( plan.air && c.grounded && ! plan.down ) {

			plan.down = true;
			plan.downAt = plan.frame;

		}

		if ( plan.down && plan.frame - plan.downAt > AIM_SETTLE || plan.frame > PLAN_FRAMES ) this.plan = null;

	}

	bestOf( tried ) {

		return tried.reduce( ( a, b ) => ( ! a || b.score > a.score + 1e-6 ? b : a ), null );

	}

	// The keys and buttons the player holds, the owned ones aside.
	userFrame() {

		const input = this.sim.input;

		return { keys: [ ...input.keys ].filter( ( code ) => ! OWNED_KEYS.has( code ) ), buttons: [ ...input.mouseButtons ].filter( ( b ) => b !== OWNED.grab.button ) };

	}

	// A release, and if it runs off a ledge, the same release aiming a precision landing instead.
	tryRelease( release ) {

		const plain = this.tryJump( { release } );

		if ( plain.ranOff ) this.tryJump( { release, precision: true } );

	}

	tryJump( candidate ) {

		const plan = this.plan, memo = {};
		const result = this.lookAhead( plan.snapshot, plan.dt, plan.user, plan.held, ( frame, c ) => wants( candidate, frame, c, memo ) );
		const tried = { ...candidate, ...result };

		plan.tried.push( tried );

		// The first release that runs into a wall adds the releases just short of it. Every later one that does stops
		// at the same frame: up to then they all hold the same keys.
		if ( candidate.release !== undefined && result.stoppedIn !== null && ! plan.stopped ) {

			plan.stopped = true;
			for ( const before of BEFORE_STOP ) if ( result.stoppedIn - before >= 1 && ! plan.releases.includes( result.stoppedIn - before ) ) plan.releases.push( result.stoppedIn - before );
			plan.releases.sort( ( a, b ) => a - b );

		}

		return tried;

	}

	checkRoll( dt ) {

		const result = this.lookAhead( takeSnapshot( this.sim ), dt, this.userFrame(), { ...this.holding }, ( frame, c ) => ( { grab: ! c.grounded } ), ROLL_LOOK_AHEAD );

		if ( result.landedIn !== null && result.landedIn <= ROLL_WITHIN && result.hard ) this.roll = ROLL_HOLD;

	}

	// Runs the sim from a snapshot with the stand-in figure, the owned keys as the plan wants them each frame, then puts
	// everything back. The score: reaching something is worth most; then the way forward made and the height kept; a
	// bail, a long drop to nothing, or running off a ledge cost. It also tells the frame the runner was stopped (by a
	// wall) while still holding jump on the ground, if it was.
	lookAhead( snapshot, dt, user, held, plan, frames = LOOK_AHEAD_FRAMES ) {

		const sim = this.sim, figure = sim.figure, onStep = sim.onStep, enabled = this.enabled;
		const current = takeSnapshot( sim );

		restoreSnapshot( sim, snapshot );
		sim.figure = this.stub;
		sim.onStep = null;
		this.enabled = false;

		const c = sim.runner, start = c.position.clone(), facing = { x: Math.sin( c.yaw ), z: Math.cos( c.yaw ) };

		held = { ...held };
		let good = null, bailed = false, landedIn = null, hard = false, wasAirborne = ! c.grounded, lowest = start.y, fall = 0;
		let landedY = 0, leftIn = null, stoppedIn = null;

		for ( let frame = 0; frame < frames; frame ++ ) {

			const want = plan( frame, c ), speed = c.speed;

			for ( const name of Object.keys( held ) ) {

				const on = Boolean( want[ name ] );

				if ( on !== held[ name ] ) this.emitAhead( OWNED[ name ].key, on ? 'pressed' : 'released' );
				held[ name ] = on;

			}

			sim.frame( dt, ( input ) => {

				input.keys = new Set( user.keys );
				input.mouseButtons = new Set( user.buttons );
				if ( held.jump ) input.keys.add( OWNED.jump.key );
				if ( held.precision ) input.keys.add( OWNED.precision.key );
				if ( held.grab ) input.mouseButtons.add( OWNED.grab.button );
				input.mouse.x = input.mouse.y = 0;

			} );

			lowest = Math.min( lowest, c.position.y );

			if ( stoppedIn === null && held.jump && ! wasAirborne && c.grounded && speed > STOPPED.from && c.speed < speed * STOPPED.kept ) stoppedIn = frame;

			if ( c.state === 'bailing' || sim.ragdoll.active ) {

				bailed = true;
				break;

			}

			if ( GOOD.has( c.state ) && good === null ) good = frame;

			if ( wasAirborne && c.grounded && landedIn === null ) {

				landedIn = frame;
				landedY = c.position.y;
				hard = fall < HARD_FALL;

			}

			if ( landedIn !== null && leftIn === null && ! c.grounded && good === null ) leftIn = frame;

			fall = c.velocity.y;

			wasAirborne ||= ! c.grounded;
			const until = leftIn !== null ? leftIn + RUN_OFF.after : landedIn + RUN_OFF.frames;

			if ( ( good !== null && frame > good + AFTER_GOOD ) || ( landedIn !== null && frame > until ) ) break;

		}

		const ahead = ( c.position.x - start.x ) * facing.x + ( c.position.z - start.z ) * facing.z;
		const ranOff = ! bailed && leftIn !== null && ( ! c.grounded || c.position.y < landedY - RUN_OFF.drop );
		const runOff = ranOff ? 4 + ( c.grounded ? 2 * ( landedY - c.position.y ) : 6 ) : 0;
		const rise = c.position.y - start.y;
		const score = ( bailed ? - 100 : 0 ) + ( good !== null ? 20 : 0 ) + Math.max( - 5, ahead ) + ( rise > 0 ? 0.5 * rise : 3 * rise ) - ( start.y - lowest > 4 && good === null ? 10 : 0 ) - runOff;

		restoreSnapshot( sim, current );
		sim.figure = figure;
		sim.onStep = onStep;
		this.enabled = enabled;

		return { score, good, bailed, landedIn, hard, ahead, ranOff, stoppedIn };

	}

}

export { Pilot };
