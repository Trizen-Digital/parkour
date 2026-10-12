// Snapshots: a copy of everything a run changes, to put the run back exactly as it was.
//
// A respawn restores the snapshot the simulation took when it loaded; the Easy pilot snapshots the run, tries a press
// ahead and restores it. A snapshot walks the run's objects from its roots (the runner, the motion, the input, the
// figure, …) and keeps a copy of every object, array, map, set and typed array it meets, beside the original. A
// restore writes each copy back into its own original, so every reference between the run's objects still holds.
//
// The walk skips what no run changes: objects marked static (the course, the data tables, the physics engine, the
// page) with everything they hold, three.js scene objects (the snapshot keeps the figure's and the camera's transforms
// itself), frozen tables and engine handles.

const statics = new WeakSet();

// A handle into a physics engine's WebAssembly memory: the engine's own object.
const isEngineHandle = ( value ) => '__wbg_ptr' in value || ( 'ptr' in value && typeof value.free === 'function' );

// Objects whose insides are never the run's: a three.js scene object, an engine handle, the page (anything that
// listens for events).
const isClosed = ( value ) => value.isObject3D || isEngineHandle( value ) || typeof value.addEventListener === 'function';

const isStatic = ( value ) => statics.has( value ) || isClosed( value ) || value.isMaterial || value.isTexture || value.isBufferGeometry || Object.isFrozen( value );

function contentsOf( object ) {

	if ( object instanceof Map ) return [ ...object.keys(), ...object.values() ];
	if ( object instanceof Set || Array.isArray( object ) ) return [ ...object ];
	if ( ArrayBuffer.isView( object ) ) return [];
	return Object.values( object );

}

/**
 * Marks an object no run changes, so snapshots skip it: the course, a data table, the physics engine, the page.
 * @param {object} [object] nothing happens for null or undefined
 * @param {object} [options]
 * @param {boolean} [options.deep] everything the object holds is static too; without it only the object itself is
 *   skipped, and what it points at is copied when a snapshot reaches it another way
 */
function markStatic( object, { deep = true } = {} ) {

	if ( ! object || typeof object !== 'object' ) return;
	if ( ! deep ) return void statics.add( object );

	const stack = [ object ];
	while ( stack.length ) {

		const next = stack.pop();
		if ( statics.has( next ) ) continue;
		statics.add( next );
		if ( isClosed( next ) ) continue;
		for ( const value of contentsOf( next ) ) if ( value && typeof value === 'object' && ! statics.has( value ) ) stack.push( value );

	}

}

/**
 * Where a snapshot starts its walk: everything a run changes is reachable from these, by name.
 * @param {Simulation} sim
 * @returns {Array<[string, object]>}
 */
function snapshotRoots( sim ) {

	return [
		[ 'runner', sim.runner ], [ 'poseInputs', sim.poseInputs ], [ 'motion', sim.motion ], [ 'view', sim.view ],
		[ 'followCamera', sim.followCamera ], [ 'input', sim.input ], [ 'random', sim.random ], [ 'ragdoll', sim.ragdoll ],
		[ 'figure', sim.figure ], [ 'queries', sim.queries ], [ 'mover', sim.mover ], [ 'position', sim.position ],
	];

}

// The simulation's own fields that belong to the run.
const SIMULATION_FIELDS = [ 'accumulator', 'paused', 'steps', 'frameEvents', 'frameSounds', 'mark', 'simDt', 'slowMotionTime', 'slowMotion' ];

/**
 * Copies the run's state.
 * @param {Simulation} sim
 * @returns {object} a snapshot for restoreSnapshot(); `restorable` is false while the ragdoll has the body
 */
function takeSnapshot( sim ) {

	const own = Object.fromEntries( SIMULATION_FIELDS.map( ( key ) => [ key, sim[ key ] ] ) );
	own.frameEvents = sim.frameEvents.slice();
	own.frameSounds = sim.frameSounds.slice();

	const copies = new Map();
	const stack = snapshotRoots( sim ).map( ( [ , root ] ) => root ).filter( Boolean );
	const visit = ( value ) => {

		if ( value && typeof value === 'object' && ! copies.has( value ) && ! isStatic( value ) ) stack.push( value );

	};

	for ( const value of Object.values( own ) ) visit( value );
	while ( stack.length ) {

		const object = stack.pop();
		if ( copies.has( object ) ) continue;
		let copy;
		if ( Array.isArray( object ) ) {

			copy = object.slice();
			copy.forEach( visit );

		} else if ( object instanceof Map ) {

			copy = [ ...object.entries() ];
			for ( const [ key, value ] of copy ) {

				visit( key );
				visit( value );

			}

		} else if ( object instanceof Set ) {

			copy = [ ...object ];
			copy.forEach( visit );

		} else if ( ArrayBuffer.isView( object ) ) {

			copy = object.slice();

		} else {

			copy = {};
			for ( const key of Object.keys( object ) ) {

				copy[ key ] = object[ key ];
				visit( object[ key ] );

			}

		}

		copies.set( object, copy );

	}

	const camera = sim.camera, figure = [];
	sim.figure.root.traverse( ( node ) => figure.push( [ node, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.visible, node.rotation.toArray() ] ) );

	return {
		copies,
		own,
		camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect, userData: { ...camera.userData } },
		figure,
		restorable: ! sim.ragdoll?.active,
	};

}

/**
 * Puts the run back as it was when the snapshot was taken.
 * @param {Simulation} sim
 * @param {object} snapshot from takeSnapshot() on the same simulation
 */
function restoreSnapshot( sim, snapshot ) {

	// The ragdoll's bodies live in its physics world, which no snapshot holds: a snapshot taken while the ragdoll has the
	// body cannot be restored. One taken without found that world as made, and a ragdoll's stop makes it so again, so
	// a ragdoll that has the body now is stopped before the run is put back.
	if ( ! snapshot.restorable ) throw new Error( 'a snapshot taken while the ragdoll has the body can\'t be restored' );
	sim.ragdoll?.stop();

	for ( const [ object, copy ] of snapshot.copies ) {

		if ( Array.isArray( object ) ) {

			object.length = 0;
			for ( const value of copy ) object.push( value );

		} else if ( object instanceof Map ) {

			object.clear();
			for ( const [ key, value ] of copy ) object.set( key, value );

		} else if ( object instanceof Set ) {

			object.clear();
			for ( const value of copy ) object.add( value );

		} else if ( ArrayBuffer.isView( object ) ) {

			object.set( copy );

		} else {

			for ( const key of Object.keys( object ) ) if ( ! ( key in copy ) ) delete object[ key ];
			Object.assign( object, copy );

		}

	}

	Object.assign( sim, snapshot.own, { frameEvents: snapshot.own.frameEvents.slice(), frameSounds: snapshot.own.frameSounds.slice() } );

	const camera = sim.camera, saved = snapshot.camera;
	camera.position.fromArray( saved.position );
	camera.quaternion.fromArray( saved.quaternion );
	camera.fov = saved.fov;
	camera.aspect = saved.aspect;
	Object.assign( camera.userData, saved.userData );
	camera.updateProjectionMatrix();

	// Euler angles go back without their change callback, so the quaternion beside them stays as saved.
	for ( const [ node, position, quaternion, scale, visible, rotation ] of snapshot.figure ) {

		node.position.fromArray( position );
		node.quaternion.fromArray( quaternion );
		[ node.rotation._x, node.rotation._y, node.rotation._z, node.rotation._order ] = rotation;
		node.scale.fromArray( scale );
		node.visible = visible;

	}

}

export { markStatic, snapshotRoots, takeSnapshot, restoreSnapshot };
