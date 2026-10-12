import { Bone, DoubleSide, Quaternion, SkinnedMesh, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Figure } from './Figure.js';
import { PoseSampler } from './PoseSampler.js';
import { LegSolver } from './LegSolver.js';
import { FootPlacement } from './FootPlacement.js';
import { HandGrips } from './HandGrips.js';
import { BodyClearance } from './BodyClearance.js';
import { loadClips } from './clips.js';

// A rigged figure: a skinned model the player sees, described by a rig (the model's URL, which bones play which role,
// the head's bones, and the settings of the feet, the grips and the clearance) and posed from the motion's takes. The
// demo's Y Bot is one (its rig is the demo's ybot.json). Each step it poses its skeleton from the motion's recipe (the
// takes' clips, blended, with its legs reaching for ledges and its feet put on the ground), then corrects the pose: the
// body moved out of the course (BodyClearance), the hands put on what they hold (HandGrips), then the limbs and the head
// moved out of what they are still in. It tells the first-person camera where its eyes are. The head's triangles are
// split into meshes of their own, so first person can hide them.
//
// What it was made with is kept in private fields: a snapshot walks the figure's own fields, and none of it changes
// in a run.
class RiggedFigure extends Figure {

	#rig;
	#name;
	#eyes;
	#headTurn;
	#ragdoll;
	// The body and the bones, drawn between steps (drawnNodes).
	#drawn;

	/**
	 * @param {object} options
	 * @param {object} options.rig the rig description: `model`, `roles`, `head`, `feet`, `grips`, `clearance`, and
	 *   optionally `eyes` (the eyes in the head's frame, [ x, y, z ] in metres; x ahead of the face, y up) and `headTurn`
	 *   (turns about up from the model's head bone at the bind pose to that frame)
	 * @param {object} [options.ragdoll] the ragdoll description the ragdoll is built from when the runner goes limp
	 * @param {string} [options.takes] where the takes' clips are, as a URL
	 * @param {string} [options.name] what the loading message calls the figure
	 */
	constructor( { rig, ragdoll = null, takes = './data/takes/', name = 'the figure' } ) {

		super();
		this.#rig = rig;
		this.#name = name;
		// The Y Bot's head frame is its head bone turned three quarters of a turn about up, which brings x round to where
		// it faces (+z), with its eyes 7 cm ahead of the head bone and 9 cm above it: the defaults.
		this.#headTurn = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), ( rig.headTurn ?? 0.75 ) * 2 * Math.PI );
		this.#eyes = new Vector3( ...( rig.eyes ?? [ 0.07, 0.09, 0 ] ) );
		this.takesUrl = takes;
		this.roles = rig.roles;
		this.#ragdoll = ragdoll;
		this.headMeshes = [];
		this.sampler = null;
		this.legs = null;
		this.feet = null;
		this.grips = null;
		this.clearance = null;

	}

	/**
	 * Loads the model and every take's clip. `library` (the motion's takes) says how each take plays; without it the
	 * figure keeps the model's own pose.
	 */
	async load( library, progress = () => {} ) {

		progress( `Loading ${ this.#name }…` );
		const model = ( await new GLTFLoader().loadAsync( this.#rig.model ) ).scene;
		model.traverse( ( object ) => {

			if ( ! object.isMesh ) return;
			object.castShadow = true;
			object.receiveShadow = true;
			// Bones move the skin far from the mesh's bind-pose bounds.
			object.frustumCulled = false;
			for ( const material of [ object.material ].flat() ) material.shadowSide = DoubleSide;

		} );

		// The takes carry a root bone above the hips (the root's travel); the model has none, so it gets one.
		const hips = model.getObjectByName( this.roles.hips );
		const root = new Bone();
		root.name = this.roles.root;
		hips.parent.add( root );
		root.add( hips );

		const skinned = [];
		model.traverse( ( object ) => object.isSkinnedMesh && skinned.push( object ) );
		for ( const mesh of skinned ) {

			const head = splitHead( mesh, this.#rig.head );
			if ( head ) this.headMeshes.push( head );

		}

		this.body.add( model );
		this.model = model;
		this.head = model.getObjectByName( this.roles.head );
		model.updateMatrixWorld( true );
		this.headFrame = this.head.getWorldQuaternion( new Quaternion() ).invert().multiply( this.#headTurn );

		progress( 'Loading the takes…' );
		this.clips = await loadClips( this.takesUrl, library?.takes );
		this.sampler = new PoseSampler( model, this.clips, library, this.roles );
		this.sampler.legs = this.legs = new LegSolver( this.sampler );
		this.sampler.feet = this.feet = new FootPlacement( this.sampler, this.legs, this.#rig.feet );
		this.grips = new HandGrips( this.sampler, this.legs, this.#rig.grips );
		this.clearance = new BodyClearance( this.sampler, this.legs, this.#rig.clearance );

		this.ragdoll = this.#ragdoll;
		return this;

	}

	setQueries( queries ) {

		this.feet.queries = this.grips.queries = this.clearance.queries = queries;

	}

	/**
	 * Poses the figure for a step (Figure.step); `options.grip` says what the hands hold (PoseInputs.grip),
	 * `options.onGround` whether the body stands or slides on the ground, `options.handsOnLedge` whether the hands are on
	 * a ledge.
	 */
	step( dt, recipe, position, yaw, options = {} ) {

		super.step( dt, recipe, position, yaw, options );
		this.sampler.beginStep( dt );

		const pose = this.sampler.evaluate( recipe );
		this.clearance.moveBody( pose, options, dt );
		this.grips.apply( pose, options.grip ?? null, dt );
		this.clearance.bendLimbs( pose, options, dt, this.grips.holding() );
		this.sampler.apply( pose );

		for ( const mesh of this.headMeshes ) mesh.visible = ! options.firstPerson;

	}

	resetBody() {

		this.feet.reset();
		this.grips.reset();
		this.clearance.reset();

	}

	drawnNodes() {

		if ( ! this.sampler ) return super.drawnNodes();
		return this.#drawn ??= [ this.body, ...this.sampler.bones ];

	}

	headPose( position = new Vector3(), quaternion = new Quaternion() ) {

		this.head.getWorldQuaternion( quaternion ).multiply( this.headFrame );
		this.head.getWorldPosition( position ).add( this.#eyes.clone().applyQuaternion( quaternion ) );
		return { position, quaternion };

	}

}

// Moves the triangles of a skinned mesh that the head's bones carry (more than `share` of their weight, at every
// corner) into a mesh of their own on the same skeleton.
function splitHead( mesh, { bones, share } ) {

	const geometry = mesh.geometry, index = geometry.index;
	const joints = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
	const headJoints = new Set( bones.map( ( name ) => mesh.skeleton.bones.findIndex( ( bone ) => bone.name === name ) ).filter( ( i ) => i >= 0 ) );
	const onHead = ( vertex ) => {

		let weight = 0;
		for ( let k = 0; k < 4; k ++ ) if ( headJoints.has( joints.getComponent( vertex, k ) ) ) weight += weights.getComponent( vertex, k );
		return weight > share;

	};

	const body = [], head = [];
	for ( let i = 0; i < index.count; i += 3 ) {

		const triangle = [ index.getX( i ), index.getX( i + 1 ), index.getX( i + 2 ) ];
		( triangle.every( onHead ) ? head : body ).push( ...triangle );

	}

	if ( ! head.length ) return null;
	const headGeometry = geometry.clone();
	headGeometry.setIndex( head );
	geometry.setIndex( body );
	const headMesh = new SkinnedMesh( headGeometry, mesh.material );
	headMesh.name = mesh.name + '_head';
	headMesh.bind( mesh.skeleton, mesh.bindMatrix );
	headMesh.castShadow = mesh.castShadow;
	headMesh.receiveShadow = mesh.receiveShadow;
	headMesh.frustumCulled = false;
	headMesh.position.copy( mesh.position );
	headMesh.quaternion.copy( mesh.quaternion );
	headMesh.scale.copy( mesh.scale );
	mesh.parent.add( headMesh );
	return headMesh;

}

export { RiggedFigure };
