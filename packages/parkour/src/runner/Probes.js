import { Matrix4, Quaternion, Vector3 } from 'three';
import { radians } from '../math.js';

const UP = new Vector3( 0, 1, 0 );
const DOWN = new Vector3( 0, - 1, 0 );
const PROBE = Object.freeze( { group: 'probe' } );

// A wall face this far off vertical (rad) is no obstacle to vault: its sine bounds the face normal's y.
const VAULT_WALL_TILT = radians( 5 );
// A leap goes only to a ledge facing the runner within this angle (rad).
const LEAP_MAX_ANGLE = radians( 15 );

// The ledge scans: a column of spheres swept forward from the runner, from the lowest step (first) to the highest
// (last) above `base` (m below the body's centre), the first wall met giving the ledge whose top lies just above it.
// A sphere sees a top within about its radius of its own height. A low obstacle must be an upright wall to vault, and
// its scan goes on up the column (`upward`) past a sphere that meets the face below a top out of its sight, so every
// height the column covers can be vaulted (0.7-1.2 m), not just the lowest sphere's.
const LEDGE_SCANS = Object.freeze( {
	lowObstacle: { first: 6, last: 9, step: 0.1555, base: - 1.15, reach: 2, radius: 0.1, verticalWall: true, upward: true },
	midObstacle: { first: 7, last: 12, step: 0.1555, base: - 1.15, reach: 1.25, radius: 0.1 },
	highObstacle: { first: 12, last: 20, step: 0.1555, base: - 1.15, reach: 0.55, radius: 0.08 },
	highLedge: { first: 20, last: 28, step: 0.1155, base: - 0.26, reach: 0.41, radius: 0.1 },
	airLedge: { first: 1, last: 10, step: 0.1155, base: - 0.26, reach: 0.26, radius: 0.1, topRadius: 0.08 }
} );
// A ledge's top: by default a sphere this size (m) dropped from this far above the wall's hit, this far down.
const LEDGE_TOP = { radius: 0.1, start: 0.2, depth: 0.2 };

// The leap from a hang: big spheres swept toward the wall (from `back` behind the body to `ahead` in front, m) at
// steps `step` apart along the steer, step `first` to `last`, from this far above the body's centre. The top found
// with a small sphere (LEAP_TOP); room for the body hanging there (a capsule this far below the top and out from the
// wall); and a clear line from the body to just short of the top (this far back toward the runner).
const LEAP_FAN = { first: 3, last: 8, up: 0.9, step: 0.25, back: 0.3, ahead: 0.25, radius: 0.3 };
const LEAP_TOP = { radius: 0.05, start: 0.25, depth: 0.25 };
const LEAP_ROOM = { down: 0.55, out: 0.5, radius: 0.185, halfHeight: 0.65 };
const LEAP_SIGHT_SHORT = 0.2;
// A leap goes to another ledge, not along the one held: the hands hold the top this far above the hanging body's
// centre and toward the wall (m), and a top found every `every` (m) from there to the ledge met, within `level` of the
// height between (a small sphere dropped from `above` it, `in` past the face, onto it), is the same ledge. The hands
// need the top under them, `hand` either side of the hold; a hold short of that at the ledge's end moves in along it,
// `step` at a time, up to `most`.
const LEAP_HOLD = { up: 0.9, ahead: 0.185 };
const LEAP_SAME = { every: 0.2, level: 0.1, above: 0.15, in: 0.06, radius: 0.04 };
const LEAP_HANDS = { hand: 0.25, step: 0.1, most: 0.5 };
// The corner: a sphere swept back toward the body from out to the side (from `from` to `to`, m), this far ahead, at
// two heights (`up`, then `step` higher), the top found with a small sphere (CORNER_TOP). Room for the leap round it
// (boxes: half sizes, m): the body hanging on the wall round the corner (down from its top, out from it and along
// it), and the body and feet swinging off the wall they hang on now (up from the body's centre and out to that side).
const CORNER_SCAN = { up: 0.9, step: 0.12, ahead: 0.55, from: 0.85, to: 0.15, radius: 0.1 };
const CORNER_TOP = { radius: 0.05, start: 0.1 };
const CORNER_ROOM = Object.freeze( {
	onWall: { down: 0.5, out: 0.2, along: 0.25, halfSize: new Vector3( 0.4, 0.55, 0.185 ) },
	body: { up: 0.55, out: 0.35, halfSize: new Vector3( 0.15, 0.55, 0.35 ) },
	feet: { up: 0.4, out: 0.3, halfSize: new Vector3( 0.3, 0.6, 0.15 ) }
} );
// Room to climb up from a hang: a capsule this far up and toward the wall (m).
const CLIMB_ROOM = { up: 1.95, ahead: 0.25, radius: 0.25, halfHeight: 0.8 };
// Room above the head: a thin capsule this far above the body's centre (m).
const HEADROOM = { up: 1.5, radius: 0.1, halfHeight: 0.9 };
// A ledge wide enough for both hands: no wall in a small sphere swept this far either side along its top, this far
// above it (m).
const HAND_ROOM = { up: 0.1, side: 0.15, radius: 0.05 };
// A wall in front to climb or run up: a sphere swept ahead from this far above the body's centre (m); on the ground
// farther and bigger than in the air.
const WALL_TO_CLIMB = { up: 0.55, ground: { reach: 0.55, radius: 0.15 }, air: { reach: 0.25, radius: 0.08 } };
// In the way of a vault: something in a sphere swept this far ahead over the obstacle's top, from this high above it
// (m).
const VAULT_PATH = { up: 0.25, reach: 1.5, radius: 0.15 };
// Too close to vault: an obstacle within a sphere swept this far ahead of the body's centre (m).
const TOO_CLOSE = { reach: 0.76, radius: 0.26 };
// A precision target: rays down `depth` (m), stepped out ahead `step` apart (m), step `first` to `last`; a stride's
// targets are nearer and shallower.
const PRECISION_TARGET = { first: 45, last: 100, step: 0.05, depth: 2 };
const STRIDE_TARGET = { first: 45, last: 70, step: 0.05, depth: 1.6 };

/** The normal of the face a probe hit, as built (not the contact's). */
function faceNormal( hit ) {

	return hit.faceNormal || hit.normal;

}

/** The solid a probe hit is tagged so. */
function hasTag( hit, tag ) {

	return Boolean( hit?.solid.tags.includes( tag ) );

}

// A frame on a wall's normal: forward out of it, right along it, up; and the rotation that turns a box into it.
function normalBasis( normal ) {

	const forward = normal.clone().normalize();
	const right = new Vector3( - forward.z, 0, forward.x ).normalize();

	if ( ! right.lengthSq() ) right.set( - 1, 0, 0 );

	const up = right.clone().cross( forward ).normalize();
	const matrix = new Matrix4().makeBasis( right.clone().negate(), up, forward );

	return { forward, right, up, rotation: new Quaternion().setFromRotationMatrix( matrix ) };

}

/**
 * The probes the ledge moves look with: the ledge scans, a ledge's top, room to climb and to leap, corners, and the
 * targets of precision jumps. All on the probe group of the course's queries. A ledge is `{ wall, top }`: the hit on
 * the wall and the hit on its top.
 */
class Probes {

	constructor( runner ) {

		this.runner = runner;

		this.queries = runner.queries;

	}

	sphereCast( from, to, radius ) {

		return this.queries.sphereCast( from, to, radius, PROBE );

	}

	overlapSphere( at, radius ) {

		return this.queries.overlapSphere( at, radius, PROBE );

	}

	capsuleCast( from, to, radius, halfHeight ) {

		return this.queries.capsuleCast( from, to, radius, halfHeight, PROBE );

	}

	overlapCapsule( at, radius, halfHeight ) {

		return this.queries.overlapCapsule( at, radius, halfHeight, PROBE );

	}

	rayBetween( from, to ) {

		const direction = to.clone().sub( from );
		const length = direction.length();

		return length ? this.queries.ray( from, direction.divideScalar( length ), length, 'probe' ) : null;

	}

	/** The top above a wall hit: a sphere dropped from `topStart` above it, `depth` down. Null if it starts inside. */
	ledgeTop( wall, topRadius = LEDGE_TOP.radius, topStart = LEDGE_TOP.start, depth = LEDGE_TOP.depth ) {

		if ( ! wall ) return null;

		const origin = wall.point.clone().addScaledVector( UP, topStart );
		const top = this.sphereCast( origin, origin.clone().addScaledVector( DOWN, depth ), topRadius );

		if ( ! top || top.startedInside ) return null;

		return { wall, top };

	}

	/** The ledge a named scan (LEDGE_SCANS) finds ahead, or null. */
	scan( name ) {

		const profile = LEDGE_SCANS[ name ];

		if ( ! profile ) throw new Error( 'Unknown ledge scan: ' + name );

		const c = this.runner;

		for ( let index = profile.first; index <= profile.last; index ++ ) {

			const origin = c.position.clone().addScaledVector( UP, profile.base );

			origin.addScaledVector( UP, index * profile.step );

			const wall = this.sphereCast( origin, origin.clone().addScaledVector( c.forward(), profile.reach ), profile.radius );

			if ( ! wall ) continue;

			if ( profile.verticalWall && Math.abs( faceNormal( wall ).y ) >= Math.sin( VAULT_WALL_TILT ) ) return null;

			const ledge = this.ledgeTop( wall, profile.topRadius );

			if ( ledge || ! profile.upward ) return ledge;

		}

		return null;

	}

	/**
	 * From a hang, the ledge a leap toward the steer reaches: big spheres stepped out along the steer (up the wall and
	 * sideways), the first wall met giving the ledge, if it may be climbed, is wide enough, has room for the body below
	 * it, faces the runner and is in sight. With the steer's angle (rad, + to the right, 0 up) and which way it
	 * points up or down.
	 */
	leapFan( moveForward, moveRight ) {

		const c = this.runner;
		const direction = UP.clone().multiplyScalar( moveForward ).addScaledVector( c.right(), moveRight );

		if ( ! direction.lengthSq() ) return null;

		const angle = Math.sign( moveRight ) * UP.angleTo( direction );

		direction.normalize();

		const fan = LEAP_FAN;

		for ( let index = fan.first; index <= fan.last; index ++ ) {

			const center = c.position.clone().addScaledVector( UP, fan.up ).addScaledVector( direction, index * fan.step );
			const wall = this.sphereCast( center.clone().addScaledVector( c.forward(), - fan.back ), center.clone().addScaledVector( c.forward(), fan.ahead ), fan.radius );

			if ( ! wall ) continue;
			if ( hasTag( wall, 'noClimb' ) ) return null;

			const ledge = this.ledgeTop( wall, LEAP_TOP.radius, LEAP_TOP.start, LEAP_TOP.depth );

			if ( ! ledge || ! this.wideEnough( ledge ) ) return null;

			// The ledge held runs on to here: look further along the steer, past its end.
			if ( this.sameLedge( ledge ) || ! this.handsOn( ledge ) ) continue;

			const body = ledge.top.point.clone().addScaledVector( UP, - LEAP_ROOM.down ).addScaledVector( faceNormal( wall ), LEAP_ROOM.out );

			if ( this.overlapCapsule( body, LEAP_ROOM.radius, LEAP_ROOM.halfHeight ) ) return null;

			if ( faceNormal( wall ).angleTo( c.forward().negate() ) >= LEAP_MAX_ANGLE ) return null;
			if ( this.rayBetween( c.position, ledge.top.point.clone().addScaledVector( c.forward(), - LEAP_SIGHT_SHORT ) ) ) return null;

			return { ...ledge, angle, forwardSign: Math.sign( moveForward ) };

		}

		return null;

	}

	// Whether a ledge met from a hang is the one held: its top runs on, level with the hold, all the way there.
	sameLedge( ledge ) {

		const c = this.runner, same = LEAP_SAME;
		const hold = c.position.clone().addScaledVector( UP, LEAP_HOLD.up ).addScaledVector( c.forward(), LEAP_HOLD.ahead );
		const to = ledge.top.point;
		const steps = Math.max( 1, Math.ceil( hold.distanceTo( to ) / same.every ) );

		for ( let i = 1; i < steps; i ++ ) {

			if ( ! this.topAt( hold.clone().lerp( to, i / steps ), faceNormal( ledge.wall ) ) ) return false;

		}

		return true;

	}

	// The top under both hands at a ledge's hold, moving the hold in along the ledge (away from the runner) when its
	// end is short of a hand: false if it never is.
	handsOn( ledge ) {

		const hands = LEAP_HANDS, normal = faceNormal( ledge.wall );
		const { right } = normalBasis( normal );
		const away = Math.sign( ledge.top.point.clone().sub( this.runner.position ).dot( right ) ) || 1;

		for ( let along = 0; along <= hands.most + 1e-9; along += hands.step ) {

			const hold = ledge.top.point.clone().addScaledVector( right, away * along );

			if ( this.topAt( hold.clone().addScaledVector( right, hands.hand ), normal ) && this.topAt( hold.clone().addScaledVector( right, - hands.hand ), normal ) ) {

				ledge.top.point.copy( hold );
				return true;

			}

		}

		return false;

	}

	// A ledge's top at a point on its edge (the wall's face out along `normal`): just in from the face, level with it.
	topAt( point, normal ) {

		const same = LEAP_SAME;
		const at = point.clone().addScaledVector( normal.clone().setY( 0 ).normalize(), - same.in );
		const top = this.sphereCast( at.clone().addScaledVector( UP, same.above ), at.clone().addScaledVector( UP, - same.above ), same.radius );

		return Boolean( top && ! top.startedInside && Math.abs( top.point.y - point.y ) <= same.level );

	}

	/** The ledge round the corner to one side (+1 right, −1 left) of a hang, or null. */
	corner( side ) {

		const c = this.runner;

		const scan = CORNER_SCAN;

		for ( let index = 0; index <= 1; index ++ ) {

			const base = c.position.clone().addScaledVector( UP, scan.up + index * scan.step ).addScaledVector( c.forward(), scan.ahead );
			const wall = this.sphereCast( base.clone().addScaledVector( c.right(), side * scan.from ), base.clone().addScaledVector( c.right(), side * scan.to ), scan.radius );

			if ( wall ) return this.ledgeTop( wall, CORNER_TOP.radius, CORNER_TOP.start );

		}

		return null;

	}

	/** Room for the leap round a corner: the body on the wall round it, and the body and feet off the wall hung on. */
	cornerClear( ledge, side ) {

		const c = this.runner;

		const { onWall, body, feet } = CORNER_ROOM;
		const basis = normalBasis( faceNormal( ledge.wall ) );
		const hangAt = ledge.top.point.clone().addScaledVector( UP, - onWall.down ).addScaledVector( basis.forward, onWall.out ).addScaledVector( basis.right, side * onWall.along );

		if ( this.queries.overlapBox( hangAt, onWall.halfSize, basis.rotation, PROBE ) ) return false;

		const facing = new Quaternion().setFromAxisAngle( UP, c.yaw );
		const bodyAt = c.position.clone().addScaledVector( UP, body.up ).addScaledVector( c.right(), side * body.out );

		if ( this.queries.overlapBox( bodyAt, body.halfSize, facing, PROBE ) ) return false;

		const feetAt = c.position.clone().addScaledVector( UP, feet.up ).addScaledVector( c.right(), side * feet.out );

		return ! this.queries.overlapBox( feetAt, feet.halfSize, facing, PROBE );

	}

	/** Room for the body above a hang to climb up into. */
	roomToClimb() {

		const position = this.runner.position.clone().addScaledVector( UP, CLIMB_ROOM.up ).addScaledVector( this.runner.forward(), CLIMB_ROOM.ahead );

		return ! this.overlapCapsule( position, CLIMB_ROOM.radius, CLIMB_ROOM.halfHeight );

	}

	/** Room above the head. */
	roomAbove() {

		const position = this.runner.position.clone().addScaledVector( UP, HEADROOM.up );

		return ! this.overlapCapsule( position, HEADROOM.radius, HEADROOM.halfHeight );

	}

	/** A ledge wide enough for both hands: no wall across its top within a hand's width either side. */
	wideEnough( ledge ) {

		const { right } = normalBasis( faceNormal( ledge.wall ) );
		const base = ledge.top.point.clone().addScaledVector( UP, HAND_ROOM.up );

		return ! this.sphereCast( base.clone().addScaledVector( right, - HAND_ROOM.side ), base.clone().addScaledVector( right, HAND_ROOM.side ), HAND_ROOM.radius );

	}

	/** A wall in front to climb or run up (nearer and slimmer in the air). */
	wallToClimb() {

		const c = this.runner;
		const probe = c.grounded ? WALL_TO_CLIMB.ground : WALL_TO_CLIMB.air;
		const origin = c.position.clone().addScaledVector( UP, WALL_TO_CLIMB.up );
		const wall = this.sphereCast( origin, origin.clone().addScaledVector( c.forward(), probe.reach ), probe.radius );

		return Boolean( wall );

	}

	/** Something on the far side of an obstacle's top, in the way of a vault. */
	vaultBlocked( ledge ) {

		const origin = ledge.top.point.clone().addScaledVector( UP, VAULT_PATH.up );

		return Boolean( this.sphereCast( origin, origin.clone().addScaledVector( this.runner.forward(), VAULT_PATH.reach ), VAULT_PATH.radius ) );

	}

	/** Too close to an obstacle to vault it. */
	tooCloseToVault() {

		const origin = this.runner.position;

		return Boolean( this.sphereCast( origin, origin.clone().addScaledVector( this.runner.forward(), TOO_CLOSE.reach ), TOO_CLOSE.radius ) );

	}

	/**
	 * The floor a precision jump (or a stride) lands on: rays down stepped out ahead every 5 cm from 2.25 m, to 5 m (a
	 * stride: 3.5 m, and less far down).
	 */
	precisionTarget( stride = false ) {

		const rays = stride ? STRIDE_TARGET : PRECISION_TARGET;

		for ( let index = rays.first; index <= rays.last; index ++ ) {

			const origin = this.runner.position.clone().addScaledVector( this.runner.forward(), index * rays.step );
			const hit = this.queries.ray( origin, DOWN, rays.depth, 'probe' );

			if ( hit ) return hit;

		}

		return null;

	}

}

export { faceNormal, hasTag, Probes };
