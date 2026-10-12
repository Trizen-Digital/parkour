import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math.js';
import { blendQuaternion } from './PoseSampler.js';

const FORWARD = new Vector3( 0, 0, 1 );
const UP = new Vector3( 0, 1, 0 );

// The reach is kept a hair inside the straight and the fully folded leg, so the triangle of the two bones never
// flattens (or divides by a zero reach) and the knee keeps to its side.
const SLACK = 1e-6;

// The analytic two-bone leg: bends a thigh and shin so the foot reaches a target. The knee goes where the two bone
// lengths meet, on the side of a hint (a point the knee should point toward); the thigh turns to put it there, then
// the shin turns to point the foot at the target. Bone lengths never change, so a target out of reach leaves the leg
// straight and pointing at it. Everything is in the skeleton's space (PoseSampler).
class LegSolver {

	constructor( sampler ) {

		this.sampler = sampler;

	}

	/**
	 * Bends a leg of `pose` (in place) toward `target`.
	 * @param {Array} pose the pose (PoseSampler)
	 * @param {number} foot the foot bone's index; its parent is the shin, the shin's the thigh
	 * @param {Vector3} target where the foot goes
	 * @param {Object} [options]
	 * @param {Vector3} [options.knee] a point the knee bends toward; the knee as it is when not given
	 * @param {Quaternion} [options.rotation] the foot's rotation; without it the foot keeps its turn on the shin
	 * @param {number} [options.weight] how much of the bend to take, 0…1: each bone's rotation is blended toward it
	 */
	solve( pose, foot, target, { knee = null, rotation = null, weight = 1 } = {} ) {

		const sampler = this.sampler, shin = sampler.parents[ foot ], thigh = sampler.parents[ shin ];
		if ( thigh < 0 ) return;

		const before = [ thigh, shin, foot ].map( ( bone ) => pose[ bone ].quaternion.clone() );
		const hip = sampler.global( pose, thigh ), bend = sampler.global( pose, shin ).position, ankle = sampler.global( pose, foot ).position;
		const upper = hip.position.distanceTo( bend ), lower = bend.distanceTo( ankle );

		const toward = target.clone().sub( hip.position );
		const reach = clamp( toward.length(), Math.abs( upper - lower ) + SLACK, upper + lower - SLACK );
		toward.normalize();

		// The knee's side: the hint's direction from the hip, square to the line from the hip to the target. A hint on
		// that line gives none, so then any side square to the line will do.
		const hint = ( knee ?? bend ).clone().sub( hip.position );
		const side = hint.addScaledVector( toward, - hint.dot( toward ) );
		if ( side.lengthSq() < 1e-10 ) side.crossVectors( toward, FORWARD );
		if ( side.lengthSq() < 1e-10 ) side.crossVectors( toward, UP );
		side.normalize();

		// Where the knee goes: along the hip-to-target line, then out to the side, by the triangle of the two bones.
		const along = ( upper * upper + reach * reach - lower * lower ) / ( 2 * reach );
		const out = Math.sqrt( Math.max( 0, upper * upper - along * along ) );
		const kneeAt = hip.position.clone().addScaledVector( toward, along ).addScaledVector( side, out );

		// The thigh turns to put the knee there, then the shin turns to point the ankle at the target.
		const thighTurn = new Quaternion().setFromUnitVectors( bend.clone().sub( hip.position ).normalize(), kneeAt.sub( hip.position ).normalize() );
		sampler.turnTo( pose, thigh, thighTurn.multiply( hip.quaternion ) );

		const shinNow = sampler.global( pose, shin ), ankleNow = sampler.global( pose, foot ).position;
		const shinTurn = new Quaternion().setFromUnitVectors( ankleNow.sub( shinNow.position ).normalize(), target.clone().sub( shinNow.position ).normalize() );
		sampler.turnTo( pose, shin, shinTurn.multiply( shinNow.quaternion ) );

		if ( rotation ) sampler.turnTo( pose, foot, rotation );

		[ thigh, shin, foot ].forEach( ( bone, i ) => blendQuaternion( pose[ bone ].quaternion, before[ i ], pose[ bone ].quaternion, weight ) );

	}

}

export { LegSolver };
