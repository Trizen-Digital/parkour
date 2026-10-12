import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math.js';
import { blendQuaternion } from './PoseSampler.js';

const UP = new Vector3( 0, 1, 0 );
const X = new Vector3( 1, 0, 0 );
const Z = new Vector3( 0, 0, 1 );

// The arm's bend is found this many times over: four bring the hand's point within a few millimetres of its place.
const PASSES = 4;

// The hands holding on, for the pose alone, as the pose inputs' grip says (PoseInputs.grip):
//
//  - a line (a bar, a pole, a pipe, a cable): the fist closes round it, at the point of the line nearest the hand, and
//    on a line across the body at least `spread` (m) out along it from the chest on the hand's own side, so the hands
//    hold it a shoulder's width apart and the arms never cross;
//  - a rim (a valve's wheel): the same, on the wheel's rim;
//  - a point (a button): the knuckles of the hand the grip names go to it;
//  - a plant (the top of what the runner vaults): the palm lies flat on the top where the hand comes down onto it, and
//    stays there until the take lifts the hand clear or carries it off (quickly in and out: a plant is brief).
//
// Each hand goes as the take has it until it comes near: how much it is put on the thing grows as the take's hand
// comes within `near` (m) of it, from nothing at `far`, so a reach and a let go keep the take's timing. A firm grip
// (a pole, a pipe, a cable, a bar once the body hangs from it, a valve's wheel) holds whatever the take does with the
// hands. The arm bends
// to the place (LegSolver: the shoulder, elbow and wrist are a two-bone limb like a leg), the elbow kept out from the
// body, a little down and back; the wrist eases straight and the fingers curl round what they hold. Each hand's weight
// eases in and out, so no hand snaps on or off. The plants and the hands' weights carry from step to step: they are
// part of the run's state (the snapshot copies them).
//
// Each hand's grip points are in the hand's own frame, found from the skeleton's rest: the knuckles (the middle
// finger's first joint), the palm's side (square to the plane of the wrist and the knuckles, toward the thumb), the
// fist's centre (most of the way to the knuckles, out from the palm by what is held), the palm's middle.

class HandGrips {

	/**
	 * @param {PoseSampler} sampler the skeleton the poses are of
	 * @param {LegSolver} legs bends the arms too
	 * @param {Object} settings the figure's `grips` settings (ybot.json)
	 */
	constructor( sampler, legs, settings ) {

		this.sampler = sampler;
		this.legs = legs;
		this.settings = settings;
		this.hips = sampler.role( 'hips' );
		this.chest = sampler.role( 'chest' );
		this.hands = [ 'left', 'right' ].map( ( side ) => this.handOf( sampler.role( side + 'Hand' ), side ) );
		// The course's queries, for whether a hand is over the top it plants on.
		this.queries = null;
		this.reset();

	}

	// A hand's bones and grip points (see the module's comment), its fingers' joints with the axis each curls about
	// (in the joint's own frame: the turn that brings the finger toward the palm's side), and which way is out from
	// the body (+1 where the skeleton's x is, -1 the other way).
	handOf( hand, side ) {

		const sampler = this.sampler, rest = sampler.rest;
		const children = ( parent ) => sampler.bones.map( ( _, index ) => index ).filter( ( index ) => sampler.parents[ index ] === parent );
		const named = ( pattern ) => children( hand ).find( ( index ) => pattern.test( sampler.bones[ index ].name ) );
		const chain = ( first ) => {

			const out = [ first ];
			while ( out.length < 3 && children( out.at( - 1 ) ).length ) out.push( children( out.at( - 1 ) )[ 0 ] );
			return out;

		};

		const wrist = sampler.global( rest, hand );
		const local = ( index ) => sampler.global( rest, index ).position.sub( wrist.position ).applyQuaternion( wrist.quaternion.clone().invert() );
		const knuckles = local( named( /Middle1$/ ) );
		const palm = new Vector3().crossVectors( local( named( /Index1$/ ) ), local( named( /Pinky1$/ ) ) ).normalize();
		const thumb = chain( named( /Thumb1$/ ) );
		if ( local( thumb.at( - 1 ) ).dot( palm ) < 0 ) palm.negate();

		const curling = ( bones ) => bones.map( ( bone ) => {

			const joint = sampler.global( rest, bone );
			const next = children( bone )[ 0 ];
			// Bones point along their own y.
			const along = next === undefined ? UP.clone().applyQuaternion( joint.quaternion ) : sampler.global( rest, next ).position.sub( joint.position ).normalize();
			const axis = new Vector3().crossVectors( along, palm.clone().applyQuaternion( wrist.quaternion ) ).normalize();
			return { bone, axis: axis.applyQuaternion( joint.quaternion.clone().invert() ) };

		} );

		return {
			side,
			hand,
			out: Math.sign( wrist.position.x ) || 1,
			knuckles,
			palm,
			fingers: children( hand ).filter( ( index ) => index !== thumb[ 0 ] ).flatMap( ( first ) => curling( chain( first ) ) ),
			thumb: curling( thumb )
		};

	}

	/** Lets go: no hand holds anything. */
	reset() {

		// Each hand: how much of its hold shows (eased, 0…1), where it was last put (skeleton space, held while it
		// eases out), and where a plant holds it (the world, or null).
		this.holds = this.hands.map( () => ( { weight: 0, target: null, planted: null } ) );

	}

	/** The hand bones that hold something now. */
	holding() {

		return new Set( this.hands.filter( ( _, i ) => this.holds[ i ].weight > 0 ).map( ( hand ) => hand.hand ) );

	}

	/**
	 * Puts the hands of `pose` (in place) onto what the grip holds.
	 * @param {Array} pose
	 * @param {Object|null} grip PoseInputs.grip
	 * @param {number} dt
	 */
	apply( pose, grip, dt ) {

		const settings = this.settings, sampler = this.sampler;
		// The chest and the body's left (the skeleton's x, turned with the hips), in the world.
		const body = {
			chest: sampler.toWorld( sampler.global( pose, this.chest ).position ),
			left: sampler.toWorld( X.clone().applyQuaternion( sampler.global( pose, this.hips ).quaternion ) ).sub( sampler.toWorld( new Vector3() ) ).normalize()
		};

		this.hands.forEach( ( hand, i ) => {

			const hold = this.holds[ i ];
			const kind = grip?.kind ? settings.kinds[ grip.kind ] : null;
			const point = kind ? this.pointOf( hand, kind, grip ) : null;
			const at = point ? this.at( pose, hand, point ) : null;
			const found = at ? this.target( hand, hold, grip, sampler.toWorld( at ), body ) : null;

			// How far the take's hand is from the place sets how much it is put there, unless the grip is firm (or the
			// hand is planted).
			const firm = grip?.firm || hold.planted;
			const reach = ! found ? 0 : firm ? 1 : 1 - clamp( ( found.distanceTo( sampler.toWorld( at ) ) - kind.near ) / ( kind.far - kind.near ), 0, 1 );
			const goal = reach * ( grip?.weight ?? 0 );
			hold.weight = clamp( goal, hold.weight - ( kind?.rateOut ?? settings.rateOut ) * dt, hold.weight + ( kind?.rateIn ?? settings.rateIn ) * dt );
			if ( found ) hold.target = { at: sampler.fromWorld( found ), point, kind: grip.kind };
			if ( hold.weight <= 0 ) hold.target = null;

			if ( ! hold.target ) return;

			const weight = smooth( hold.weight );
			this.reach( pose, hand, hold.target, weight );

		} );

	}

	// The hand's point that goes onto the thing, in the hand's frame: the fist's centre, the palm's middle or the
	// knuckles.
	pointOf( hand, kind, grip ) {

		const point = hand.knuckles.clone().multiplyScalar( kind.along );
		return point.addScaledVector( hand.palm, kind.palm + ( kind.round ? grip.radius ?? 0 : 0 ) );

	}

	// A point in a hand's frame, in the skeleton's space, as the pose has the hand.
	at( pose, hand, point ) {

		const wrist = this.sampler.global( pose, hand.hand );
		return point.clone().applyQuaternion( wrist.quaternion ).add( wrist.position );

	}

	// Where the hand's point goes, in the world, or null when this hand holds nothing.
	target( hand, hold, grip, animated, body ) {

		const settings = this.settings;

		if ( grip.kind !== 'plant' ) hold.planted = null;

		if ( grip.kind === 'line' ) {

			const along = grip.b.clone().sub( grip.a ), length = along.length();
			along.divideScalar( length || 1 );
			let distance = animated.clone().sub( grip.a ).dot( along );

			// Across the body: no nearer the chest than the spread, on the hand's own side.
			const side = along.dot( body.left ) * hand.out;
			if ( Math.abs( side ) > settings.across ) {

				const chest = body.chest.clone().sub( grip.a ).dot( along ), out = Math.sign( side );
				distance = chest + out * Math.max( out * ( distance - chest ), settings.spread );

			}

			return grip.a.clone().addScaledVector( along, clamp( distance, settings.lineEnds, length - settings.lineEnds ) );

		}

		if ( grip.kind === 'rim' ) {

			const flat = animated.clone().sub( grip.centre );
			flat.addScaledVector( grip.normal, - flat.dot( grip.normal ) );
			if ( flat.lengthSq() < 1e-8 ) flat.copy( UP );
			return grip.centre.clone().addScaledVector( flat.normalize(), grip.rim );

		}

		if ( grip.kind === 'point' ) return grip.hand === hand.side ? grip.at.clone().addScaledVector( grip.normal, settings.press ) : null;

		if ( grip.kind === 'plant' ) {

			// Down onto the top: held where it came down, until the take lifts it clear or carries it off.
			const plant = settings.kinds.plant;
			if ( hold.planted && ( animated.y > grip.top + plant.lift || animated.distanceTo( hold.planted ) > plant.reach ) ) hold.planted = null;
			else if ( ! hold.planted && animated.y < grip.top + plant.down && this.over( animated, grip.top ) ) hold.planted = animated.clone().setY( grip.top );
			return hold.planted?.clone() ?? null;

		}

		return null;

	}

	// The top is under this point (within a plant's `down` of the top's height).
	over( point, top ) {

		if ( ! this.queries ) return false;
		const down = this.settings.kinds.plant.down;
		const hit = this.queries.ray( point.clone().setY( top + down ), UP.clone().negate(), 2 * down );
		return Boolean( hit ) && Math.abs( hit.point.y - top ) < down;

	}

	// The arm bent to put the hand's point at the target (skeleton space), `weight` of the way: the wrist eased
	// straight first, the elbow out from the body, then the bend found PASSES times (the point turns with the hand as
	// the arm turns, so each pass starts from where the last left it), and the fingers curled round what they hold.
	reach( pose, hand, { at, point, kind }, weight ) {

		const sampler = this.sampler, settings = this.settings, kindSettings = settings.kinds[ kind ];
		const forearm = sampler.parents[ hand.hand ], arm = sampler.parents[ forearm ];
		const before = [ arm, forearm, hand.hand ].map( ( bone ) => pose[ bone ].quaternion.clone() );

		blendQuaternion( pose[ hand.hand ].quaternion, pose[ hand.hand ].quaternion, sampler.rest[ hand.hand ].quaternion, kindSettings.straighten );

		// The elbow out, back and down from where the take has it (a plant's own way: back and up, pushing down).
		const hips = sampler.global( pose, this.hips ).quaternion, out = kindSettings.elbow ?? settings.elbow;
		const elbow = sampler.global( pose, forearm ).position
			.addScaledVector( X.clone().applyQuaternion( hips ), hand.out * out.out )
			.addScaledVector( Z.clone().applyQuaternion( hips ), - out.back )
			.addScaledVector( UP, - out.down );

		for ( let pass = 0; pass < PASSES; pass ++ ) {

			const wrist = sampler.global( pose, hand.hand );
			const offset = point.clone().applyQuaternion( wrist.quaternion );
			this.legs.solve( pose, hand.hand, at.clone().sub( offset ), { knee: elbow } );

		}

		[ arm, forearm, hand.hand ].forEach( ( bone, i ) => blendQuaternion( pose[ bone ].quaternion, before[ i ], pose[ bone ].quaternion, weight ) );

		if ( ! kindSettings.curl ) return;

		const turn = new Quaternion();
		for ( const { bone, axis } of hand.fingers ) pose[ bone ].quaternion.multiply( turn.setFromAxisAngle( axis, kindSettings.curl * weight ) );
		for ( const { bone, axis } of hand.thumb ) pose[ bone ].quaternion.multiply( turn.setFromAxisAngle( axis, kindSettings.thumb * weight ) );

	}

}

// Eases a weight in and out (smoothstep), so a hand settles onto its hold and lifts off it gently.
function smooth( weight ) {

	return weight * weight * ( 3 - 2 * weight );

}

export { HandGrips };
