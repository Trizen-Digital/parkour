// The game's sound: after each frame it reads the run (the states the runner entered, the sound cues its takes
// crossed, its flags and how fast its body moves) and tells the Mixer what plays. It only reads: nothing here reaches
// the simulation, so a run sounds the way it plays, and the sound off or turned down never changes one. The player
// makes one for the run it plays (src/app/Player.js); the benchmark, the replays and the headless tools make none.
// docs/ARCHITECTURE.md (Sound) lists what plays when.

import { Vector3 } from 'three/webgpu';
import { STEP } from '@trizen/parkour/sim/Simulation.js';
import { clamp } from '@trizen/parkour/math.js';

// Entering a state plays a sound: [ sound, level ].
const ON_ENTER = {
	catchingLedge: [ 'catch', 1 ],
	leapingToLedge: [ 'jump', 0.45 ],
	vaulting: [ 'catch', 0.45 ],
	climbingUp: [ 'roll', 0.35 ],
	wallRunning: [ 'catch', 0.35 ],
	wallPlanted: [ 'catch', 0.6 ],
	wallKicking: [ 'jump', 0.6 ],
	onBar: [ 'catch', 0.6 ],
	onRope: [ 'catch', 0.55 ],
	onPole: [ 'catch', 0.5 ],
	onZipline: [ 'catch', 0.6 ],
	onLadder: [ 'rung', 0.7 ],
	onPipe: [ 'rung', 0.7 ],
	toppingOut: [ 'roll', 0.35 ],
	sliding: [ 'slide', 0.8 ],
	rolling: [ 'roll', 0.8 ],
	precisionJump: [ 'jump', 0.8 ],
	bailing: [ 'bail', 1 ],
};

// Rising out of these states, or going straight into a stunt in the air (a flip off the ground), is a jump, this loud:
// off the ground in full, off a wall, a ledge, a pole, a pipe or a ladder less (bars and ropes let go with a rush of
// air instead).
const JUMP_FROM = {
	standing: 1, walking: 1, sprinting: 1, sliding: 1, rolling: 1, groundStunt: 1, aiming: 1,
	wallRunning: 0.75, hanging: 0.5, onPole: 0.6, onPipe: 0.6, onLadder: 0.6,
};

// Airborne longer than this (s) before touching down is a landing; less is the ground's bumps underfoot.
const LANDING_AIR_TIME = 0.12;
// A landing slower than LANDING_SOFT (m/s, falling) is a step; above it the landing grows to full at LANDING_HARD.
// Either way a foot comes down, at LANDING_STEP: a little under a running step, and as loud as it was before the steps'
// base level came down to 70% (0.6 of the old base).
const LANDING_SOFT = 1.5;
const LANDING_HARD = 12;
const LANDING_STEP = 0.86;

// Steps play on foot on the ground, and along a wall at WALL_STEP. They grow from walking pace to full at a sprint
// (m/s).
const STEP_STATES = new Set( [ 'standing', 'walking', 'sprinting', 'striding', 'wallRunning' ] );
const STEP_QUIET_SPEED = 2;
const STEP_LOUD_SPEED = 6;
const WALL_STEP = 0.8;
// Rungs play on a ladder or a pipe and over its top, and along a ledge (a hand there plays at LEDGE_RUNG).
const RUNG_STATES = new Set( [ 'onLadder', 'onPipe', 'toppingOut', 'hanging' ] );
const LEDGE_RUNG = 0.4;

// The states on a pole, a pipe or a ladder, down which the runner slides: going down faster than SLIDE_DOWN_SPEED
// (m/s) is a slide, which ends once slower than SLIDE_DOWN_END. The first SLIDE_DOWN_AFTER (s) on one is the catch,
// still carrying the fall.
const SLIDE_DOWN_STATES = new Set( [ 'onPole', 'onPipe', 'onLadder' ] );
const SLIDE_DOWN_SPEED = 1;
const SLIDE_DOWN_END = 0.3;
const SLIDE_DOWN_AFTER = 0.2;

// The wind: the body's speeds (m/s) it rises between, and how loud it gets at the top.
const AIR_WIND = { from: 6, to: 20, level: 0.8 };
const ZIPLINE_WIND = { from: 2, to: 12, level: 0.7 };
const ROPE_WIND = { from: 3, to: 9, level: 0.45 };
const SLIDE_WIND = { from: 3, to: 10, level: 0.5 };
// Under a wall run, quietly.
const WALL_RUN_WIND = 0.1;
// A slide is down a slope once it has dropped faster than SLOPE_DROP (m/s) for SLOPE_SLIDE_AFTER (s: the slide sound's
// start has played); its wind then follows its speed until it ends, run-out and all. A quick slide on the level has
// none.
const SLOPE_SLIDE_AFTER = 0.25;
const SLOPE_DROP = 0.3;
// Swinging off the bar gusts to BAR_GUST, falling away over BAR_GUST_TIME (s); an air trick adds AIR_TRICK_GUST to the
// wind there is, for AIR_TRICK_GUST_TIME.
const BAR_GUST = 0.35;
const BAR_GUST_TIME = 0.8;
const AIR_TRICK_GUST = 0.2;
const AIR_TRICK_GUST_TIME = 0.4;
// Off a rope, the rope's wind goes on this long (s), fading as the body slows rather than stopping with the rope.
const ROPE_AFTER = 1.2;
// How fast the wind follows (s, time constants): rising, falling, and falling after a rope.
const WIND_RISE = 0.15;
const WIND_FALL = 0.35;
const WIND_FALL_ROPE = 0.6;
// The wind's pitch, from slow to fast over these speeds (m/s).
const WIND_RATE = { from: 4, to: 20, low: 0.9, high: 1.15 };

// Slow motion plays everything lower (the effects, the wind, the ambience and the room's reverb), easing down and back
// up as the run does, but no lower than this: at its own scale (0.25 by default) it would only rumble.
const SLOWEST_RATE = 0.6;
// Starting again (s), the run settles quietly: the drop onto the spawn plays nothing.
const SETTLE = 0.3;
// The run's time jumping on by more than this in a frame (s) is another run taking over (QA's Play from Here).
const TIME_JUMP = 0.5;

// 0 below `from`, 1 above `to`, in a straight line between.
const ramp = ( value, from, to ) => clamp( ( value - from ) / ( to - from ), 0, 1 );

class Sound {

	/** @param {Mixer} mixer */
	constructor( mixer ) {

		this.mixer = mixer;
		this.velocity = new Vector3();
		this.reset( null );

	}

	/** Starts afresh on a run: nothing playing, nothing remembered of the last one. */
	reset( sim ) {

		this.sim = sim;
		this.time = sim?.runner.time ?? 0;
		this.settle = SETTLE;
		// What the runner was last frame, for what changed since.
		this.grounded = true;
		this.tricking = false;
		this.skidded = false;
		this.doors = sim?.runner.doorsAndSwitches.doors.map( ( door ) => door.open ) ?? [];
		// Seconds off the ground, and how fast the body was falling when last in the air (m/s).
		this.airTime = 0;
		this.fallSpeed = 0;
		this.slidingDown = false;
		// Seconds a slide has dropped, and whether it is a slope slide (its wind goes on until it ends).
		this.dropping = 0;
		this.slopeSlide = false;
		// The wind: a gust's level and how fast it falls away (per second), the time left of a rope's wind, and the
		// level as it has followed all of them.
		this.gust = 0;
		this.gustFall = 0;
		this.offRope = 0;
		this.wind = 0;
		this.mixer.stopAll();

	}

	/**
	 * After a frame of the run: what it played.
	 * @param {Simulation} sim
	 * @param {number} dt the frame's time (s)
	 */
	frame( sim, dt ) {

		const runner = sim.runner, mixer = this.mixer;
		// A respawn puts the run's time back.
		if ( sim !== this.sim || runner.time < this.time || runner.time > this.time + TIME_JUMP ) this.reset( sim );
		this.time = runner.time;

		// Paused by its own key, the frame before the menu opens over it.
		mixer.hold( sim.simDt === 0 );
		if ( sim.simDt === 0 ) return;

		const slowest = Math.max( SLOWEST_RATE, sim.tuning.values.slowMotionScale );
		mixer.setRate( 1 + ( slowest - 1 ) * sim.slowMotion, slowest );
		this.settle -= dt;

		// The body's velocity over its last step, whatever moved it (its own movement, a hold, a move, the ragdoll).
		const velocity = this.velocity.subVectors( runner.position, runner.previousPosition ).divideScalar( STEP );
		const speed = velocity.length();

		// A state left and entered again within the frame (a climb's last step up onto the floor) goes on: it plays
		// nothing new.
		const left = new Set();
		for ( const event of sim.frameEvents ) {

			if ( ! event.to ) continue;
			if ( ! left.has( event.to ) ) this.entered( event.from, event.to );
			left.add( event.from );

		}

		for ( const cue of sim.frameSounds ) this.cued( cue.name, runner );
		this.watch( runner, velocity, dt );
		mixer.wind( this.blow( runner, velocity, speed, dt ), WIND_RATE.low + ( WIND_RATE.high - WIND_RATE.low ) * ramp( speed, WIND_RATE.from, WIND_RATE.to ) );

	}

	/** The run is held (a menu, the editor, the benchmark): silent until it plays on. */
	hold() {

		this.mixer.hold( true );

	}

	play( id, level ) {

		if ( this.settle <= 0 ) this.mixer.play( id, level );

	}

	// A state the runner entered this frame.
	entered( from, to ) {

		const sound = ON_ENTER[ to ];
		if ( sound ) this.play( ...sound );

		if ( ( to === 'rising' || to === 'airStunt' ) && JUMP_FROM[ from ] ) this.play( 'jump', JUMP_FROM[ from ] );
		// The catch at the end of a leap from one ledge to another.
		if ( to === 'hanging' && from === 'leapingToLedge' ) this.play( 'catch', 0.8 );
		if ( from === 'onBar' ) this.gustTo( BAR_GUST, BAR_GUST_TIME );
		if ( from === 'onRope' ) this.offRope = ROPE_AFTER;

	}

	// A sound cue a take crossed this frame: a foot on the ground or a wall, a hand or foot on a rung. A take still
	// blending out crosses its cues after the runner has left it (a stride's step as the jump starts, a rung as the
	// slide down begins), so each plays only while the runner does what it is for.
	cued( name, runner ) {

		const state = runner.state;
		if ( name === 'rung' && RUNG_STATES.has( state ) && ! this.slidingDown ) this.play( 'rung', state === 'hanging' ? LEDGE_RUNG : 1 );
		if ( name === 'step' && STEP_STATES.has( state ) && ( runner.grounded || state === 'wallRunning' ) ) this.play( 'step', state === 'wallRunning' ? WALL_STEP : 0.55 + 0.45 * ramp( runner.speed, STEP_QUIET_SPEED, STEP_LOUD_SPEED ) );

	}

	// What changed on the runner since the last frame: touching down, a trick starting, a skid, a door burst open, a
	// slide down a pole, pipe or ladder.
	watch( runner, velocity, dt ) {

		const state = runner.state;

		if ( state === 'bailing' ) {

			this.airTime = 0;

		} else if ( runner.grounded ) {

			if ( ! this.grounded && this.airTime > LANDING_AIR_TIME ) {

				if ( this.fallSpeed >= LANDING_SOFT ) this.play( 'land', 0.25 + 0.75 * ramp( this.fallSpeed, LANDING_SOFT, LANDING_HARD ) );
				this.play( 'step', LANDING_STEP );

			}

			this.airTime = 0;

		} else {

			this.airTime += dt;
			this.fallSpeed = Math.max( 0, - velocity.y );

		}

		this.grounded = runner.grounded;

		// A cartwheel or a ground trick tumbles; one in the air rushes.
		if ( runner.tricking && ! this.tricking ) {

			if ( runner.grounded ) this.play( 'roll', 0.55 );
			else this.gustTo( Math.min( 1, this.wind + AIR_TRICK_GUST ), AIR_TRICK_GUST_TIME );

		}

		this.tricking = runner.tricking;

		const skidded = runner.skidStops.skidded;
		if ( skidded && ! this.skidded ) this.play( 'slide', 0.35 );
		this.skidded = skidded;

		// A shut door bursts open the step the body hits it (a barge) or the kick lands.
		runner.doorsAndSwitches.doors.forEach( ( door, i ) => {

			if ( door.open && ! this.doors[ i ] ) {

				if ( door.how === 'barge' ) this.play( 'door', 1 );
				else if ( door.how === 'kick' ) this.play( 'catch', 0.9 );

			}

			this.doors[ i ] = door.open;

		} );

		const down = SLIDE_DOWN_STATES.has( state ) && runner.stateTime > SLIDE_DOWN_AFTER ? - velocity.y : 0;
		if ( down > SLIDE_DOWN_SPEED && ! this.slidingDown ) {

			this.play( 'slide', 0.3 );
			this.slidingDown = true;

		} else if ( down < SLIDE_DOWN_END ) {

			this.slidingDown = false;

		}

	}

	// A rush of air at `level`, falling away to nothing over `seconds`.
	gustTo( level, seconds ) {

		if ( level <= this.gust ) return;
		this.gust = level;
		this.gustFall = level / seconds;

	}

	// The wind's level this frame: the loudest of what applies (never their sum, so they cannot pile up), followed
	// quickly up and more slowly down.
	blow( runner, velocity, speed, dt ) {

		const state = runner.state;
		this.gust = Math.max( 0, this.gust - this.gustFall * dt );
		this.offRope = Math.max( 0, this.offRope - dt );

		let target = this.gust;
		const lift = ( wind ) => target = Math.max( target, wind.level * ramp( speed, wind.from, wind.to ) );
		if ( ! runner.grounded || state === 'bailing' ) lift( AIR_WIND );
		if ( state === 'onZipline' ) lift( ZIPLINE_WIND );
		if ( state === 'onRope' || this.offRope > 0 ) lift( ROPE_WIND );
		this.dropping = state === 'sliding' && velocity.y < - SLOPE_DROP ? this.dropping + dt : 0;
		if ( this.dropping > SLOPE_SLIDE_AFTER ) this.slopeSlide = true;
		if ( state !== 'sliding' ) this.slopeSlide = false;
		if ( this.slopeSlide ) lift( SLIDE_WIND );
		if ( state === 'wallRunning' ) target = Math.max( target, WALL_RUN_WIND );

		const time = target > this.wind ? WIND_RISE : this.offRope > 0 ? WIND_FALL_ROPE : WIND_FALL;
		this.wind += ( target - this.wind ) * ( 1 - Math.exp( - dt / time ) );
		return this.wind;

	}

}

export { Sound };
