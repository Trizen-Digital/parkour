// What a frame looked like, kept so the QA editor can scrub through it without running the simulation again: every
// node of the figure and the camera, as numbers.
//
// VisualRig reads and writes one frame's look; VisualRing keeps the last seconds of the live game's frames, so a
// capture opens on what was on screen.

// Per object: position (3), quaternion (4), Euler angles (3), scale (3), visible (1).
const STRIDE = 14;

class VisualRig {

	/**
	 * @param {Figure} figure
	 * @param {Camera} camera
	 */
	constructor( figure, camera ) {

		this.figure = figure;
		this.camera = camera;
		this.objects = [];
		figure.root.traverse( ( node ) => this.objects.push( node ) );
		// The figure's nodes, the camera, and the camera's field of view.
		this.size = ( this.objects.length + 1 ) * STRIDE + 1;

	}

	/**
	 * @param {Float64Array} [out]
	 * @returns {Float64Array} the frame's look
	 */
	capture( out = new Float64Array( this.size ) ) {

		let i = 0;
		for ( const object of [ ...this.objects, this.camera ] ) {

			const p = object.position, q = object.quaternion, e = object.rotation, s = object.scale;
			out[ i ] = p.x; out[ i + 1 ] = p.y; out[ i + 2 ] = p.z;
			out[ i + 3 ] = q._x; out[ i + 4 ] = q._y; out[ i + 5 ] = q._z; out[ i + 6 ] = q._w;
			out[ i + 7 ] = e._x; out[ i + 8 ] = e._y; out[ i + 9 ] = e._z;
			out[ i + 10 ] = s.x; out[ i + 11 ] = s.y; out[ i + 12 ] = s.z;
			out[ i + 13 ] = object.visible ? 1 : 0;
			i += STRIDE;

		}

		out[ i ] = this.camera.fov;
		return out;

	}

	/**
	 * Shows a captured look. The quaternions and Euler angles are written without their change callbacks, so both stay
	 * exactly as captured.
	 * @param {Float64Array} look from capture()
	 * @param {object} [options]
	 * @param {Camera|null} [options.camera] the camera to put where the captured one was; null leaves the camera be
	 *   (the editor's orbit)
	 */
	apply( look, { camera = this.camera } = {} ) {

		if ( ! look || look.length !== this.size ) return;
		let i = 0;
		for ( const object of [ ...this.objects, camera ] ) {

			if ( object ) {

				const q = object.quaternion, e = object.rotation;
				object.position.set( look[ i ], look[ i + 1 ], look[ i + 2 ] );
				q._x = look[ i + 3 ]; q._y = look[ i + 4 ]; q._z = look[ i + 5 ]; q._w = look[ i + 6 ];
				e._x = look[ i + 7 ]; e._y = look[ i + 8 ]; e._z = look[ i + 9 ];
				object.scale.set( look[ i + 10 ], look[ i + 11 ], look[ i + 12 ] );
				object.visible = look[ i + 13 ] === 1;

			}

			i += STRIDE;

		}

		if ( camera && camera.fov !== look[ i ] ) {

			camera.fov = look[ i ];
			camera.updateProjectionMatrix();

		}

		this.figure.root.updateMatrixWorld( true );
		camera?.updateMatrixWorld();

	}

}

class VisualRing {

	/**
	 * @param {number} [seconds] how much of the past it keeps
	 */
	constructor( seconds = 22 ) {

		this.seconds = seconds;
		this.rig = null;
		this.frames = [];
		// Looks no longer kept, reused so the game does not allocate one a frame.
		this.pool = [];

	}

	setRig( rig ) {

		this.rig = rig;
		this.clear();

	}

	clear() {

		for ( const frame of this.frames ) this.pool.push( frame.look );
		this.frames.length = 0;

	}

	/**
	 * Keeps the look on screen now.
	 * @param {number} f the frame's number on the tape
	 * @param {number} t its time (s)
	 */
	push( f, t ) {

		if ( ! this.rig ) return;
		let look = this.pool.pop();
		if ( ! look || look.length !== this.rig.size ) look = new Float64Array( this.rig.size );
		this.rig.capture( look );
		this.frames.push( { f, t, look } );
		let stale = 0;
		while ( stale < this.frames.length - 1 && t - this.frames[ stale ].t > this.seconds ) stale ++;
		if ( stale ) for ( const frame of this.frames.splice( 0, stale ) ) this.pool.push( frame.look );

	}

	/**
	 * @param {number} from
	 * @param {number} to
	 * @returns {Map<number, Float64Array>} copies of the looks kept for frames from..to
	 */
	copy( from, to ) {

		const out = new Map();
		for ( const frame of this.frames ) if ( frame.f >= from && frame.f <= to ) out.set( frame.f, frame.look.slice() );
		return out;

	}

}

export { VisualRig, VisualRing };
