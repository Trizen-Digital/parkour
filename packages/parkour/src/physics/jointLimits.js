import { Quaternion, Vector2, Vector3 } from 'three';
import { clamp } from '../math.js';

// A ragdoll joint's limits and pose motor, worked as angular impulses on its two bodies before each world step.
//
// The engine's joint only holds two bodies together at their anchors (a hinge also keeps them turning about one axis,
// within its limits). How far a joint may twist and bend, how hard it resists going further, and the pull towards a
// pose that keeps a falling body from going slack are ours: springs on the joint's angles, solved for the step from
// the two bodies' inertia and applied as equal and opposite angular impulses. They read only what every engine's
// Body gives (its rotation, angular velocity and world inverse inertia, and an angular impulse), so a ragdoll holds
// together the same way on any engine.
//
// A joint's angles are measured between its two frames (the description's `frame` in the body, `parentFrame` in the
// parent): the body's frame as turned from the parent's, split into a twist about the bone (the frames' X) and a
// swing, whose parts about the frames' Y and Z are the two bends. Each of the three is either limited (to an angle
// either way) or locked.

/** The three ways a joint turns, in the order its description gives their limits. */
const AXES = [ 'twist', 'bendY', 'bendZ' ];

/** A joint's axis that does not turn at all. */
const LOCKED = 'locked';

const X = new Vector3( 1, 0, 0 );
const Y = new Vector3( 0, 1, 0 );
const Z = new Vector3( 0, 0, 1 );

/** Each axis in its joint frame: the twist is about the bone, the bends across it. */
const AXIS = { twist: X, bendY: Y, bendZ: Z };

// The same, in the order of AXES.
const AXIS_VECTORS = AXES.map( ( axis ) => AXIS[ axis ] );

/**
 * Splits a rotation into a twist about X and the swing that follows it (rotation = swing · twist), the swing's w kept
 * positive so it is the shorter way round.
 *
 * @param {Quaternion} rotation
 * @return {{ twist: Quaternion, swing: Quaternion }}
 */
function twistAndBend( rotation ) {

	const twist = new Quaternion( rotation.x, 0, 0, rotation.w ).normalize();
	const swing = rotation.clone().multiply( twist.clone().invert() ).normalize();

	if ( swing.w < 0 ) swing.set( - swing.x, - swing.y, - swing.z, - swing.w );

	return { twist, swing };

}

/**
 * The point of an ellipse centred on the origin nearest to a point outside it: Newton's method on the distance's
 * one-parameter form (x = r² p / ( t + r² ) per axis), from a start that never overshoots.
 *
 * @param {Vector2} point
 * @param {Vector2} radii
 * @return {Vector2}
 */
function nearestOnEllipse( point, radii ) {

	const absolute = point.clone().set( Math.abs( point.x ), Math.abs( point.y ) );

	// On the long axis the answer is its end (Newton's start would divide by zero there).
	if ( radii.x >= radii.y && absolute.y < 1e-6 ) return new Vector2( point.x > 0 ? radii.x : - radii.x, 0 );
	if ( radii.x < radii.y && absolute.x < 1e-6 ) return new Vector2( 0, point.y > 0 ? radii.y : - radii.y );

	const squared = radii.clone().multiply( radii );
	const product = radii.clone().multiply( absolute );
	let t = Math.max( product.x - squared.x, product.y - squared.y );
	const inverse = new Vector2();

	for ( let iteration = 0; iteration < 20; iteration ++ ) {

		inverse.set( 1 / ( t + squared.x ), 1 / ( t + squared.y ) );

		const scaled = product.clone().multiply( inverse );
		const values = scaled.multiply( scaled );
		const error = values.x + values.y - 1;

		if ( error < 1e-4 ) return squared.clone().multiply( point ).multiply( inverse );
		t += error / ( 2 * values.dot( inverse ) );

	}

	// Not converged: the last estimate, put back onto the ellipse.
	const result = squared.multiply( point ).multiply( inverse );

	return result.divideScalar( result.clone().divide( radii ).length() );

}

/**
 * How far a swing has gone outside the cone its two bend limits allow, and about which axis it must turn back (in the
 * parent's joint frame). Equal limits make a round cone, measured by the swing's whole angle. Otherwise the cone is
 * an ellipse in the plane of the two bend angles (each a quarter-angle tangent scaled up, which stays close to the
 * true angle and keeps the cone smooth); the swing is taken back to the nearest point of that ellipse, and the error
 * is the angle between where the bone points and that edge of the cone, measured across the cone's surface.
 *
 * @param {Quaternion} swing
 * @param {number} limitY The bend about Y allowed either way (rad).
 * @param {number} limitZ The bend about Z allowed either way (rad).
 * @return {{ axis: Vector3, angle: number }} `angle` 0 inside the cone.
 */
function coneError( swing, limitY, limitZ ) {

	if ( Math.abs( limitY - limitZ ) < 1e-3 ) {

		const angle = 2 * Math.acos( clamp( swing.w, - 1, 1 ) );
		const axis = new Vector3( swing.x, swing.y, swing.z ).normalize();

		return { axis, angle: Math.max( 0, angle - limitY ) };

	}

	const angles = new Vector2( 4 * Math.atan2( swing.y, 1 + swing.w ), 4 * Math.atan2( swing.z, 1 + swing.w ) );
	const limits = new Vector2( limitY, limitZ );

	if ( angles.clone().divide( limits ).lengthSq() <= 1 ) return { axis: Y.clone(), angle: 0 };

	// The nearest edge of the cone, and the way out of it there (the ellipse's outward normal, unnormalised).
	const edge = nearestOnEllipse( angles, limits );
	const outward = edge.clone().divide( limits.clone().multiply( limits ) );

	// The edge as a swing, q (the tangent of its quarter angle about each axis), and the way out, n, in the same terms.
	const q = new Vector3( 0, Math.tan( edge.x / 4 ), Math.tan( edge.y / 4 ) );
	const n = new Vector3( 0, outward.x, outward.y );
	const r2 = q.lengthSq(),
		a = 1 - r2,
		b = 1 / ( 1 + r2 );
	const qn = q.dot( n );

	// Where the bone (X) points with the edge's swing, s · d − X, and how s and d change as the swing moves out along
	// n: the normal of the cone's surface at the edge.
	const s = 2 * a * b * b;
	const d = new Vector3( a, 2 * q.z, - 2 * q.y );
	const ds = - 4 * qn * ( 3 - r2 ) * b * b * b;
	const dd = new Vector3( - 2 * qn, 2 * n.z, - 2 * n.y );
	const bone = d.clone().multiplyScalar( s ).sub( X );
	const normal = dd.multiplyScalar( s ).addScaledVector( d, ds ).normalize();

	// Turning back about bone × normal; by how far the bone actually points out past the surface.
	const axis = new Vector3().crossVectors( bone, normal );
	const angle = - new Vector3().crossVectors( bone, axis ).dot( X.clone().applyQuaternion( swing ) );

	return { axis, angle };

}

// The inverse of a body's angular mass about a unit axis (world space): axisᵀ · I⁻¹ · axis.
function inverseAngularMass( body, axis ) {

	const [ m11, m12, m13, m22, m23, m33 ] = body.inverseInertiaWorld();

	return (
		axis.x * ( m11 * axis.x + m12 * axis.y + m13 * axis.z ) +
		axis.y * ( m12 * axis.x + m22 * axis.y + m23 * axis.z ) +
		axis.z * ( m13 * axis.x + m23 * axis.y + m33 * axis.z )
	);

}

/**
 * One joint of a ragdoll: its limits and motor on the two bodies it joins.
 */
class JointLimits {

	/**
	 * @param {Object} joint The joint's description: `frame` and `parentFrame` ([ x, y, z, w ]), `twist`, `bendY` and
	 *   `bendZ` (an angle either way, or 'locked'), and `motor` (the pose it pulls to, the body's frame as turned from
	 *   the parent's, [ x, y, z, w ]; left out: the two frames lined up; false: no pull).
	 * @param {Body} body The bone's body.
	 * @param {Body} parent The parent bone's body.
	 * @param {{ stiffness: number, damping: number }} limitSpring How hard the joint pushes back past a limit (an
	 *   angular acceleration per radian, 1/s²) and how much it damps the turning there (1/s).
	 */
	constructor( joint, body, parent, limitSpring ) {

		this.joint = joint;
		this.body = body;
		this.parent = parent;
		this.frame = new Quaternion().fromArray( joint.frame );
		this.parentFrame = new Quaternion().fromArray( joint.parentFrame );
		this.limits = AXES.map( ( axis ) => joint[ axis ] );
		this.limitSpring = limitSpring;
		this.motor = joint.motor === false ? null : new Quaternion().fromArray( joint.motor ?? [ 0, 0, 0, 1 ] );

	}

	/**
	 * The joint as it stands: both joint frames in the world, the body's swing from the parent's, and its angles (the
	 * twist, then the bends about Y and Z, rad).
	 *
	 * @return {{ parent: Quaternion, body: Quaternion, swing: Quaternion, angles: number[] }}
	 */
	measure() {

		const parent = this.parent.rotation().multiply( this.parentFrame );
		const body = this.body.rotation().multiply( this.frame );
		const relative = parent.clone().invert().multiply( body );

		if ( relative.w < 0 ) relative.set( - relative.x, - relative.y, - relative.z, - relative.w );

		const { twist, swing } = twistAndBend( relative );

		// Each bend is 4 · atan2( its part of the swing, 1 + w ): the swing's whole angle for a bend about that axis alone.
		const angles = [ 2 * Math.atan2( twist.x, twist.w ), 4 * Math.atan2( swing.y, 1 + swing.w ), 4 * Math.atan2( swing.z, 1 + swing.w ) ];

		return { parent, body, swing, angles };

	}

	/**
	 * Turns the two bodies back within the joint's limits and towards the motor's pose, for a step of `dt`.
	 *
	 * @param {number} dt s
	 * @param {number} motorStiffness The motor's pull (1/s²).
	 * @param {number} limitScale Scales every limit's stiffness (the tuning's).
	 */
	step( dt, motorStiffness, limitScale ) {

		const { parent, body, swing, angles } = this.measure();
		const [ , bendY, bendZ ] = this.limits;
		const { stiffness, damping } = this.limitSpring;

		// Two limited bends share one elliptical cone, so the bone sweeps a smooth edge instead of a box's corners.
		const cone = bendY !== LOCKED && bendZ !== LOCKED;

		for ( let index = 0; index < 3; index ++ ) {

			if ( index > 0 && cone ) continue;

			const limit = this.limits[ index ];
			const locked = limit === LOCKED;
			const bound = locked ? 0 : limit;
			const error = angles[ index ] - clamp( angles[ index ], - bound, bound );

			// The twist turns about the bone's own axis, a bend about the parent's.
			const axis = AXIS_VECTORS[ index ].clone().applyQuaternion( index === 0 ? body : parent );

			// A locked axis pulls back as hard as the solve allows: at a stiffness of 1/dt² the pair turns back about
			// half the error each step, so it settles within a few steps without overshooting.
			this.spring( axis, error, dt, ( locked ? 1 / ( dt * dt ) : stiffness ) * limitScale, damping );

		}

		if ( cone ) {

			const outside = coneError( swing, bendY, bendZ );

			if ( outside.angle > 0 ) this.spring( outside.axis.applyQuaternion( parent ), outside.angle, dt, stiffness * limitScale, damping );

		}

		if ( ! this.motor ) return;

		// The motor pulls each axis that turns towards the motor's pose: the twist by the remaining turn's x (twice the
		// half angle's sine), the bends by where the bone's axis points off the target's.
		const offTarget = parent.clone().multiply( this.motor ).invert().multiply( body );

		if ( offTarget.w < 0 ) offTarget.set( - offTarget.x, - offTarget.y, - offTarget.z, - offTarget.w );

		const pointing = X.clone().applyQuaternion( offTarget );
		const errors = [ 2 * offTarget.x, - pointing.z, pointing.y ];

		for ( let index = 0; index < 3; index ++ ) {

			if ( this.limits[ index ] !== LOCKED ) this.spring( AXIS_VECTORS[ index ].clone().applyQuaternion( body ), errors[ index ], dt, motorStiffness, 0 );

		}

	}

	// Equal and opposite angular impulses about `axis` that act as a spring and a damper on the angle `error`. The
	// spring is solved implicitly for the step, so even a stiffness of 1/dt² settles instead of overshooting, and is
	// scaled by the pair's angular mass about the axis, so the stiffness means the same on a hand as on the chest.
	spring( axis, error, dt, stiffness, damping ) {

		if ( Math.abs( error ) < 1e-6 || axis.lengthSq() < 1e-10 ) return;

		const inverseMass = inverseAngularMass( this.body, axis ) + inverseAngularMass( this.parent, axis );

		if ( inverseMass < 1e-10 ) return;

		const turning = this.body.angularVelocity().sub( this.parent.angularVelocity() ).dot( axis );
		const mass = 1 / inverseMass;
		const springTerm = mass * stiffness * dt * dt;
		const damperTerm = mass * damping * dt;
		const lambda = ( springTerm * error + damperTerm * turning * dt ) / ( 1 + ( springTerm + damperTerm ) * inverseMass );
		const impulse = axis.clone().multiplyScalar( lambda / dt );

		this.body.applyAngularImpulse( impulse.clone().negate() );
		this.parent.applyAngularImpulse( impulse );

	}

}

export { AXES, AXIS, LOCKED, twistAndBend, nearestOnEllipse, coneError, JointLimits };
