import { Matrix3, Quaternion, Vector3 } from 'three';
import { approach, clamp } from '../math.js';
import { CAPSULE } from '../sim/tuning.js';

const UP = new Vector3( 0, 1, 0 );

// Whether the runner stands on ground is asked with a ball swept down from 50 cm above the feet (over the edge of a
// step just come down) until it is centred on them (so it meets an edge under the capsule's rim); what it meets must
// be no more than 2 cm below the feet (a jump's first step has already lifted them 4 cm or more). Where it stands now,
// the ball is 1 mm narrower than the capsule, so a wall the capsule slides along, 0.1 mm off, is not met; where it stood
// the step before, 2 mm wider, so the edge it stood on at its very rim (where the mover's floor box still finds it) is
// met, and the narrower ball asks instead if that one starts in a wall beside it.
const STAND_SKIN = 0.001;
const STOOD_SLACK = 0.002;
const STAND_ABOVE = 0.5;
const STAND_BELOW = 0.02;

// A trail closes at least 0.01 mm a step, so a runner standing still ends with none, not with ever less.
const TRAIL_GONE = 0.00001;

// Puts the feet on the ground while the figure stands (the `feet` recipe), and carries the body smoothly up and down
// the steps the runner's capsule takes at once. The takes stand on a flat floor at the skeleton's origin; on a slope or
// at a step the ground under each foot is somewhere else, so each step:
//
//  1. the body trails a step up or down: the mover lifts the capsule onto a stair, or drops it to the one below, within
//     a single step, and the skeleton's space with it. Such a jolt (the space's height jumping from going level, from
//     ground onto ground) goes into the trail, which keeps the hips where they were in the world; the trail eases back
//     out as the runner goes on (so going up a flight the hips rise along it, as up a ramp) and over time (so they
//     settle when it stops). This holds whatever the recipe's weight: walking, the body is the takes' own, only carried
//     smoothly;
//  2. a ball is swept down past each animated foot to find the ground under it;
//  3. the pelvis eases toward the lower foot's ground (slowly, so a step down does not jolt the body), and each foot
//     eases toward its own ground's height above the pelvis (quickly);
//  4. a foot's goal is its animated place raised by both; on ground flat enough to stand on, the foot turns to lie on
//     it, pointing the way the figure faces;
//  5. the hips move by the pelvis's height and the trail, and further down if a leg could not reach its goal from
//     there, and each leg bends to its goal (LegSolver), the knee keeping its side.
//
// The recipe's weight says how much of 2–5 to take. The pelvis's and the feet's heights carry over from step to step,
// and hold while the weight is zero, as do the trail and where the skeleton's space was: they are part of the run's
// state (the snapshot copies them).
class FootPlacement {

	/**
	 * @param {PoseSampler} sampler the skeleton the poses are of
	 * @param {LegSolver} legs bends the legs
	 * @param {Object} settings the figure's `feet` settings (ybot.json): the probe, the easing rates, how flat ground
	 *   must be to lay a foot on it, per foot its role and its up and toes directions in its own frame, and `steps`:
	 *   the least and the most jolt of the body's height taken as a step up or down (m; more is a jump to somewhere
	 *   else, which the body follows at once), how much height the trail closes per metre the runner goes (`catchUp`),
	 *   and the rate it closes at over time (1/s)
	 *
	 * `queries` (the course's) must be given before the first step.
	 */
	constructor( sampler, legs, settings ) {

		this.sampler = sampler;
		this.legs = legs;
		this.settings = settings;
		this.hips = sampler.role( 'hips' );
		this.sides = [ settings.left, settings.right ].map( ( side ) => ( {
			foot: sampler.role( side.role ),
			aim: new Vector3().fromArray( side.aim ),
			twist: new Vector3().fromArray( side.twist.axis ),
			toward: new Vector3().fromArray( side.twist.toward )
		} ) );
		this.queries = null;
		this.reset();

	}

	/** Forgets the ground: the pelvis and both feet back at the takes' own heights, the body with the capsule. */
	reset() {

		// Heights in the skeleton's space (m): the pelvis's, and each foot's above it.
		this.pelvis = 0;
		this.lift = [ 0, 0 ];

		// Where the skeleton's space was in the world at the last step (null before the first), how fast it was rising
		// leaving out the steps (m/s), and how far the body still trails it, up (+) or down (−), in the world (m).
		this.last = null;
		this.rising = 0;
		this.trail = 0;

	}

	/** Places the feet of `pose` (in place), taking `weight` of the result, the heights eased over `dt`. */
	place( pose, weight, dt ) {

		this.trailSteps( dt );
		if ( weight <= 0 && this.trail === 0 ) return;

		const settings = this.settings, sampler = this.sampler;
		const fromWorld = sampler.space.matrixWorld.clone().invert();
		const trail = UP.clone().multiplyScalar( this.trail ).applyMatrix3( new Matrix3().setFromMatrix4( fromWorld ) );
		const hips = pose[ this.hips ], unmoved = hips.position.clone();
		const parent = sampler.global( pose, sampler.parents[ this.hips ] );
		// A move of the hips in the skeleton's space, in their parent's.
		const inParent = ( move ) => move.applyQuaternion( parent.quaternion.clone().invert() ).divide( parent.scale );

		if ( weight <= 0 ) {

			hips.position.add( inParent( trail ) );
			return;

		}

		const feet = this.sides.map( ( side ) => {

			const animated = sampler.global( pose, side.foot );
			return { side, animated, ground: this.ground( animated.position, fromWorld ) };

		} );

		this.pelvis = approach( this.pelvis, Math.min( feet[ 0 ].ground.height, feet[ 1 ].ground.height ), settings.pelvisRate, dt );
		for ( const [ i, foot ] of feet.entries() ) {

			this.lift[ i ] = approach( this.lift[ i ], foot.ground.height - this.pelvis, settings.footRate, dt );
			foot.goal = foot.animated.position.clone().addScaledVector( UP, this.pelvis + this.lift[ i ] );

		}

		// The hips are moved in their parent's space; the legs are bent for all of the move, then both are taken by
		// the weight, all but the trail, which is the whole body's.
		const raised = UP.clone().multiplyScalar( this.pelvis ).add( trail );
		const height = Math.max( ...feet.map( ( foot ) => this.shortfall( pose, foot.side.foot, foot.goal, raised ) ) );
		hips.position.add( inParent( raised.clone().addScaledVector( UP, - height ) ) );

		for ( const { side, animated, ground, goal } of feet ) {

			const rotation = ground.normal?.y > settings.flatEnough ? this.lyingOn( side, ground.normal ) : animated.quaternion;
			this.legs.solve( pose, side.foot, goal, { rotation, weight } );

		}

		hips.position.lerpVectors( unmoved.add( inParent( trail ) ), hips.position, weight );

	}

	// Follows the skeleton's space up and down (step 1). The space's height this step is what it was plus how fast it
	// was rising, give or take a jolt; a jolt of a step's size, from going (nearly) level, from ground onto ground, is a
	// step the capsule took at once, and goes into the trail. A landing's jolt comes from falling, not from going level,
	// a jump's first step leaves the ground below, and a body the ragdoll had (no step placed it) came down from wherever
	// it bailed, so none is a step; nor is anything further than the most a step can be, which the body follows at once.
	trailSteps( dt ) {

		const steps = this.settings.steps, at = new Vector3().setFromMatrixPosition( this.sampler.space.matrixWorld );
		const last = this.last;
		this.last = at;

		if ( ! last || last.distanceTo( at ) > steps.most ) {

			this.rising = 0;
			this.trail = 0;
			return;

		}

		// The trail closes by the way gone across or over time, whichever closes more, and no further than it is.
		const across = Math.hypot( at.x - last.x, at.z - last.z );
		const closes = Math.max( across * steps.catchUp, Math.abs( this.trail ) * clamp( steps.rate * dt, 0, 1 ), TRAIL_GONE );
		this.trail -= Math.sign( this.trail ) * Math.min( Math.abs( this.trail ), closes );

		// The ground is asked only of a jolt: the wider ball where the runner stood (the narrower if that one starts in a
		// wall), the narrower where it stands.
		const rise = at.y - last.y, jolt = rise - this.rising * dt, narrow = CAPSULE.radius - STAND_SKIN;
		const stood = () => ( this.onGround( last, CAPSULE.radius + STOOD_SLACK ) ?? this.onGround( last, narrow ) ) === true;
		const step = Math.abs( jolt ) >= steps.least && Math.abs( this.rising * dt ) < steps.least &&
			stood() && this.onGround( at, narrow ) === true;
		if ( step ) this.trail = clamp( this.trail - jolt, - steps.most, steps.most );
		this.rising = ( step ? rise - jolt : rise ) / dt;

	}

	// Whether the runner stands on ground with the skeleton's space at `at` (the world): a ball of `radius` swept down
	// onto the feet meets something no lower than just below them. Stepped up, the capsule stands on the step's edge,
	// inside its width; just come down a step, the edge of the one above may be met first, which is ground too. Null
	// when the ball starts inside a solid (a wall beside the runner), which tells nothing.
	onGround( at, radius ) {

		const hit = this.queries.sphereCast( at.clone().addScaledVector( UP, STAND_ABOVE ), at, radius, { group: 'probe' } );

		if ( ! hit ) return false;
		return hit.startedInside ? null : hit.point.y >= at.y - STAND_BELOW;

	}

	// How much further down the hips must go, past `raised` (where the pelvis's height and the trail put them, in the
	// skeleton's space), for the leg to reach its foot's goal at full stretch (0 when it reaches already). While the
	// pelvis eases down to a lower ground, or the body trails a step down, the foot would otherwise hang short of it.
	shortfall( pose, foot, goal, raised ) {

		const sampler = this.sampler, shin = sampler.parents[ foot ], thigh = sampler.parents[ shin ];
		const hip = sampler.global( pose, thigh ).position, knee = sampler.global( pose, shin ).position;
		const reach = hip.distanceTo( knee ) + knee.distanceTo( sampler.global( pose, foot ).position );
		const to = goal.clone().sub( hip ).sub( raised ), across = Math.hypot( to.x, to.z );

		// Out of reach to the side, lowering the hips does not help.
		if ( across >= reach ) return 0;
		return Math.max( 0, - to.y - Math.sqrt( reach * reach - across * across ) );

	}

	// The ground under a foot, in the skeleton's space: its height, and its normal. With nothing there, or with the
	// ball starting inside a solid (the animated foot is in a wall or a block, and the ball learns nothing of the ground
	// under it), the takes' own floor: height 0, no normal.
	ground( foot, fromWorld ) {

		const settings = this.settings, sampler = this.sampler;
		const from = sampler.toWorld( foot.clone().addScaledVector( UP, settings.probeUp ) );
		const to = sampler.toWorld( foot.clone().addScaledVector( UP, - settings.probeDown ) );
		const hit = this.queries.sphereCast( from, to, settings.radius, { group: 'probe' } );

		if ( ! hit || hit.startedInside ) return { height: 0, normal: null };
		return { height: hit.point.clone().applyMatrix4( fromWorld ).y, normal: hit.normal.clone().transformDirection( fromWorld ) };

	}

	// A foot's rotation lying on ground with this normal: the foot's up (`aim`, square to the sole, in the foot's own
	// frame) along the normal, then turned about the normal so its toes (`twist`) point the way the figure faces
	// (`toward`, laid on the ground).
	lyingOn( side, normal ) {

		const rotation = new Quaternion().setFromUnitVectors( side.aim, normal );
		const toward = side.toward.clone().addScaledVector( normal, - normal.dot( side.toward ) ).normalize();
		const toes = side.twist.clone().applyQuaternion( rotation ).normalize();

		// Toes pointing straight back have no shortest turn: half a turn about the normal.
		const turn = toes.dot( toward ) + 1 < 1e-8 ? new Quaternion().setFromAxisAngle( normal, Math.PI ) : new Quaternion().setFromUnitVectors( toes, toward );
		return rotation.premultiply( turn ).normalize();

	}

}

export { FootPlacement };
