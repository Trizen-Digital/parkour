// What a QA tape remembers of each frame, to tell whether a replay comes out the same.
//
// FrameTrace hashes, bit for bit, what the golden traces record (every step's position, velocity, heading, state,
// move, stunt and markers; each frame's camera, view and events) into one 32-bit number per frame, and keeps a few
// rounded readings beside it for the timeline. JointMeter measures how hard the figure's joints accelerate, which
// finds "pops": a frame where a limb jumps.

import { movementMode } from '../runner/states.js';
import { wrapAngle } from '../math.js';

// FNV-1a over the numbers' bits.
const OFFSET = 2166136261, PRIME = 16777619;
const _f64 = new Float64Array( 1 ), _u32 = new Uint32Array( _f64.buffer );

function mixNumber( h, x ) {

	_f64[ 0 ] = x;
	h = Math.imul( h ^ _u32[ 0 ], PRIME );
	return Math.imul( h ^ _u32[ 1 ], PRIME );

}

function mixString( h, s ) {

	h = Math.imul( h ^ s.length, PRIME );
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), PRIME );
	return h;

}

/**
 * An event as the traces write it: `type:name`, or `state:from>to` for a state change.
 * @param {object} event a runner event
 * @returns {string}
 */
function eventName( event ) {

	if ( event.type ) return event.type + ':' + ( event.name ?? event.action ?? event.id ?? '' );
	if ( event.to !== undefined ) return 'state:' + event.from + '>' + event.to;
	return 'event';

}

/**
 * @param {Simulation} sim
 * @returns {object|null} the move playing (not blending out): `move.name`, `time`
 */
function movePlaying( sim ) {

	return sim.motion.moves.instances.findLast( ( instance ) => ! instance.stopping ) ?? null;

}

class FrameTrace {

	constructor( sim ) {

		this.sim = sim;
		this.hash = OFFSET;

	}

	/** Starts a frame's hash. */
	reset() {

		this.hash = OFFSET;

	}

	/** Adds a step (the simulation's onStep). */
	step() {

		const sim = this.sim, runner = sim.runner, moving = movePlaying( sim );
		let h = this.hash;
		for ( const x of [ runner.position.x, runner.position.y, runner.position.z, runner.velocity.x, runner.velocity.y, runner.velocity.z, runner.yaw ] ) h = mixNumber( h, x );
		h = mixString( h, sim.ragdoll.active ? 'ragdoll' : movementMode( runner ) );
		h = mixString( h, runner.state ?? '' );
		h = mixString( h, moving?.move?.name ?? '' );
		h = mixNumber( h, moving?.time ?? 0 );
		h = mixString( h, runner.stunt?.name ?? '' );
		h = mixNumber( h, runner.stunt?.time ?? 0 );
		h = mixString( h, ( sim.motion.markers || [] ).map( ( marker ) => marker.type + ':' + marker.name ).join( '|' ) );
		this.hash = h;

	}

	/**
	 * Ends the frame.
	 * @returns {object} the frame's row: `hash`, and rounded for the timeline: `x`, `y`, `z` (mm), `yaw`, `cy` (view
	 *   yaw), `cp` (view pitch) (mrad), `v` (horizontal speed), `vy` (cm/s), `steps`, `state`, `move`, `tau` (the
	 *   move's time, ms), `mode`
	 */
	frame() {

		const sim = this.sim, runner = sim.runner, camera = sim.camera, view = sim.view, q = camera.quaternion, moving = movePlaying( sim );
		let h = mixNumber( this.hash, sim.steps );
		for ( const x of [ camera.position.x, camera.position.y, camera.position.z, q.x, q.y, q.z, q.w, camera.fov, view.yaw, view.pitch ] ) h = mixNumber( h, x );
		h = mixString( h, sim.frameEvents.map( eventName ).join( '|' ) );
		this.hash = OFFSET;
		return {
			hash: h >>> 0,
			x: Math.round( runner.position.x * 1000 ), y: Math.round( runner.position.y * 1000 ), z: Math.round( runner.position.z * 1000 ),
			yaw: Math.round( wrapAngle( runner.yaw ) * 1000 ),
			v: Math.round( runner.speed * 100 ), vy: Math.round( runner.velocity.y * 100 ),
			cy: Math.round( wrapAngle( view.yaw ) * 1000 ), cp: Math.round( view.pitch * 1000 ),
			steps: sim.steps,
			state: sim.ragdoll.active ? 'limp' : runner.state ?? '',
			move: moving?.move?.name ?? '',
			tau: moving ? Math.round( moving.time * 1000 ) : 0,
			mode: sim.ragdoll.active ? 'ragdoll' : movementMode( runner ),
		};

	}

}

// The joints a pop shows on.
const JOINTS = [ 'hips', 'head', 'chest', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'leftShin', 'rightShin' ];

class JointMeter {

	/**
	 * @param {Figure} figure measured by its bone roles; a figure without bones measures 0
	 */
	constructor( figure ) {

		this.figure = figure;
		this.bones = JOINTS.map( ( role ) => figure.roles?.[ role ] && figure.root.getObjectByName( figure.roles[ role ] ) ).filter( Boolean );
		this.positions = [ [], [], [] ];
		this.dts = [ 0, 0 ];
		this.frames = 0;

	}

	/** Forgets the frames before (a respawn: the body jumps). */
	reset() {

		this.frames = 0;

	}

	/**
	 * Reads the joints' world positions after a frame.
	 * @param {number} dt the time the frame advanced (s)
	 * @returns {number} the largest joint acceleration over the last three frames (m/s², rounded), 0 until there are
	 *   three
	 */
	measure( dt ) {

		if ( ! this.bones.length ) return 0;
		const [ p0, p1, p2 ] = this.positions = [ this.positions[ 2 ], this.positions[ 0 ], this.positions[ 1 ] ];
		this.bones.forEach( ( bone, i ) => {

			const e = bone.matrixWorld.elements;
			( p0[ i ] ??= [ 0, 0, 0 ] ).splice( 0, 3, e[ 12 ], e[ 13 ], e[ 14 ] );

		} );
		this.dts = [ dt, this.dts[ 0 ] ];
		if ( ++ this.frames < 3 || ! ( dt > 0 ) || ! ( this.dts[ 1 ] > 0 ) ) return 0;

		// The change of velocity between the last two frames, over their mean length.
		const d0 = dt, d1 = this.dts[ 1 ], k = 2 / ( d0 + d1 );
		let peak = 0;
		for ( let i = 0; i < p0.length; i ++ ) {

			const a = [ 0, 1, 2 ].map( ( j ) => ( ( p0[ i ][ j ] - p1[ i ][ j ] ) / d0 - ( p1[ i ][ j ] - p2[ i ][ j ] ) / d1 ) * k );
			peak = Math.max( peak, Math.hypot( ...a ) );

		}

		return Math.round( peak );

	}

}

export { FrameTrace, JointMeter, eventName, movePlaying };
