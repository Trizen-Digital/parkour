import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { Shake } from './Shake.js';
import { CAMERA } from '../data/camera.js';
import { movementMode } from '../runner/states.js';
import { random } from '../sim/random.js';
import { CAPSULE } from '../sim/tuning.js';
import { approach } from '../math.js';

// The camera body: where the camera is and where it looks, for the aim (ViewControl) and the drawn runner, once a
// frame after the steps. In third person it hangs on an arm over the runner's shoulder, from a root that trails the
// runner; in first person it sits at the animated head. Three eases reframe the third-person view (the speed zoom,
// the aim zoom, the fall tilt), shakes are laid over either view, and the field of view setting is handed to
// three.js here. Nothing in the simulation reads the camera body.

const { thirdPerson: THIRD, firstPerson: FIRST, eases: EASES } = CAMERA;

// Falling faster than this zooms out as if at speed.
const FAST_FALL_SPEED = 8;

// The run bob: every 0.2 s while running faster than this with the pad's sprint held.
const BOB_EVERY = 0.2;
const BOB_MIN_SPEED = 4.5;

// When the camera rides the head, the head's frame (the figure's headPose: x ahead of the face, y up) turned to the
// camera's, which looks down its −z with +y up: a quarter turn about up.
const ON_HEAD = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), - Math.PI / 2 );

// Held to a pipe or a ladder, or climbing over its top: the first-person camera stands back off it.
const CLIMBING = new Set( [ 'onPipe', 'onLadder', 'toppingOut' ] );

const UP = new Vector3( 0, 1, 0 );

const NO_PREFERENCES = Object.freeze( {} );

const _aim = new Quaternion();
const _offset = new Vector3();
const _ahead = new Vector3();

// The rotation that looks along the aim. The camera looks down its −z and a yaw of 0 faces +z, hence the half
// turn; pitch grows looking down.
function aimRotation( yaw, pitch, target ) {

	return target.setFromEuler( new Euler( - pitch, yaw + Math.PI, 0, 'YXZ' ) );

}

// The fraction of its gap a rotation damped at `rate` closes in `dt`: 1 − e^(−rate·dt), so it turns the same way
// at any frame rate.
function dampFraction( rate, dt ) {

	return 1 - Math.exp( - rate * dt );

}

// One frame of two lags in a row, on one axis: the follow point closes on the target at `rate`, the root on the
// follow point at `rootRate`. Solved exactly over the frame for the target where it is drawn this frame, so the pair
// moves the same way at any frame rate (stepping each lag on its own would let the root lead at low frame rates).
function trail( follow, root, axis, target, rate, rootRate, dt ) {

	const followDecay = Math.exp( - rate * dt );
	const rootDecay = Math.exp( - rootRate * dt );

	// How much of the follow point's lead the root takes on over the frame (rootRate·dt·e^(−rate·dt) in the limit
	// of equal rates).
	const carried = Math.abs( rootRate - rate ) > 1e-6 ? rootRate * ( followDecay - rootDecay ) / ( rootRate - rate ) : rootRate * dt * followDecay;
	const lead = follow[ axis ] - target;

	follow[ axis ] = target + lead * followDecay;
	root[ axis ] = target + ( root[ axis ] - target ) * rootDecay + lead * carried;

}

// three.js takes the vertical field of view in degrees. The setting is horizontal, so the view keeps its width on
// any window.
function verticalFov( horizontal, aspect ) {

	return 2 * Math.atan( Math.tan( horizontal / 2 ) / aspect ) * MathUtils.RAD2DEG;

}

// A value that eases from 0 to 1 over `length` seconds along a smoothstep, and back the same way; it can turn round
// at any point.
class Ease {

	constructor( length ) {

		this.length = length;

		this.time = 0;

	}

	update( dt, on ) {

		this.time = MathUtils.clamp( this.time + ( on ? dt : - dt ), 0, this.length );

		return this.value;

	}

	get value() {

		return MathUtils.smoothstep( this.time, 0, this.length );

	}

}

class FollowCamera {

	/**
	 * @param {PerspectiveCamera} camera the camera it places
	 * @param {Tuning} tuning the player's camera settings (distances, field of view, slow follow, turn rate)
	 * @param {Queries} queries the course, to keep the first-person camera out of walls
	 * @param {Input} input preferences and the pad's sprint (the run bob)
	 */
	constructor( camera, tuning, queries, input ) {

		this.camera = camera;

		this.tuning = tuning;

		this.queries = queries;

		this.input = input;

		// The follow point trails the drawn runner; the arm's root trails the follow point.
		this.follow = new Vector3();

		this.armRoot = new Vector3();

		// The camera's own damped rotation, toward the aim (or the head).
		this.turn = new Quaternion();

		this.speedZoom = new Ease( EASES.speedZoom );

		this.aimZoom = new Ease( EASES.aimZoom );

		this.fallTilt = new Ease( EASES.fallTilt );

		this.aiming = false;

		// In first person the view turns with the head instead of the aim.
		this.viewOnHead = false;

		this.shakes = new Shake( random.stream( 'shakePhase' ) );

		this.bobClock = 0;

		// Horizontal, radians.
		this.fov = tuning.values.fov;

		// Which view the camera was placed for last frame (null: none since a reset). Changing view is a cut.
		this.placedFirstPerson = null;

		// Third person: which shoulder the camera hangs over, 1 the setting's own and −1 the other, eased; and whether
		// a wall on the setting's side has it swung over.
		this.shoulder = 1;
		this.offWall = false;

		// First person: the view's lean on a wall run (rad, rolling left positive).
		this.lean = 0;

	}

	/**
	 * Settles the camera behind a runner at `position` facing `yaw`, with nothing easing or shaking.
	 */
	reset( position, yaw = 0 ) {

		this.follow.copy( position );
		this.armRoot.copy( position );
		aimRotation( yaw, 0, this.turn );
		this.speedZoom.time = this.aimZoom.time = this.fallTilt.time = 0;
		this.aiming = false;
		this.viewOnHead = false;
		this.shakes.clear();
		this.bobClock = 0;
		this.placedFirstPerson = null;
		this.shoulder = 1;
		this.offWall = false;
		this.lean = 0;

	}

	/**
	 * Places the camera for this frame: after the view has taken its turn, at the runner's drawn position.
	 * @param {number} dt seconds of simulation this frame
	 * @param {ViewControl} view the aim
	 * @param {Runner} runner its state, flags and this frame's events
	 * @param {Vector3} position where the runner is drawn
	 * @param {Figure} figure the body, for the head in first person
	 */
	update( dt, view, runner, position, figure ) {

		const preferences = this.input.preferences?.values ?? NO_PREFERENCES;

		for ( const event of runner.events ) {

			if ( event.type === 'camera' ) this.handle( event, preferences );

		}

		// Every trick is seen from the head, so a first-person view turns with the body through it.
		if ( runner.tricking ) this.viewOnHead = true;

		const falling = movementMode( runner ) === 'air';
		const atSpeed = runner.sprinting || runner.state === 'sliding' || runner.state === 'onZipline' || ( falling && runner.velocity.length() > FAST_FALL_SPEED );

		this.speedZoom.update( dt, atSpeed );
		this.aimZoom.update( dt, this.aiming );
		this.fallTilt.update( dt, falling && runner.state !== 'striding' );

		this.trailRunner( dt, runner, position, preferences );

		const cut = runner.firstPerson !== this.placedFirstPerson;

		this.placedFirstPerson = runner.firstPerson;

		if ( runner.firstPerson ) this.placeOnHead( dt, view, runner, position, figure, preferences, cut );
		else this.placeBehind( dt, view, runner, position, cut );

		this.camera.fov = verticalFov( this.fov, this.camera.aspect );

		this.bob( dt, runner, falling );
		this.shakes.update( dt, this.camera );
		this.camera.updateProjectionMatrix();

	}

	// The aim's events (faceView, recenterView) are the view's, and the speed zoom follows the runner's speed every
	// frame, so speedZoomOut needs nothing here; any other name is a shake preset.
	handle( event, preferences ) {

		switch ( event.name ) {

			case 'aimZoomIn': this.aiming = true; break;
			case 'aimZoomOut': this.aiming = false; break;
			case 'viewOnHead': this.viewOnHead = true; break;
			case 'viewFree': this.viewOnHead = Boolean( preferences.headCamera ); break;
			default: this.shakes.start( event.name, event );

		}

	}

	// The follow point and the arm's root, every frame in either view, so a switch back to third person finds them
	// settled. A ledge move may ask for a slow follow (the tuning's rates), unless the player has turned the camera
	// lag off.
	trailRunner( dt, runner, position, preferences ) {

		const settings = this.tuning.values;
		const slow = runner.cameraLag && preferences.cameraLag !== false;
		const across = slow ? settings.cameraFollowRate : THIRD.followRate;
		const vertical = slow ? settings.cameraVerticalFollowRate : THIRD.verticalFollowRate;
		const follow = this.follow, root = this.armRoot;

		trail( follow, root, 'x', position.x, across, THIRD.armRate, dt );
		trail( follow, root, 'y', position.y, vertical, THIRD.armRate, dt );
		trail( follow, root, 'z', position.z, across, THIRD.armRate, dt );

		if ( root.distanceTo( follow ) > THIRD.maxLag ) root.sub( follow ).setLength( THIRD.maxLag ).add( follow );

	}

	// Third person: the camera turns toward the aim and hangs back along it from the arm's root, over the shoulder (the
	// other one while a wall it runs along is on that side). The speed zoom draws the arm in and widens the view; the
	// aim zoom lifts the camera over the shoulder and forward; the fall tilt looks further down.
	placeBehind( dt, view, runner, position, cut ) {

		const settings = this.tuning.values;
		const speed = this.speedZoom.value, aim = this.aimZoom.value;

		aimRotation( view.yaw, view.pitch, _aim );
		if ( cut ) this.turn.copy( _aim );
		else this.turn.slerp( _aim, dampFraction( settings.cameraTurnRate, dt ) );

		this.swingOffWall( dt, runner, position, settings.cameraShoulder, cut );

		const arm = settings.cameraDistance + ( 1 - speed ) * THIRD.restArm;

		_offset.set(
			settings.cameraShoulder * this.shoulder,
			MathUtils.lerp( settings.cameraHeight, THIRD.aimHeight, aim ),
			arm - MathUtils.lerp( settings.cameraForward, THIRD.aimForward, aim )
		).applyQuaternion( this.turn );

		this.camera.position.copy( this.armRoot ).add( _offset );
		this.camera.quaternion.copy( this.turn );
		this.camera.rotateX( - MathUtils.lerp( THIRD.pitch, THIRD.fallingPitch, this.fallTilt.value ) );
		this.fov = settings.fov - ( 1 - speed ) * THIRD.restFov;

	}

	// The shoulder the camera hangs over: on a wall run along a wall on the setting's side it swings over to the
	// other, and back once that wall is no longer beside the runner.
	swingOffWall( dt, runner, position, shoulder, cut ) {

		const side = runner.state === 'wallRunning' ? runner.walls.side : null;
		const right = shoulder >= 0;

		if ( side ) {

			this.offWall = ( side === 'right' ) === right;

		} else if ( this.offWall ) {

			// The camera's right, level, toward the shoulder of the setting.
			const across = new Vector3( 1, 0, 0 ).applyQuaternion( this.turn ).setY( 0 ).normalize().multiplyScalar( right ? 1 : - 1 );
			this.offWall = Boolean( this.queries.ray( position.clone().addScaledVector( UP, THIRD.wallUp ), across, Math.abs( shoulder ) + THIRD.wallMargin, 'camera' ) );

		}

		const target = this.offWall ? - 1 : 1;
		this.shoulder = cut ? target : approach( this.shoulder, target, THIRD.shoulderRate, dt );

	}

	// First person: the camera at the eyes, turning toward the aim, or with the head while the view rides it, leaning
	// off the wall on a wall run and standing back off a pipe or a ladder. A trick or a wall kick turns it without
	// lag, or the view would fall behind the spin. It is swept there from the top of the capsule, so it never looks
	// out of a wall the head has gone into.
	placeOnHead( dt, view, runner, position, figure, preferences, cut ) {

		const head = figure.headPose();
		const eyes = new Vector3( ...FIRST.eyes ).applyQuaternion( head.quaternion ).add( head.position );
		const onHead = preferences.headCamera || this.viewOnHead || runner.viewOnHead;
		const target = onHead ? head.quaternion.multiply( ON_HEAD ) : aimRotation( view.yaw, view.pitch, _aim );

		if ( cut || runner.tricking || runner.kickedOffWall ) this.turn.copy( target );
		else this.turn.slerp( target, dampFraction( FIRST.turnRate, dt ) );

		const side = runner.state === 'wallRunning' ? runner.walls.side : null;
		const lean = side === 'right' ? FIRST.wallRunLean : side === 'left' ? - FIRST.wallRunLean : 0;
		this.lean = cut ? lean : approach( this.lean, lean, FIRST.leanRate, dt );

		const back = CLIMBING.has( runner.state ) ? FIRST.climbBack : 0;
		_ahead.set( 0, 0, back - FIRST.forward ).applyQuaternion( this.turn ).add( eyes );
		const top = position.clone().addScaledVector( UP, Math.max( 0, runner.capsule.halfHeight - CAPSULE.radius ) );
		this.camera.position.copy( this.clear( top, _ahead, FIRST.probeRadius, 'camera' ) );
		this.camera.quaternion.copy( this.turn );
		this.camera.rotateZ( this.lean );
		this.fov = this.tuning.values.firstPersonFov;

	}

	/**
	 * How far a sphere of `radius` gets from `from` toward `to` before it touches a solid of the collision `group`.
	 * @returns {Vector3} its centre there, or `to` if nothing is in the way
	 */
	clear( from, to, radius, group ) {

		return this.queries.sphereCast( from, to, radius, { group } )?.centre ?? to.clone();

	}

	bob( dt, runner, falling ) {

		this.bobClock += dt;

		while ( this.bobClock >= BOB_EVERY ) {

			this.bobClock -= BOB_EVERY;
			if ( this.input.held( 'sprint', 'pad' ) && ! falling && runner.velocity.length() > BOB_MIN_SPEED ) this.shakes.start( runner.firstPerson ? 'runBobFirstPerson' : 'runBob' );

		}

	}

}

export { FollowCamera };
