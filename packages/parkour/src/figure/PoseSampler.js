import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math.js';

// Turns the motion's recipe for a step (graph/recipes.js) into a pose of a skeleton and puts it on the bones.
//
// A pose is one transform per bone, `{ position, quaternion, scale }`, in its parent bone's space, listed in the
// order of `bones` (a parent always before its children). Poses come from a pool that is handed out again every
// step, so a pose is only good until the next `beginStep()`. The graph shares nodes, so the same recipe object can
// sit in the tree more than once: each one is evaluated once per step.

// The take whose first frame is the standing pose (the `rest` recipe).
const STANDING_TAKE = 'ground_idle';

const IDENTITY = new Quaternion();
const ZERO = new Vector3();
const ONE = new Vector3( 1, 1, 1 );
const KEY_A = new Quaternion();
const KEY_B = new Quaternion();

// The normalised blend of two rotations, taking the shorter way round (b's sign flipped when it faces away from a).
// Cheaper than a slerp, and close to it for the small steps between keys and between blended poses.
function blendQuaternion( target, a, b, weight ) {

	const sign = a.dot( b ) < 0 ? - 1 : 1;

	return target.set(
		a.x * ( 1 - weight ) + b.x * weight * sign,
		a.y * ( 1 - weight ) + b.y * weight * sign,
		a.z * ( 1 - weight ) + b.z * weight * sign,
		a.w * ( 1 - weight ) + b.w * weight * sign
	).normalize();

}

function transform() {

	return { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3() };

}

function copyTransform( target, source ) {

	target.position.copy( source.position );
	target.quaternion.copy( source.quaternion );
	target.scale.copy( source.scale );
	return target;

}

class PoseSampler {

	/**
	 * @param {Object3D} model the figure's model; its bones are the skeleton
	 * @param {Map<string, AnimationClip>} clips every take's clip, by take name
	 * @param {TakeLibrary|null} library how each take plays (root motion, a held root, an additive take's base);
	 *   without it the sampler gives only the model's own pose
	 * @param {Object<string, string>} roles bone names by the role they play (`hips`, `leftFoot`, …)
	 */
	constructor( model, clips, library, roles ) {

		this.model = model;
		this.clips = clips;
		this.library = library;
		this.roles = roles;

		this.bones = [];
		model.traverse( ( object ) => object.isBone && this.bones.push( object ) );
		this.index = new Map( this.bones.map( ( bone, index ) => [ bone.name, index ] ) );
		this.parents = this.bones.map( ( bone ) => this.bones.indexOf( bone.parent ) );
		this.rest = this.bones.map( ( bone ) => ( { position: bone.position.clone(), quaternion: bone.quaternion.clone().normalize(), scale: bone.scale.clone() } ) );

		// The skeleton's space: what the bones' transforms are relative to (the top bone's parent, which moves with
		// the figure). Leg targets and the ground under the feet are in the world, so they pass through it.
		this.space = this.bones[ 0 ].parent;

		// The solvers the `legIK` and `feet` recipes use (a LegSolver and a FootPlacement), given by the figure.
		this.legs = null;
		this.feet = null;

		this.pool = [];
		this.tracksByTake = new Map();
		this.beginStep();

		// The `rest` recipe's pose: the standing pose when there are takes, else the model's own.
		this.standing = library && clips.has( STANDING_TAKE ) ? this.sample( STANDING_TAKE, 0 ).map( ( bone ) => copyTransform( transform(), bone ) ) : this.rest;

	}

	/** The index of the bone that plays a role. */
	role( name ) {

		return this.index.get( this.roles[ name ] );

	}

	/**
	 * A new step, `dt` long: the pool is handed out again, every recipe is evaluated afresh, and the skeleton's place
	 * in the world (where the figure has just been put) is read again for the legs and feet that reach into it.
	 */
	beginStep( dt = 0 ) {

		this.space.updateWorldMatrix( true, false );
		this.dt = dt;
		this.cursor = 0;
		// Poses by recipe, as they are and as differences.
		this.evaluated = [ new Map(), new Map() ];

	}

	/**
	 * A recipe's pose. `additive` asks for the pose as a difference from its take's base (the `add` recipe's second
	 * half): positions to add, rotations to put before the base's, scales to multiply by.
	 */
	evaluate( recipe, additive = false ) {

		if ( ! recipe ) return this.allocate( this.rest, additive );

		const evaluated = this.evaluated[ additive ? 1 : 0 ];
		if ( evaluated.has( recipe ) ) return evaluated.get( recipe );

		let pose;

		switch ( recipe.kind ) {

			case 'rest':
				pose = this.allocate( this.standing, additive );
				break;

			case 'clip':
				pose = this.sample( recipe.take, recipe.time, additive, recipe.rootMotion );
				break;

			case 'mix':
				pose = this.mix( this.evaluate( recipe.a, additive ), this.evaluate( recipe.b, additive ), recipe.weight );
				break;

			case 'blend':
				pose = this.blend( recipe.samples.filter( ( sample ) => sample.weight > 0 ).map( ( sample ) => ( { pose: this.evaluate( sample.recipe, additive ), weight: sample.weight } ) ), additive );
				break;

			case 'add':
				pose = this.add( this.evaluate( recipe.base, additive ), this.evaluate( recipe.add, true ), recipe.weight );
				break;

			case 'mask':
				pose = this.masked( this.evaluate( recipe.base, additive ), this.evaluate( recipe.over, additive ), recipe.weight, recipe.mask );
				break;

			case 'legIK':
				pose = this.allocate( this.evaluate( recipe.source, additive ) );
				if ( recipe.weight > 0 ) this.legs.solve( pose, this.role( recipe.foot ), this.fromWorld( recipe.target ), { knee: recipe.knee, weight: recipe.weight } );
				break;

			case 'feet':
				pose = this.allocate( this.evaluate( recipe.source, additive ) );
				this.feet.place( pose, recipe.weight, this.dt );
				break;

			default:
				throw new Error( 'Unknown pose recipe: ' + recipe.kind );

		}

		evaluated.set( recipe, pose );
		return pose;

	}

	/** Puts a pose on the model's bones. */
	apply( pose ) {

		for ( let index = 0; index < this.bones.length; index ++ ) copyTransform( this.bones[ index ], pose[ index ] );

	}

	/** A bone's transform in the skeleton's space (its parents' transforms composed down to it). */
	global( pose, index, into = transform() ) {

		const chain = [];
		for ( let bone = index; bone >= 0; bone = this.parents[ bone ] ) chain.push( bone );

		copyTransform( into, pose[ chain.pop() ] );
		while ( chain.length ) {

			const local = pose[ chain.pop() ];
			into.position.copy( local.position.clone().multiply( into.scale ).applyQuaternion( into.quaternion ).add( into.position ) );
			into.quaternion.multiply( local.quaternion );
			into.scale.multiply( local.scale );

		}

		return into;

	}

	/** Gives a bone the rotation `rotation` in the skeleton's space, keeping its parents as they are. */
	turnTo( pose, index, rotation ) {

		const parent = this.parents[ index ];
		pose[ index ].quaternion.copy( parent >= 0 ? this.global( pose, parent ).quaternion.invert().multiply( rotation ) : rotation ).normalize();

	}

	/** A point in the world, in the skeleton's space (as of the space's last world matrix update). */
	fromWorld( point ) {

		return point.clone().applyMatrix4( this.space.matrixWorld.clone().invert() );

	}

	/** A point in the skeleton's space, in the world. */
	toWorld( point ) {

		return point.clone().applyMatrix4( this.space.matrixWorld );

	}

	// A pose from the pool, starting as a copy of `source` (or as no change at all, for an additive pose).
	allocate( source = this.rest, additive = false ) {

		const pose = ( this.pool[ this.cursor ++ ] ||= this.rest.map( transform ) );

		for ( let index = 0; index < pose.length; index ++ ) {

			if ( additive ) {

				pose[ index ].position.copy( ZERO );
				pose[ index ].quaternion.copy( IDENTITY );
				pose[ index ].scale.copy( ONE );

			} else {

				copyTransform( pose[ index ], source[ index ] );

			}

		}

		return pose;

	}

	// A take's tracks, each with the bone it moves and what it moves (position, quaternion or scale); tracks for
	// bones the skeleton does not have are left out.
	tracks( take ) {

		if ( ! this.tracksByTake.has( take ) ) {

			const tracks = [];

			for ( const track of this.clips.get( take )?.tracks ?? [] ) {

				const dot = track.name.lastIndexOf( '.' );
				const bone = this.index.get( track.name.slice( 0, dot ) );
				if ( bone !== undefined ) tracks.push( { bone, property: track.name.slice( dot + 1 ), times: track.times, values: track.values } );

			}

			this.tracksByTake.set( take, tracks );

		}

		return this.tracksByTake.get( take );

	}

	// A take at a time. An additive take is taken as what it adds over its base take's first frame. A take that
	// carries the root's travel (root motion) keeps its root bone still while it plays as a move, since the runner
	// moves the body instead; a pinned take always keeps it still.
	sample( take, time, additive = false, rootMotion = false ) {

		const clip = this.clips.get( take ), plays = this.library.takes.get( take ) ?? {};
		const pose = this.allocate();
		time = clamp( time, 0, clip?.duration || 1 );

		for ( const track of this.tracks( take ) ) sampleTrack( track, time, pose[ track.bone ][ track.property ] );

		if ( additive && plays.additive ) {

			const base = this.sample( plays.additive, 0 );

			for ( let index = 0; index < pose.length; index ++ ) {

				pose[ index ].position.sub( base[ index ].position );
				pose[ index ].quaternion.multiply( base[ index ].quaternion.clone().invert() ).normalize();
				pose[ index ].scale.divide( base[ index ].scale );

			}

		}

		const root = this.role( 'root' );

		if ( root !== undefined && ( ( rootMotion && plays.root ) || plays.pinned ) ) {

			// Held at the take's first frame, or at the skeleton's rest.
			if ( plays.pinAt === 'firstFrame' ) {

				for ( const track of this.tracks( take ) ) if ( track.bone === root ) sampleTrack( track, 0, pose[ root ][ track.property ] );

			} else {

				copyTransform( pose[ root ], this.rest[ root ] );

			}

		}

		return pose;

	}

	// Two poses blended: b's share is `weight`.
	mix( a, b, weight ) {

		const pose = this.allocate( a );

		for ( let index = 0; index < pose.length; index ++ ) {

			pose[ index ].position.lerp( b[ index ].position, weight );
			blendQuaternion( pose[ index ].quaternion, a[ index ].quaternion, b[ index ].quaternion, weight );
			pose[ index ].scale.lerp( b[ index ].scale, weight );

		}

		return pose;

	}

	// Several poses blended by their weights (they sum to one). Each rotation joins the running sum the shorter way round.
	blend( samples, additive ) {

		const pose = this.allocate( this.rest, additive );
		if ( ! samples.length ) return pose;

		for ( let index = 0; index < pose.length; index ++ ) {

			const output = pose[ index ], sum = output.quaternion;
			output.position.set( 0, 0, 0 );
			output.scale.set( 0, 0, 0 );
			sum.set( 0, 0, 0, 0 );

			for ( const { pose: sample, weight } of samples ) {

				const q = sample[ index ].quaternion, signed = sum.dot( q ) < 0 ? - weight : weight;
				output.position.addScaledVector( sample[ index ].position, weight );
				output.scale.addScaledVector( sample[ index ].scale, weight );
				sum.set( sum.x + q.x * signed, sum.y + q.y * signed, sum.z + q.z * signed, sum.w + q.w * signed );

			}

			sum.normalize();

		}

		return pose;

	}

	// A pose laid on a base by `weight` on part of the body only: `upper`, the spine and every bone below it in the
	// skeleton (the arms, the head); the hips and the legs stay the base's.
	masked( base, over, weight, mask ) {

		const pose = this.allocate( base ), bones = this.maskBones( mask );

		for ( const index of bones ) {

			pose[ index ].position.lerp( over[ index ].position, weight );
			blendQuaternion( pose[ index ].quaternion, base[ index ].quaternion, over[ index ].quaternion, weight );
			pose[ index ].scale.lerp( over[ index ].scale, weight );

		}

		return pose;

	}

	// The bones a mask covers, found once.
	maskBones( mask ) {

		this.masks ??= new Map();
		if ( ! this.masks.has( mask ) ) {

			const spine = this.role( 'spine' ), bones = [];
			for ( let index = 0; index < this.bones.length; index ++ ) {

				for ( let bone = index; bone >= 0; bone = this.parents[ bone ] ) if ( bone === spine ) {

					bones.push( index );
					break;

				}

			}

			this.masks.set( mask, bones );

		}

		return this.masks.get( mask );

	}

	// An additive pose laid on a base by `weight`.
	add( base, difference, weight ) {

		const pose = this.allocate( base ), turn = new Quaternion();

		for ( let index = 0; index < pose.length; index ++ ) {

			pose[ index ].position.addScaledVector( difference[ index ].position, weight );
			pose[ index ].quaternion.premultiply( blendQuaternion( turn, IDENTITY, difference[ index ].quaternion, weight ) ).normalize();
			pose[ index ].scale.multiply( ONE.clone().lerp( difference[ index ].scale, weight ) );

		}

		return pose;

	}

}

// A track at a time: between the two keys around it, positions and scales linearly and rotations by their blend.
function sampleTrack( { times, values }, time, target ) {

	// The last key at or before the time.
	let key = 0, high = times.length - 1;

	while ( key < high ) {

		const middle = ( key + high + 1 ) >>> 1;
		if ( times[ middle ] <= time ) key = middle;
		else high = middle - 1;

	}

	const next = Math.min( key + 1, times.length - 1 );
	const weight = next === key ? 0 : clamp( ( time - times[ key ] ) / ( times[ next ] - times[ key ] ), 0, 1 );

	if ( target.isQuaternion ) {

		return blendQuaternion( target, KEY_A.fromArray( values, key * 4 ), KEY_B.fromArray( values, next * 4 ), weight );

	}

	return target.set(
		values[ key * 3 ] * ( 1 - weight ) + values[ next * 3 ] * weight,
		values[ key * 3 + 1 ] * ( 1 - weight ) + values[ next * 3 + 1 ] * weight,
		values[ key * 3 + 2 ] * ( 1 - weight ) + values[ next * 3 + 2 ] * weight
	);

}

export { PoseSampler, blendQuaternion };
