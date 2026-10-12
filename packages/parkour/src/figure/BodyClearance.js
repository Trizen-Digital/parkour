import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math.js';

const UP = new Vector3( 0, 1, 0 );

// Keeps the body out of the course, for the pose alone: a light after-correction the takes never see. The body is a
// few capsules along its bones (the trunk, the thighs, the shins, the forearms) and a ball for the head, each asked how
// far it is inside a solid and which way is out (the physics engine's penetration query, one per part).
//
//  1. The trunk, the thighs and the shins move the whole body: the hips go out by the most any of them is in, along
//     each axis (so a knee in the top of what is vaulted lifts the body over it, a shoulder in a wall moves it off).
//  2. Then a leg or an arm that goes into a solid from the body's side swings out to that side (LegSolver), its foot or
//     hand put just clear of the face it went in by (found by a ray from the hip or shoulder down the limb), the limb's
//     reach kept: an arm thrown into a thin wall comes along it, not out through its far side. A hand that holds
//     something (HandGrips) stays on its hold, only its elbow swinging out; hands on a ledge are left to the ledge.
//  3. Then the head, still in, leans the neck away (ducking back from a bar slid under).
//
// On the ground the body stands or slides on, nothing is lifted off it: contacts facing up count only off the ground.
// Over the top of what is vaulted (the hands plant on it), a part in a solid goes straight up, as far as it takes for
// its lowest point to clear the top: the shortest way out of a thin wall is often through its side, and parts pushed
// out of either side would cancel.
//
// Each push eases toward what the parts ask, quickly as it grows and gently as it lets go (so nothing snaps in or out),
// and is capped (so a part deep in a solid, where the take goes through a wall, is only nudged). The pushes carry from
// step to step: they are part of the run's state (the snapshot copies them).

class BodyClearance {

	/**
	 * @param {PoseSampler} sampler the skeleton the poses are of
	 * @param {LegSolver} legs bends the legs and the arms
	 * @param {Object} settings the figure's `clearance` settings (ybot.json)
	 */
	constructor( sampler, legs, settings ) {

		this.sampler = sampler;
		this.legs = legs;
		this.settings = settings;
		this.hips = sampler.role( 'hips' );
		const bone = ( name ) => sampler.index.get( name );
		this.parts = Object.freeze( settings.parts.map( ( part ) => Object.freeze( { ...part, from: bone( part.from ), to: bone( part.to ), limb: part.limb ? bone( part.limb ) : null } ) ) );
		this.neck = sampler.parents[ this.parts.find( ( part ) => part.head ).from ];
		// The course's queries (given before the first step).
		this.queries = null;
		this.reset();

	}

	/** Forgets the pushes: the body as the takes have it. */
	reset() {

		// The whole body's push, each limb's (by its part's name) and the head's, in the world (m).
		this.body = new Vector3();
		this.limbs = Object.fromEntries( this.parts.filter( ( part ) => part.limb !== null ).map( ( part ) => [ part.name, new Vector3() ] ) );
		this.head = new Vector3();

	}

	/**
	 * Moves the whole body of `pose` (in place) out of the solids.
	 * @param {Array} pose
	 * @param {{ onGround?: boolean, grip?: Object }} options the grip a vault's top comes from (PoseInputs.grip)
	 * @param {number} dt
	 */
	moveBody( pose, { onGround = false, grip = null } = {}, dt ) {

		if ( ! this.queries ) return;

		const top = topOf( grip );
		const most = new Vector3(), least = new Vector3();
		for ( const part of this.parts ) {

			if ( ! part.core ) continue;
			const push = this.pushOf( pose, part, onGround, top );
			most.max( push );
			least.min( push );

		}

		this.ease( this.body, most.add( least ), this.settings.bodyMost, dt );
		if ( this.body.lengthSq() < 1e-10 ) return;

		// The hips are moved in their parent's space.
		const sampler = this.sampler, hips = pose[ this.hips ];
		const parent = sampler.global( pose, sampler.parents[ this.hips ] );
		const move = this.toSkeleton( this.body, sampler.toWorld( parent.position ) );
		hips.position.add( move.applyQuaternion( parent.quaternion.invert() ).divide( parent.scale ) );

	}

	/**
	 * Bends the limbs and leans the head of `pose` (in place) out of the solids, after the body has moved.
	 * @param {Array} pose
	 * @param {{ onGround?: boolean, grip?: Object, handsOnLedge?: boolean }} options as for moveBody(), and whether
	 *   the hands are on a ledge
	 * @param {number} dt
	 * @param {Set<number>} held the hand bones that hold something (kept on their hold)
	 */
	bendLimbs( pose, { onGround = false, grip = null, handsOnLedge = false } = {}, dt, held ) {

		if ( ! this.queries ) return;

		const sampler = this.sampler, settings = this.settings, top = topOf( grip );

		for ( const part of this.parts ) {

			if ( part.limb === null ) continue;
			const push = this.limbs[ part.name ];
			const left = part.arm && handsOnLedge;
			this.ease( push, left ? new Vector3() : top !== null ? this.pushOf( pose, part, onGround, top ) : this.swingOf( pose, part, onGround ), settings.limbMost, dt );
			if ( push.lengthSq() < 1e-10 ) continue;

			// The end moves out, and the knee or elbow with it so the limb bends away rather than about it; a hand that
			// holds stays put and its elbow alone swings out.
			const end = sampler.global( pose, part.limb ).position, joint = sampler.global( pose, part.from ).position;
			const move = this.toSkeleton( push, sampler.toWorld( end ) );
			this.legs.solve( pose, part.limb, held.has( part.limb ) ? end : end.add( move ), { knee: joint.add( move ) } );

		}

		const head = this.parts.find( ( part ) => part.head );
		this.ease( this.head, this.pushOf( pose, head, onGround ), settings.headMost, dt );
		if ( this.head.lengthSq() < 1e-10 ) return;

		// The neck turns to carry the head out by its push (as far as the lean allows).
		const neck = sampler.global( pose, this.neck );
		const centre = sampler.global( pose, head.from ).position.lerp( sampler.global( pose, head.to ).position, 0.5 );
		const arm = centre.clone().sub( neck.position );
		const moved = arm.clone().add( this.toSkeleton( this.head, sampler.toWorld( centre ) ) ).setLength( arm.length() );
		const turn = new Quaternion().setFromUnitVectors( arm.normalize(), moved.normalize() );
		const angle = 2 * Math.acos( clamp( turn.w, - 1, 1 ) );
		if ( angle > settings.leanMost ) turn.slerp( new Quaternion(), 1 - settings.leanMost / angle );
		sampler.turnTo( pose, this.neck, turn.multiply( neck.quaternion ) );

	}

	// How far, and which way, a part must go to be out of the solids (the world, m): the way out of the deepest one it
	// is in, by how deep, with a skin of room (over a vault's top, straight up till its lowest point clears the top);
	// nothing when it is clear, or only touching the ground it is on.
	pushOf( pose, part, onGround, top = null ) {

		const sampler = this.sampler, settings = this.settings;
		const a = sampler.toWorld( sampler.global( pose, part.from ).position );
		const b = sampler.toWorld( sampler.global( pose, part.to ).position );
		const along = b.clone().sub( a ), length = along.length();
		const radius = part.radius + settings.skin;
		const rotation = new Quaternion().setFromUnitVectors( UP, length > 1e-6 ? along.divideScalar( length ) : UP );
		const contact = this.queries.penetration( { kind: 'capsule', radius, halfHeight: length / 2 + radius }, a.clone().lerp( b, 0.5 ), { group: 'probe', rotation } );

		if ( ! contact || contact.depth <= 0 ) return new Vector3();
		if ( onGround && contact.normal.y > settings.ground ) return new Vector3();
		if ( top !== null ) return new Vector3( 0, Math.max( 0, top + radius - Math.min( a.y, b.y ) ), 0 );
		return contact.normal.clone().normalize().multiplyScalar( contact.depth );

	}

	// How far a limb's end must go to swing it out of a solid it goes into from the body's side (the world, m): the
	// first face a ray meets from the limb's root (hip or shoulder) to its end, or to its knee or elbow; the end put
	// just clear of that face, the limb turned about its root in the plane of its reach and the face's normal, its
	// reach kept. Nothing when the limb is clear, or only touches the ground it stands on.
	swingOf( pose, part, onGround ) {

		const sampler = this.sampler, settings = this.settings;
		const at = ( bone ) => sampler.toWorld( sampler.global( pose, bone ).position );
		const root = at( sampler.parents[ part.from ] ), joint = at( part.from ), end = at( part.limb );
		const face = this.faceOn( root, end, onGround ) ?? this.faceOn( root, joint, onGround );
		if ( ! face ) return new Vector3();

		const normal = face.normal.clone().normalize(), reach = end.clone().sub( root ), length = reach.length();
		const clear = part.radius + settings.skin, height = root.clone().sub( face.point ).dot( normal );
		const wanted = clamp( clear - height, - length, length );
		if ( reach.dot( normal ) >= wanted ) return new Vector3();

		// Along the face: the reach with its part into the face taken out (down the face when it pointed straight in).
		const along = reach.clone().addScaledVector( normal, - reach.dot( normal ) );
		if ( along.lengthSq() < 1e-8 ) along.copy( UP ).negate().addScaledVector( normal, normal.y );
		along.normalize().multiplyScalar( Math.sqrt( length * length - wanted * wanted ) );
		return root.add( along ).addScaledVector( normal, wanted ).sub( end );

	}

	// The first face of a solid a ray meets from `from` to `to`, or null (none, one it starts inside, or the ground the
	// body is on).
	faceOn( from, to, onGround ) {

		const way = to.clone().sub( from ), distance = way.length();
		if ( distance < 1e-6 ) return null;
		const hit = this.queries.ray( from, way, distance );
		if ( ! hit || hit.distance <= 1e-6 ) return null;
		if ( onGround && hit.normal.y > this.settings.ground ) return null;
		return hit;

	}

	// Eases a push toward what is asked, at most `most` long: quickly while it grows (the body gets out before it shows
	// in), gently as it lets go.
	ease( push, target, most, dt ) {

		if ( target.length() > most ) target.setLength( most );
		const rate = target.lengthSq() > push.lengthSq() ? this.settings.rateIn : this.settings.rateOut;
		push.lerp( target, clamp( rate * dt, 0, 1 ) );
		if ( push.lengthSq() < 1e-10 ) push.set( 0, 0, 0 );

	}

	// A move in the world, at a place in the world, as a move in the skeleton's space.
	toSkeleton( move, at ) {

		return this.sampler.fromWorld( at.clone().add( move ) ).sub( this.sampler.fromWorld( at ) );

	}

}

// The height of the top a vault's hands plant on (m), or null.
function topOf( grip ) {

	return grip?.kind === 'plant' && grip.weight > 0 ? grip.top : null;

}

export { BodyClearance };
