import { Group, Quaternion, Vector3 } from 'three/webgpu';

// The timing-only figure: where the runner's body is, with no skeleton. The simulation never reads a pose (only the
// first-person camera reads the head, and the ragdoll the bones), so a run with this figure must step exactly as a
// run with the Y Bot: the headless checks and Easy mode's look-ahead run with it. The Y Bot (YBotFigure) builds on it.
//
// `root` follows the runner (its capsule's centre, heading and slide tilt); `body` hangs below it where the feet meet
// the floor, and holds the model.
//
// A frame draws the figure between its last two steps, as the simulation draws the runner (drawBetween): in slow motion
// a step lasts several frames, and a pose held that long jerks. The first-person camera rides the head as drawn; what
// the run reads of the body (the ragdoll's start) is always a step's pose: the simulation puts the last step's back
// (showStep) before the next frame's steps.

// How far below the capsule's centre the body stands: on its feet, and sliding (the slide lowers the capsule).
const BODY_DROP = - 0.92;
const BODY_DROP_SLIDING = - 0.32;

// The stand-in's eyes, above the capsule's centre.
const EYES_UP = new Vector3( 0, 0.75, 0 );

const LEVEL = { pitch: 0, roll: 0 };

// What a step keeps of each node drawn between steps: its position (3), rotation (4) and scale (3).
const KEPT = 10;

const _from = new Quaternion(), _to = new Quaternion();

class Figure {

	constructor() {

		this.root = new Group();
		this.root.name = 'figure';
		this.body = new Group();
		this.body.position.y = BODY_DROP;
		this.root.add( this.body );

		// What a figure with a body has: its model, the bones by role, and the ragdoll's description of them.
		this.model = null;
		this.roles = {};
		this.ragdoll = null;

		// The nodes as the last step left them and as the step before did (KEPT numbers each, in drawnNodes()' order),
		// null until a step is kept; and whether the nodes show a frame's in-between pose rather than the last step's.
		// Part of the run's state, so a snapshot put back draws as it did.
		this.stepped = null;
		this.before = null;
		this.between = false;

	}

	/** Loads what the figure needs to be posed (the stand-in needs nothing). */
	async load() {

		return this;

	}

	/** The course's queries, for figures that reach for the ground. */
	setQueries() {}

	/**
	 * Places the figure for a simulation step: at `position` (the capsule's centre) turned to `yaw`, tilted with
	 * the slide, posed from the motion's `recipe`.
	 */
	step( dt, recipe, position, yaw, { tilt = LEVEL, sliding = false } = {} ) {

		this.root.position.copy( position );
		// The heading first, then the slide's pitch and roll about the turned axes.
		this.root.rotation.set( tilt.pitch, yaw, tilt.roll, 'YXZ' );
		this.body.position.y = sliding ? BODY_DROP_SLIDING : BODY_DROP;

	}

	/** Forgets what the body carried over from before a respawn. */
	resetBody() {}

	/**
	 * The nodes drawn between steps besides the root's turn: the body below the root (a rigged figure adds its bones).
	 * The root's place is the simulation's, which draws the runner between steps itself.
	 * @returns {Object3D[]}
	 */
	drawnNodes() {

		return [ this.body ];

	}

	/** Keeps the pose a step (the runner's or the ragdoll's) has left, to draw the next frames from. */
	keepStep() {

		const nodes = this.drawnNodes(), size = 4 + nodes.length * KEPT;
		if ( this.stepped?.length !== size ) {

			// The first step kept (or the figure's nodes changed): nothing before it to draw from.
			this.stepped = keep( this.root, nodes, new Float64Array( size ) );
			this.before = this.stepped.slice();
			return;

		}

		[ this.before, this.stepped ] = [ this.stepped, this.before ];
		keep( this.root, nodes, this.stepped );

	}

	/** Puts the last step's pose back after a frame drew between steps, before the run reads the body again. */
	showStep() {

		if ( ! this.between ) return;
		this.between = false;
		show( this.root, this.drawnNodes(), this.stepped, this.stepped, 1 );

	}

	/**
	 * Draws the figure `alpha` of the way from the step before the last to the last (1: the last step's pose).
	 * @param {number} alpha
	 */
	drawBetween( alpha ) {

		if ( ! this.stepped || alpha >= 1 ) return;
		this.between = true;
		show( this.root, this.drawnNodes(), this.before, this.stepped, alpha );

	}

	/** Where the eyes are and which way the head faces, for the first-person camera. */
	headPose( position = new Vector3(), quaternion = new Quaternion() ) {

		position.copy( this.root.position ).add( EYES_UP );
		quaternion.copy( this.root.quaternion );
		return { position, quaternion };

	}

}

// The root's turn, then each node's transform, into `into`.
function keep( root, nodes, into ) {

	root.quaternion.toArray( into, 0 );
	nodes.forEach( ( node, i ) => {

		const at = 4 + i * KEPT;
		node.position.toArray( into, at );
		node.quaternion.toArray( into, at + 3 );
		node.scale.toArray( into, at + 7 );

	} );

	return into;

}

// The root's turn and each node's transform `alpha` of the way from `a` to `b`.
function show( root, nodes, a, b, alpha ) {

	root.quaternion.slerpQuaternions( _from.fromArray( a, 0 ), _to.fromArray( b, 0 ), alpha );
	nodes.forEach( ( node, i ) => {

		const at = 4 + i * KEPT;
		for ( let k = 0; k < 3; k ++ ) {

			node.position.setComponent( k, a[ at + k ] + ( b[ at + k ] - a[ at + k ] ) * alpha );
			node.scale.setComponent( k, a[ at + 7 + k ] + ( b[ at + 7 + k ] - a[ at + 7 + k ] ) * alpha );

		}

		node.quaternion.slerpQuaternions( _from.fromArray( a, at + 3 ), _to.fromArray( b, at + 3 ), alpha );

	} );

}

export { BODY_DROP, Figure };
