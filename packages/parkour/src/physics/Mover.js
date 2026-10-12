import { Quaternion, Vector3 } from 'three';
import { CAPSULE } from '../sim/tuning.js';

// The runner's capsule moved through the course: it slides along walls, steps up onto what is low enough to stand on,
// and finds and keeps to the floor. Everything is asked of the course's queries in the movement group. The capsule's
// tilt (a slide leans it with the ground) comes in with each call.

const UP = new Vector3( 0, 1, 0 );
const DOWN = new Vector3( 0, - 1, 0 );

// The capsule floats 2.15 cm above the floor; the mover puts it back there when it drifts out of 1.9–2.4 cm.
const FLOOR_GAP = 0.0215;
const FLOOR_GAP_MIN = 0.019;
const FLOOR_GAP_MAX = 0.024;

// A capsule more than 0.1 mm into a solid is pushed out, to 1.25 mm clear, at most 8 times over.
const PUSH_DEPTH = 0.0001;
const PUSH_CLEAR = 0.00125;
const PUSHES = 8;

// Every sweep stops at what it hit and then stands 0.1 mm off it along its normal, so the next sweep, along that
// surface, starts clear of it. (Backing off along the move instead would leave a capsule that met a wall at a slant all
// but touching it, and a sweep starting in contact may meet the wall again at once.)
const BACK_OFF = 0.0001;

// A walk slides along at most 8 surfaces in one step.
const SLIDES = 8;

// The floor is found by sweeping a box down inside the capsule, square in its circle (half a side is 0.707 of the
// radius): turned 45° first, then square on if that finds nothing.
const INSCRIBED = 0.707;
const TURNED = new Quaternion().setFromAxisAngle( DOWN, Math.PI / 4 );
const SQUARE = new Quaternion();

// The box starts raised by 10 % of the capsule's straight middle, so it starts clear of a floor the capsule sinks
// into a little. If it still starts inside, or meets the floor at the capsule's rim (within 1.5 mm), a narrower box
// raised by 90 % looks again.
const RAISE = 0.1;
const RAISE_MORE = 0.9;
const RIM = 0.0015;
const NARROWER = 0.001501;

// Stepping down after a step up reaches 4.8 cm further when the runner was on a floor.
const STEP_DOWN_EXTRA = 0.048;

// A step's top may be 0.01 mm over the step height.
const STEP_SLACK = 0.00001;

// A step up carries the capsule at least 2 cm across, the way the move went. What is left of a move when it meets a
// riser can be almost nothing (a slow walk goes under a millimetre a step, and any pace can end a step at the riser),
// and a capsule carried less than 1.5 mm over the tread comes down on its very edge, which is no step: the walk then
// loses its speed into the riser, gains only a fraction of a millimetre a step from there, and never steps up. 2 cm
// is far enough over the tread for the floor box (findFloor) to find the step under the capsule on stairs square to
// the world's axes, or up to about 22° off them.
const STEP_REACH = 0.02;

// A step is at least 1 cm high. Anything the capsule can walk into stands higher than the gap it floats over the floor,
// while a landing on the floor it left comes back to within float error of it.
const STEP_MIN = 0.01;

// A step up over a face this close to vertical (its normal under 0.08 up) must find a floor on top.
const WALL_FACE_Y = 0.08;

// A glide steps up only onto a wall (a normal within about 11.5° of level) while it heads neither steeply down
// (more than 30°) nor steeply up (more than about 11.5°).
const GLIDE_WALL_Y = 0.2;
const GLIDE_MAX_DOWN = 0.5;
const GLIDE_MAX_UP = 0.2;

// A floor this close to flat or vertical is not walked along its slope.
const SLOPE_EDGE = 1e-4;

// A walk that has this little left to go (m²) is done.
const DONE = 1e-12;

// The floor is looked for after a walk only while the runner is not rising faster than 1 cm/s.
const RISING = 0.01;

// How high `point` stands over the floor the capsule was on: over that floor's plane, so a slope's own rise is not a
// step; with no floor, over the capsule's bottom (`base`).
function heightOver( point, floor, base ) {

	if ( ! floor ) return point.y - base;

	const normal = floor.byRay ? floor.normal : floor.faceNormal;

	return ( ( point.x - floor.point.x ) * normal.x + ( point.y - floor.point.y ) * normal.y + ( point.z - floor.point.z ) * normal.z ) / normal.y;

}

// Moves `position` along `motion` up to what it hit, then 0.1 mm off it along its normal, so the next sweep along that
// surface starts clear of it.
function upTo( position, motion, hit ) {

	position.addScaledVector( motion, hit.fraction ).addScaledVector( hit.normal, BACK_OFF );

}

// The surface a slide on foot goes along: a slope too steep to walk is a wall, slid along level, not up it.
function slideNormal( hit, onFoot, walkable ) {

	const normal = hit.normal.clone();

	if ( onFoot && hit.faceNormal.y < walkable && normal.y > 0 ) normal.setY( 0 ).normalize();

	return normal;

}

// The velocity loses what goes into a surface it meets.
function loseInto( velocity, normal ) {

	const into = velocity.dot( normal );

	if ( into < 0 ) velocity.addScaledVector( normal, - into );

}

class Mover {

	/**
	 * @param {import( './Queries.js' ).Queries} queries
	 */
	constructor( queries ) {

		this.queries = queries;

		/** The floor the last walk ended on (null in the air): `findFloor`'s answer. */
		this.floor = null;

	}

	/**
	 * Pushes the capsule out of any solid it is inside.
	 *
	 * @param {Vector3} position Moved in place.
	 * @param {number} halfHeight
	 * @param {Quaternion} [tilt]
	 */
	resolvePenetration( position, halfHeight, tilt ) {

		const shape = { kind: 'capsule', radius: CAPSULE.radius, halfHeight };

		for ( let push = 0; push < PUSHES; push ++ ) {

			const contact = this.queries.penetration( shape, position, { group: 'movement', rotation: tilt } );

			if ( ! contact || contact.depth < PUSH_DEPTH ) break;
			position.addScaledVector( contact.normal, contact.depth + PUSH_CLEAR );

		}

	}

	/**
	 * The walkable floor under the capsule within `reach` below its bottom, or null. `floorDistance` is how far the
	 * capsule's bottom is above it (down to a capsule radius below the floor's top, for a floor it has sunk into).
	 * Found by the sweep (`byRay: false`, with the sweep's hit), or else straight below the centre (`byRay: true`).
	 *
	 * @param {Vector3} position
	 * @param {number} halfHeight
	 * @param {number} reach
	 * @param {number} walkableSlope The steepest walkable floor (rad).
	 * @return {Object|null} The hit, with `floorDistance` and `byRay`.
	 */
	findFloor( position, halfHeight, reach, walkableSlope ) {

		const radius = CAPSULE.radius;
		const walkable = Math.cos( walkableSlope );
		let raise = ( halfHeight - radius ) * RAISE;
		let hit = this.floorSweep( position, reach + raise, radius, halfHeight - raise );

		if ( ! hit ) return null;

		if ( hit.startedInside || Math.hypot( hit.point.x - position.x, hit.point.z - position.z ) >= Math.max( RIM, radius - RIM ) ) {

			const narrower = Math.max( 0, radius - NARROWER );

			raise = ( halfHeight - radius ) * RAISE_MORE;
			hit = this.floorSweep( position, reach + raise, narrower, Math.max( halfHeight - raise, narrower ) );

		}

		if ( hit && ! hit.startedInside && hit.faceNormal.y >= walkable ) {

			const floorDistance = Math.max( - radius, hit.distance - raise );

			if ( floorDistance <= reach ) return { ...hit, floorDistance, byRay: false };

		}

		if ( ! hit ) return null;

		const below = this.queries.ray( position, DOWN, halfHeight + reach, 'movement' );

		if ( below && below.distance > 0 && below.normal.y >= walkable ) {

			const floorDistance = Math.max( - radius, below.distance - halfHeight );

			if ( floorDistance <= reach ) return { ...below, floorDistance, byRay: true };

		}

		return null;

	}

	floorSweep( from, distance, radius, halfHeight ) {

		const to = from.clone().addScaledVector( DOWN, distance );
		const halfExtents = new Vector3( radius * INSCRIBED, halfHeight, radius * INSCRIBED );

		return this.queries.boxCast( from, to, halfExtents, TURNED, { group: 'movement' } ) || this.queries.boxCast( from, to, halfExtents, SQUARE, { group: 'movement' } );

	}

	// The capsule swept by `motion`, passing over what it starts in while moving out of it.
	sweep( from, motion, halfHeight, tilt ) {

		return this.queries.capsuleCast( from, from.clone().add( motion ), CAPSULE.radius, halfHeight, { group: 'movement', stopAtPenetration: false, rotation: tilt } );

	}

	/**
	 * Moves the capsule with no gravity and no floor to keep to (a guided move: a vault, a climb, a wall run): it
	 * slides along what it meets (into a corner, along the crease) and steps up onto a low wall in its way.
	 *
	 * @param {Vector3} position Moved in place.
	 * @param {Vector3} velocity
	 * @param {number} dt
	 * @param {{ stepHeight: number, walkableSlope: number }} limits
	 * @param {number} [halfHeight]
	 * @param {Vector3|null} [displacement] The move, if not `velocity · dt`.
	 * @param {Quaternion} [tilt]
	 * @return {{ grounded: boolean }} Never grounded.
	 */
	glide( position, velocity, dt, limits, halfHeight = CAPSULE.halfHeight, displacement = null, tilt ) {

		this.resolvePenetration( position, halfHeight, tilt );

		const motion = displacement ? displacement.clone() : velocity.clone().multiplyScalar( dt );
		const hit = this.sweep( position, motion, halfHeight, tilt );

		if ( ! hit ) {

			position.add( motion );

			return { grounded: false };

		}

		upTo( position, motion, hit );

		const rest = motion.multiplyScalar( 1 - hit.fraction );
		const down = - velocity.clone().normalize().y;

		if ( Math.abs( hit.normal.y ) < GLIDE_WALL_Y && down < GLIDE_MAX_DOWN && down > - GLIDE_MAX_UP && limits.stepHeight > 0 ) {

			const step = this.stepUp( position, rest, halfHeight, limits, null, null, tilt );

			if ( step ) {

				position.copy( step.position );

				return { grounded: false };

			}

		}

		rest.addScaledVector( hit.normal, - rest.dot( hit.normal ) );

		const second = this.sweep( position, rest, halfHeight, tilt );

		if ( ! second ) {

			position.add( rest );

			return { grounded: false };

		}

		upTo( position, rest, second );
		rest.multiplyScalar( 1 - second.fraction );

		if ( hit.normal.dot( second.normal ) <= 0 ) {

			// Two surfaces facing apart (a corner): only along the crease between them.
			const crease = new Vector3().crossVectors( second.normal, hit.normal ).normalize();

			rest.copy( crease.multiplyScalar( rest.dot( crease ) ) );

		} else {

			rest.addScaledVector( second.normal, - rest.dot( second.normal ) );

		}

		const third = this.sweep( position, rest, halfHeight, tilt );

		if ( third ) upTo( position, rest, third );
		else position.add( rest );

		return { grounded: false };

	}

	/**
	 * Tries to carry the capsule up and onto what it walked into: up by what is left of the step height, across by
	 * the rest of the move, or 2 cm if that is less (sliding along what it meets there), and down onto a floor. Null
	 * when that is not a step: nothing to land on, a landing no higher than the floor it left (the move only went along
	 * a wall, or past what stopped it), too high, not walkable, at the very edge, or blocked.
	 *
	 * @param {Vector3} position
	 * @param {Vector3} displacement What is left of the move.
	 * @param {number} halfHeight
	 * @param {{ stepHeight: number, walkableSlope: number }} limits
	 * @param {Object|null} wall The hit the move stopped at (null from a glide).
	 * @param {Object|null} floor The floor the move started on.
	 * @param {Quaternion} [tilt]
	 * @return {{ position: Vector3, floor: Object|null, slidAlong: Object|null }|null} `slidAlong`: the hit it slid
	 *   along on the way across, if it met one.
	 */
	stepUp( position, displacement, halfHeight, limits, wall = null, floor = null, tilt ) {

		const start = position.clone();
		const radius = CAPSULE.radius;
		const floorDistance = Math.max( 0, floor?.floorDistance || 0 );
		const floorBase = start.y - halfHeight - floorDistance;

		// What stopped the move is above the capsule's straight middle or below its feet: nothing to step onto.
		if ( wall && ( wall.point.y > start.y + halfHeight - radius || wall.point.y <= floorBase ) ) return null;

		const up = UP.clone().multiplyScalar( Math.max( 0, limits.stepHeight - floorDistance ) );
		const upward = this.sweep( start, up, halfHeight, tilt );

		if ( upward?.startedInside ) return null;

		const raised = start.clone();

		if ( upward ) upTo( raised, up, upward );
		else raised.add( up );

		const across = displacement.clone().setY( 0 );

		if ( across.lengthSq() < STEP_REACH * STEP_REACH ) across.setLength( STEP_REACH );

		const ahead = this.sweep( raised, across, halfHeight, tilt );

		if ( ahead?.startedInside ) return null;
		if ( ahead ) upTo( raised, across, ahead );
		else raised.add( across );

		if ( ahead ) {

			const slide = across.clone().multiplyScalar( 1 - ahead.fraction );

			slide.addScaledVector( ahead.normal, - slide.dot( ahead.normal ) );

			const slideHit = this.sweep( raised, slide, halfHeight, tilt );

			if ( ahead.fraction === 0 && ( slideHit?.fraction === 0 || slide.lengthSq() < DONE ) ) return null;
			if ( slideHit?.startedInside ) return null;
			if ( slideHit ) upTo( raised, slide, slideHit );
			else raised.add( slide );

		}

		const down = DOWN.clone().multiplyScalar( limits.stepHeight + ( floor ? STEP_DOWN_EXTRA : 0 ) );
		const landing = this.sweep( raised, down, halfHeight, tilt );

		// A step is something to stand on: with nothing below, the move went past what stopped it, not onto it.
		if ( ! landing || landing.startedInside ) return null;
		raised.addScaledVector( down, landing.fraction );

		const normal = landing.faceNormal;
		const height = heightOver( landing.point, floor, floorBase );

		// Landing back on the floor it left (or level with it) is a slide along what stopped the move, which the
		// caller does itself, losing the speed that went into the wall; only a landing on top of something is a step.
		if ( height < STEP_MIN || height > limits.stepHeight + STEP_SLACK ) return null;
		if ( normal.y < Math.cos( limits.walkableSlope ) && ( across.dot( normal ) < 0 || raised.y > start.y ) ) return null;
		if ( Math.hypot( landing.point.x - raised.x, landing.point.z - raised.z ) >= radius - RIM ) return null;

		const top = this.findFloor( raised, halfHeight, limits.stepHeight + FLOOR_GAP_MAX, limits.walkableSlope );

		if ( ! top && raised.y > start.y && wall?.faceNormal.y < WALL_FACE_Y ) return null;
		if ( top && ( top.floorDistance < FLOOR_GAP_MIN || top.floorDistance > FLOOR_GAP_MAX ) ) raised.y -= top.floorDistance - FLOOR_GAP;

		return { position: raised, floor: top, slidAlong: ahead };

	}

	/**
	 * Moves the capsule on its feet or through the air: along the floor's slope when it starts on one, sliding along
	 * up to eight surfaces (stepping up what it can when it started on the floor), then onto the floor below if
	 * there is one, back at its gap above it.
	 *
	 * @param {Vector3} position Moved in place.
	 * @param {Vector3} velocity Loses what goes into the surfaces met; its fall stops on a floor.
	 * @param {number} dt
	 * @param {{ stepHeight: number, walkableSlope: number }} limits
	 * @param {boolean} wasGrounded
	 * @param {number} [halfHeight]
	 * @param {Vector3|null} [displacement] The move, if not `velocity · dt`.
	 * @param {Quaternion} [tilt]
	 * @return {{ grounded: boolean }}
	 */
	walk( position, velocity, dt, limits, wasGrounded, halfHeight = CAPSULE.halfHeight, displacement = null, tilt ) {

		this.resolvePenetration( position, halfHeight, tilt );

		const walkable = Math.cos( limits.walkableSlope );
		const remaining = displacement ? displacement.clone() : velocity.clone().multiplyScalar( dt );
		const floor = wasGrounded ? this.findFloor( position, halfHeight, limits.stepHeight + FLOOR_GAP_MAX, limits.walkableSlope ) : null;

		if ( floor && ! floor.byRay && remaining.y <= 0 && floor.normal.y > SLOPE_EDGE && floor.faceNormal.y > SLOPE_EDGE && floor.faceNormal.y < 1 - SLOPE_EDGE ) {

			// On a slope, the same distance along it.
			const normal = floor.faceNormal;
			const distance = remaining.length();

			remaining.y = - ( remaining.x * normal.x + remaining.z * normal.z ) / normal.y;
			remaining.setLength( distance );

		}

		let grounded = false;
		let previousNormal = null;

		for ( let slide = 0; slide < SLIDES && remaining.lengthSq() > DONE; slide ++ ) {

			const hit = this.sweep( position, remaining, halfHeight, tilt );

			if ( ! hit ) {

				position.add( remaining );
				break;

			}

			upTo( position, remaining, hit );
			remaining.multiplyScalar( 1 - hit.fraction );

			const onFloor = hit.faceNormal.y >= walkable;

			if ( onFloor && velocity.y <= 0 ) grounded = true;

			if ( ! onFloor && wasGrounded && limits.stepHeight > 0 ) {

				const step = this.stepUp( position, remaining, halfHeight, limits, hit, floor, tilt );

				if ( step ) {

					position.copy( step.position );

					// On the way across it may have slid along a wall, and loses the speed into it as any slide does.
					if ( step.slidAlong ) loseInto( velocity, slideNormal( step.slidAlong, true, walkable ) );
					grounded = true;
					remaining.set( 0, 0, 0 );
					break;

				}

			}

			const normal = slideNormal( hit, wasGrounded, walkable );
			const inward = remaining.dot( normal );

			if ( inward < 0 ) remaining.addScaledVector( normal, - inward );

			if ( previousNormal && remaining.dot( previousNormal ) < 0 ) {

				// Pushed back into the last surface (a corner): only along the crease between the two.
				const crease = new Vector3().crossVectors( previousNormal, normal ).normalize();

				remaining.copy( crease.multiplyScalar( remaining.dot( crease ) ) );

			}

			loseInto( velocity, normal );
			previousNormal = normal;
			if ( hit.startedInside ) this.resolvePenetration( position, halfHeight, tilt );

		}

		const below = velocity.y <= RISING ? this.findFloor( position, halfHeight, wasGrounded ? limits.stepHeight + FLOOR_GAP_MAX : FLOOR_GAP_MAX, limits.walkableSlope ) : null;

		if ( below ) {

			grounded = true;
			if ( below.floorDistance < FLOOR_GAP_MIN || below.floorDistance > FLOOR_GAP_MAX ) position.y -= below.floorDistance - FLOOR_GAP;
			velocity.y = 0;

		}

		this.floor = below;

		return { grounded };

	}

}

export { Mover, FLOOR_GAP, FLOOR_GAP_MAX };
