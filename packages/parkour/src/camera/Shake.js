import { MathUtils, Vector3 } from 'three';
import { CAMERA } from '../data/camera.js';

// Camera shakes: short offsets of the camera's place and turn, started by the runner's camera events (a landing, a
// roll, a wall run…) and by the run bob, laid over the camera after the follow camera has placed it. One model
// serves every preset (data/camera.js): along each of the camera's axes a part either sways along a sine or makes
// one smooth bump, and a linear fade in and out shapes the whole. A shake started at a point in the world (its
// epicenter) is weaker the further the camera is from that point.

// A shake from a point in the world fades out linearly with the camera's distance from it, to nothing this far away.
const EPICENTER_REACH = 5.5;

const MOVE_AXES = [ 'right', 'up', 'forward' ];
const TURN_AXES = [ 'pitch', 'yaw', 'roll' ];

const _move = [ 0, 0, 0 ];
const _turn = [ 0, 0, 0 ];
const _translation = new Vector3();

/**
 * How much of a shake is in at `time`: up over `fadeIn`, down over the last `fadeOut` of its `duration`.
 * @param {number} time seconds since it started
 * @param {{ duration: number, fadeIn: number, fadeOut: number }} preset
 * @returns {number} 0…1
 */
function envelope( time, { duration, fadeIn, fadeOut } ) {

	if ( time < 0 || time >= duration ) return 0;

	return Math.min( 1, time / fadeIn, ( duration - time ) / fadeOut );

}

/**
 * One smooth bump: from rest at the start up to 1 at `peak`, back to rest at `end`, along smoothsteps (so the
 * camera eases into the jolt and out of it).
 */
function bump( time, peak, end ) {

	return Math.min( MathUtils.smoothstep( time, 0, peak ), MathUtils.smoothstep( end - time, 0, end - peak ) );

}

// Where a part is along its shape at `time`, from −1 to 1: a sine for a sway; for a bump, its rise and fall. A held
// bump stays up once there, until the shake fades out; a bump that winds up first draws back by `windUp` (of its
// height), a quarter of the way to its peak, the way a swing gathers itself.
function shape( part, time, duration, phase ) {

	if ( part.frequency ) return Math.sin( 2 * Math.PI * part.frequency * time + phase );
	if ( part.hold ) return MathUtils.smoothstep( time, 0, part.peak );

	if ( part.windUp && time < part.peak ) {

		const drawnBack = part.peak / 4;

		if ( time < drawnBack ) return - part.windUp * MathUtils.smoothstep( time, 0, drawnBack );

		return MathUtils.lerp( - part.windUp, 1, MathUtils.smoothstep( time, drawnBack, part.peak ) );

	}

	return bump( time, part.peak, duration );

}

// A part's offset along (or about) each of its three axes at `time`, before weighting; zero for a preset without
// that part.
function partOffset( part, axes, phases, time, duration, out ) {

	for ( let i = 0; i < 3; i ++ ) {

		const amplitude = part?.[ axes[ i ] ];

		out[ i ] = amplitude ? amplitude * shape( part, time, duration, phases?.[ i ] ) : 0;

	}

	return out;

}

class Shake {

	/**
	 * @param {() => number} random draws in [0, 1) for the sways' starting phases (a seeded stream, so replays hold)
	 * @param {object} [presets] by name, as in data/camera.js
	 */
	constructor( random, presets = CAMERA.shakes ) {

		this.random = random;

		this.presets = presets;

		this.active = [];

	}

	/**
	 * Starts the preset `name`, if there is one.
	 * @param {string} name
	 * @param {object} [options]
	 * @param {number} [options.scale] how much of it (1: all)
	 * @param {Vector3} [options.epicenter] where in the world it comes from: weaker with the camera's distance
	 * @param {Quaternion} [options.orientation] the frame its moves are along, instead of the camera's own
	 */
	start( name, { scale = 1, epicenter = null, orientation = null } = {} ) {

		const preset = this.presets[ name ];

		if ( ! preset ) return null;

		const shake = {
			name, preset, time: 0, scale, epicenter, orientation,
			movePhases: this.phases( preset.move, MOVE_AXES ),
			turnPhases: this.phases( preset.turn, TURN_AXES )
		};

		this.active.push( shake );

		return shake;

	}

	phases( part, axes ) {

		if ( ! part?.frequency ) return null;

		return axes.map( ( axis ) => part.fixedPhase?.includes( axis ) || ! part[ axis ] ? 0 : this.random() * 2 * Math.PI );

	}

	/**
	 * Advances every shake by `dt` and lays it over the camera as placed this frame; a shake that has run its
	 * course goes.
	 */
	update( dt, camera ) {

		for ( const shake of this.active ) {

			shake.time += dt;

			const weight = this.weight( shake, camera );

			if ( weight === 0 ) continue;

			const { preset, time } = shake;
			const move = partOffset( preset.move, MOVE_AXES, shake.movePhases, time, preset.duration, _move );
			const turn = partOffset( preset.turn, TURN_AXES, shake.turnPhases, time, preset.duration, _turn );

			// The camera looks down its −z, so forward is −z.
			_translation.set( move[ 0 ], move[ 1 ], - move[ 2 ] ).multiplyScalar( weight ).applyQuaternion( shake.orientation ?? camera.quaternion );
			camera.position.add( _translation );
			camera.rotateX( turn[ 0 ] * weight );
			camera.rotateY( turn[ 1 ] * weight );
			camera.rotateZ( turn[ 2 ] * weight );

		}

		this.active = this.active.filter( ( shake ) => shake.time < shake.preset.duration );

	}

	weight( shake, camera ) {

		let weight = envelope( shake.time, shake.preset ) * shake.scale;

		if ( shake.epicenter ) weight *= Math.max( 0, 1 - camera.position.distanceTo( shake.epicenter ) / EPICENTER_REACH );

		return weight;

	}

	clear() {

		this.active.length = 0;

	}

}

export { Shake, envelope, bump, shape, EPICENTER_REACH };
