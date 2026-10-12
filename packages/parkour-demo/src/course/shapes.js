/**
 * The solid shapes a course is built from, and the geometry the course's queries need of them. Every shape answers:
 *
 * - `sdf( x, y, z )`: the signed distance to its surface (negative inside).
 * - `closest( x, y, z, point, normal )`: the nearest surface point and the outward normal there; returns the signed
 *   distance.
 * - `segment( a, b, out )` (as six numbers): the point of a segment nearest the shape, for a capsule's axis.
 * - `ray( origin, direction, far, normal )`: the distance along a unit ray to where it enters, Infinity on a miss.
 * - `tops( x, z, r, out )`: the lowest and highest point of its upward-facing surface over a disc, and that surface's
 *   normal (false when the disc misses it): the ground a runner of radius r stands on.
 * - `bottom( x, z, r )`: the lowest point of its underside over a disc (Infinity on a miss): a ceiling.
 *
 * `min` and `max` bound it. The field names (`c`, `h`, `ux`… for boxes and wedges, `a`, `b`, `r` for tubes, `x`, `z`,
 * `r`, `y0`, `y1` for cylinders) are read by `world/fromCourse.js` to build the physics world.
 */
import * as THREE from 'three/webgpu';

// The golden ratio's conjugate: the step of a golden-section search.
const GOLDEN = ( Math.sqrt( 5 ) - 1 ) / 2;
// Golden-section steps for a segment's nearest point: 22 narrow the interval to about 2.5e-5 of its length.
const SEARCH_STEPS = 22;
const EPS = 1e-9;
const UP = new THREE.Vector3( 0, 1, 0 );

const clamp = ( x, a, b ) => x < a ? a : x > b ? b : x;

class Shape {

	constructor() {

		this.min = new THREE.Vector3();
		this.max = new THREE.Vector3();

	}

	/**
	 * The point of the segment a–b nearest the shape: `out.t` (0 at a, 1 at b), `out.point` and `out.normal` on the
	 * shape's surface, `out.d` the signed distance. A golden-section search for the smallest distance along the segment,
	 * then its ends checked too (the distance along a segment need not have a single dip).
	 * @return {number} The signed distance.
	 */
	segment( ax, ay, az, bx, by, bz, out ) {

		const dx = bx - ax, dy = by - ay, dz = bz - az;
		let lo = 0, hi = 1;
		let c = hi - GOLDEN * ( hi - lo ), d = lo + GOLDEN * ( hi - lo );
		let fc = this.sdf( ax + dx * c, ay + dy * c, az + dz * c ), fd = this.sdf( ax + dx * d, ay + dy * d, az + dz * d );
		for ( let i = 0; i < SEARCH_STEPS; i ++ ) {

			if ( fc <= fd ) {

				hi = d; d = c; fd = fc;
				c = hi - GOLDEN * ( hi - lo );
				fc = this.sdf( ax + dx * c, ay + dy * c, az + dz * c );

			} else {

				lo = c; c = d; fc = fd;
				d = lo + GOLDEN * ( hi - lo );
				fd = this.sdf( ax + dx * d, ay + dy * d, az + dz * d );

			}

		}

		let t = ( lo + hi ) / 2, f = this.sdf( ax + dx * t, ay + dy * t, az + dz * t );
		const f0 = this.sdf( ax, ay, az );
		if ( f0 <= f + 1e-12 ) { t = 0; f = f0; }
		const f1 = this.sdf( bx, by, bz );
		if ( f1 < f - 1e-12 ) { t = 1; f = f1; }
		out.t = t;
		out.d = this.closest( ax + dx * t, ay + dy * t, az + dz * t, out.point, out.normal );
		return out.d;

	}

}

// The span of heights a planar face (vertices `v` as [ x, y, z ], normal `n`, not vertical) takes over the part of a
// disc it covers: the plane's height at every vertex inside the disc, where the disc's rim crosses the face's edges,
// at the centre and at the rim's highest and lowest points when those are on the face. False when none is.
function faceRange( v, n, cx, cz, r, out ) {

	const gx = - n.x / n.y, gz = - n.z / n.y, x0 = v[ 0 ][ 0 ], y0 = v[ 0 ][ 1 ], z0 = v[ 0 ][ 2 ];
	let lo = Infinity, hi = - Infinity;
	const take = ( x, z ) => {

		const y = y0 + gx * ( x - x0 ) + gz * ( z - z0 );
		if ( y < lo ) lo = y;
		if ( y > hi ) hi = y;

	};

	const r2 = r * r, k = v.length;
	for ( let i = 0; i < k; i ++ ) {

		const p = v[ i ], q = v[ ( i + 1 ) % k ];
		if ( ( p[ 0 ] - cx ) ** 2 + ( p[ 2 ] - cz ) ** 2 <= r2 ) take( p[ 0 ], p[ 2 ] );
		if ( r > 0 ) {

			const ex = q[ 0 ] - p[ 0 ], ez = q[ 2 ] - p[ 2 ], fx = p[ 0 ] - cx, fz = p[ 2 ] - cz;
			const a = ex * ex + ez * ez, b = 2 * ( fx * ex + fz * ez ), c = fx * fx + fz * fz - r2;
			const disc = b * b - 4 * a * c;
			if ( a > EPS && disc >= 0 ) {

				const s = Math.sqrt( disc );
				for ( const t of [ ( - b - s ) / ( 2 * a ), ( - b + s ) / ( 2 * a ) ] ) if ( t >= 0 && t <= 1 ) take( p[ 0 ] + ex * t, p[ 2 ] + ez * t );

			}

		}

	}

	if ( inPolygon( v, cx, cz ) ) take( cx, cz );
	const gl = Math.hypot( gx, gz );
	if ( r > 0 && gl > EPS ) {

		const ex = gx / gl * r, ez = gz / gl * r;
		if ( inPolygon( v, cx + ex, cz + ez ) ) take( cx + ex, cz + ez );
		if ( inPolygon( v, cx - ex, cz - ez ) ) take( cx - ex, cz - ez );

	}

	if ( lo > hi ) return false;
	out.lo = lo;
	out.hi = hi;
	return true;

}

// Whether a point is inside a convex polygon seen from above (on the same side of every edge).
function inPolygon( v, x, z ) {

	let sign = 0;
	for ( let i = 0, k = v.length; i < k; i ++ ) {

		const p = v[ i ], q = v[ ( i + 1 ) % k ];
		const c = ( q[ 0 ] - p[ 0 ] ) * ( z - p[ 2 ] ) - ( q[ 2 ] - p[ 2 ] ) * ( x - p[ 0 ] );
		if ( Math.abs( c ) < 1e-12 ) continue;
		if ( sign === 0 ) sign = Math.sign( c );
		else if ( Math.sign( c ) !== sign ) return false;

	}

	return true;

}

/**
 * An oriented box: centre `c`, half extents `h` along its axes `ux`, `uy`, `uz`. A `flat` box stands upright (only
 * turned about y), so its top is level; the deriving finds edges and walls only on flat boxes. A tilted one (a beam
 * on a slant) keeps its six `faces` for the ground and ceiling queries.
 */
export class Box extends Shape {

	/**
	 * @param {THREE.Vector3} centre
	 * @param {THREE.Quaternion} quaternion
	 * @param {THREE.Vector3} half
	 */
	constructor( centre, quaternion, half ) {

		super();
		this.c = centre.clone();
		this.h = half.clone();
		this.ux = new THREE.Vector3( 1, 0, 0 ).applyQuaternion( quaternion );
		this.uy = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( quaternion );
		this.uz = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( quaternion );
		this.flat = Math.abs( this.uy.y - 1 ) < 1e-9;
		this.measure();

	}

	// The bounds, and a tilted box's faces as polygons (four corners and an outward normal each).
	measure() {

		const { c, h, ux, uy, uz } = this;
		for ( const k of [ 'x', 'y', 'z' ] ) {

			const e = Math.abs( ux[ k ] ) * h.x + Math.abs( uy[ k ] ) * h.y + Math.abs( uz[ k ] ) * h.z;
			this.min[ k ] = c[ k ] - e;
			this.max[ k ] = c[ k ] + e;

		}

		this.faces = [];
		if ( this.flat ) return;
		for ( const [ axis, other1, other2, hk, h1, h2 ] of [ [ ux, uy, uz, 'x', 'y', 'z' ], [ uy, uz, ux, 'y', 'z', 'x' ], [ uz, ux, uy, 'z', 'x', 'y' ] ] ) {

			for ( const s of [ 1, - 1 ] ) {

				const n = axis.clone().multiplyScalar( s ), v = [];
				for ( const [ a, b ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) {

					const p = c.clone().addScaledVector( axis, s * h[ hk ] ).addScaledVector( other1, a * h[ h1 ] ).addScaledVector( other2, b * h[ h2 ] );
					v.push( [ p.x, p.y, p.z ] );

				}

				this.faces.push( { n, v } );

			}

		}

	}

	sdf( x, y, z ) {

		const { c, h, ux, uy, uz } = this;
		const dx = x - c.x, dy = y - c.y, dz = z - c.z;
		const qx = Math.abs( dx * ux.x + dy * ux.y + dz * ux.z ) - h.x;
		const qy = Math.abs( dx * uy.x + dy * uy.y + dz * uy.z ) - h.y;
		const qz = Math.abs( dx * uz.x + dy * uz.y + dz * uz.z ) - h.z;
		const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
		const inner = Math.max( qx, qy, qz );
		return Math.sqrt( ox * ox + oy * oy + oz * oz ) + ( inner < 0 ? inner : 0 );

	}

	closest( x, y, z, P, N ) {

		const { c, h, ux, uy, uz } = this;
		const dx = x - c.x, dy = y - c.y, dz = z - c.z;
		const lx = dx * ux.x + dy * ux.y + dz * ux.z, ly = dx * uy.x + dy * uy.y + dz * uy.z, lz = dx * uz.x + dy * uz.y + dz * uz.z;
		const ex = h.x - Math.abs( lx ), ey = h.y - Math.abs( ly ), ez = h.z - Math.abs( lz );
		let px = lx, py = ly, pz = lz, d;
		// Inside, the nearest face is the one with the least room to it; outside, the point clamped into the box.
		if ( ex >= 0 && ey >= 0 && ez >= 0 ) {

			if ( ex <= ey && ex <= ez ) {

				px = lx < 0 ? - h.x : h.x;
				N.copy( ux ).multiplyScalar( lx < 0 ? - 1 : 1 );
				d = - ex;

			} else if ( ey <= ez ) {

				py = ly < 0 ? - h.y : h.y;
				N.copy( uy ).multiplyScalar( ly < 0 ? - 1 : 1 );
				d = - ey;

			} else {

				pz = lz < 0 ? - h.z : h.z;
				N.copy( uz ).multiplyScalar( lz < 0 ? - 1 : 1 );
				d = - ez;

			}

		} else {

			px = clamp( lx, - h.x, h.x ); py = clamp( ly, - h.y, h.y ); pz = clamp( lz, - h.z, h.z );
			const gx = lx - px, gy = ly - py, gz = lz - pz;
			d = Math.sqrt( gx * gx + gy * gy + gz * gz );
			N.set( 0, 0, 0 ).addScaledVector( ux, gx / d ).addScaledVector( uy, gy / d ).addScaledVector( uz, gz / d );

		}

		P.copy( c ).addScaledVector( ux, px ).addScaledVector( uy, py ).addScaledVector( uz, pz );
		return d;

	}

	ray( o, dir, far, N ) {

		const { c, h, ux, uy, uz } = this;
		const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
		// The slab test: the ray is inside the box where it is inside all three pairs of faces.
		let t0 = - Infinity, t1 = far, axis = null, sign = 1;
		for ( const [ u, hk ] of [ [ ux, h.x ], [ uy, h.y ], [ uz, h.z ] ] ) {

			const lo = ox * u.x + oy * u.y + oz * u.z, ld = dir.x * u.x + dir.y * u.y + dir.z * u.z;
			if ( Math.abs( ld ) < EPS ) {

				if ( lo < - hk || lo > hk ) return Infinity;
				continue;

			}

			let a = ( - hk - lo ) / ld, b = ( hk - lo ) / ld, s = - 1;
			if ( a > b ) { const t = a; a = b; b = t; s = 1; }
			if ( a > t0 ) { t0 = a; axis = u; sign = s; }
			if ( b < t1 ) t1 = b;
			if ( t0 > t1 ) return Infinity;

		}

		if ( t0 < 0 || ! axis ) return Infinity;
		N.copy( axis ).multiplyScalar( sign );
		return t0;

	}

	tops( cx, cz, r, out ) {

		const { c, h, ux, uz } = this;
		if ( this.flat ) {

			const dx = cx - c.x, dz = cz - c.z;
			const ex = Math.abs( dx * ux.x + dz * ux.z ) - h.x, ez = Math.abs( dx * uz.x + dz * uz.z ) - h.z;
			const ox = ex > 0 ? ex : 0, oz = ez > 0 ? ez : 0;
			if ( ox * ox + oz * oz > r * r ) return false;
			out.lo = out.hi = c.y + h.y;
			out.normal.copy( UP );
			return true;

		}

		let found = false, lo = Infinity, hi = - Infinity;
		for ( const f of this.faces ) {

			if ( f.n.y < 1e-6 || ! faceRange( f.v, f.n, cx, cz, r, faceSpan ) ) continue;
			if ( faceSpan.hi > hi ) out.normal.copy( f.n );
			lo = Math.min( lo, faceSpan.lo );
			hi = Math.max( hi, faceSpan.hi );
			found = true;

		}

		out.lo = lo;
		out.hi = hi;
		return found;

	}

	bottom( cx, cz, r ) {

		const { c, h, ux, uz } = this;
		if ( this.flat ) {

			const dx = cx - c.x, dz = cz - c.z;
			const ex = Math.abs( dx * ux.x + dz * ux.z ) - h.x, ez = Math.abs( dx * uz.x + dz * uz.z ) - h.z;
			const ox = ex > 0 ? ex : 0, oz = ez > 0 ? ez : 0;
			return ox * ox + oz * oz > r * r ? Infinity : c.y - h.y;

		}

		let lo = Infinity;
		for ( const f of this.faces ) if ( f.n.y < - 1e-6 && faceRange( f.v, f.n, cx, cz, r, faceSpan ) ) lo = Math.min( lo, faceSpan.lo );
		return lo;

	}

}

const faceSpan = { lo: 0, hi: 0 };

/**
 * A wedge: a slope rising toward its +z (`uz`), turned about y by its yaw. Centre `c`, half extents `h`; seen from the
 * side its profile is a right triangle with a level base, an upright back face at +z and the slope from the base's
 * front edge up to the back face's top. `normal` is the slope's outward normal, `down` points down the slope and
 * `angle` is its steepness in degrees.
 */
export class Wedge extends Shape {

	/**
	 * @param {THREE.Vector3} centre
	 * @param {number} yaw
	 * @param {THREE.Vector3} half
	 */
	constructor( centre, yaw, half ) {

		super();
		this.c = centre.clone();
		this.h = half.clone();
		this.ux = new THREE.Vector3( Math.cos( yaw ), 0, - Math.sin( yaw ) );
		this.uy = UP.clone();
		this.uz = new THREE.Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );
		const L = Math.hypot( half.y, half.z );
		this.sn = { y: half.z / L, z: - half.y / L };
		this.normal = new THREE.Vector3().addScaledVector( this.uy, this.sn.y ).addScaledVector( this.uz, this.sn.z );
		this.down = new THREE.Vector3().addScaledVector( this.uz, - half.z / L ).addScaledVector( this.uy, - half.y / L );
		this.angle = Math.atan2( half.y, half.z ) * 180 / Math.PI;
		const { c, h, ux, uz } = this;
		for ( const k of [ 'x', 'z' ] ) {

			const e = Math.abs( ux[ k ] ) * h.x + Math.abs( uz[ k ] ) * h.z;
			this.min[ k ] = c[ k ] - e;
			this.max[ k ] = c[ k ] + e;

		}

		this.min.y = c.y - h.y;
		this.max.y = c.y + h.y;

	}

	// The signed distance from a point (z, y) in the wedge's own frame to its profile triangle, with the nearest point
	// and that side's normal left in `profileHit`.
	profileDistance( z, y ) {

		const hz = this.h.z, hy = this.h.y, t = profileHit;
		let best = Infinity, inside = true;
		{

			const cz = clamp( z, - hz, hz ), d = ( z - cz ) ** 2 + ( y + hy ) ** 2;
			if ( y < - hy ) inside = false;
			if ( d < best ) { best = d; t.z = cz; t.y = - hy; t.nz = 0; t.ny = - 1; }

		}

		{

			const cy = clamp( y, - hy, hy ), d = ( z - hz ) ** 2 + ( y - cy ) ** 2;
			if ( z > hz ) inside = false;
			if ( d < best ) { best = d; t.z = hz; t.y = cy; t.nz = 1; t.ny = 0; }

		}

		{

			const ez = - 2 * hz, ey = - 2 * hy, wz = z - hz, wy = y - hy;
			const s = clamp( ( wz * ez + wy * ey ) / ( ez * ez + ey * ey ), 0, 1 );
			const pz = hz + ez * s, py = hy + ey * s, d = ( z - pz ) ** 2 + ( y - py ) ** 2;
			if ( this.sn.z * z + this.sn.y * y > 0 ) inside = false;
			if ( d < best ) { best = d; t.z = pz; t.y = py; t.nz = this.sn.z; t.ny = this.sn.y; }

		}

		t.inside = inside;
		t.d = inside ? - Math.sqrt( best ) : Math.sqrt( best );
		return t.d;

	}

	sdf( x, y, z ) {

		const { c, h, ux, uz } = this;
		const dx = x - c.x, dz = z - c.z;
		const lx = dx * ux.x + dz * ux.z, lz = dx * uz.x + dz * uz.z, ly = y - c.y;
		const d2 = this.profileDistance( lz, ly ), qx = Math.abs( lx ) - h.x;
		const ox = qx > 0 ? qx : 0, o2 = d2 > 0 ? d2 : 0, inner = Math.max( d2, qx );
		return Math.sqrt( ox * ox + o2 * o2 ) + ( inner < 0 ? inner : 0 );

	}

	closest( x, y, z, P, N ) {

		const { c, h, ux, uy, uz } = this;
		const dx = x - c.x, dz = z - c.z;
		const lx = dx * ux.x + dz * ux.z, lz = dx * uz.x + dz * uz.z, ly = y - c.y;
		const d2 = this.profileDistance( lz, ly ), qx = Math.abs( lx ) - h.x, t = profileHit;
		let px = lx, py = ly, pz = lz, d;
		if ( d2 <= 0 && qx <= 0 ) {

			if ( d2 >= qx ) {

				py = t.y; pz = t.z;
				N.set( 0, 0, 0 ).addScaledVector( uy, t.ny ).addScaledVector( uz, t.nz );
				d = d2;

			} else {

				px = lx < 0 ? - h.x : h.x;
				N.copy( ux ).multiplyScalar( lx < 0 ? - 1 : 1 );
				d = qx;

			}

		} else {

			px = clamp( lx, - h.x, h.x );
			if ( ! t.inside ) { py = t.y; pz = t.z; }
			const gx = lx - px, gy = ly - py, gz = lz - pz;
			d = Math.sqrt( gx * gx + gy * gy + gz * gz );
			N.set( 0, 0, 0 ).addScaledVector( ux, gx / d ).addScaledVector( uy, gy / d ).addScaledVector( uz, gz / d );

		}

		P.copy( c ).addScaledVector( ux, px ).addScaledVector( uy, py ).addScaledVector( uz, pz );
		return d;

	}

	ray( o, dir, far, N ) {

		const { c, h, ux, uz, sn } = this;
		const ox = o.x - c.x, oz = o.z - c.z, oy = o.y - c.y;
		const lo = [ ox * ux.x + oz * ux.z, oy, ox * uz.x + oz * uz.z ];
		const ld = [ dir.x * ux.x + dir.z * ux.z, dir.y, dir.x * uz.x + dir.z * uz.z ];
		// The five planes of the wedge in its own frame: the two ends, the base, the back face, the slope.
		const planes = wedgePlanes;
		planes[ 0 ][ 3 ] = h.x; planes[ 1 ][ 3 ] = h.x; planes[ 2 ][ 3 ] = h.y; planes[ 3 ][ 3 ] = h.z;
		planes[ 4 ][ 1 ] = sn.y; planes[ 4 ][ 2 ] = sn.z;
		let t0 = - Infinity, t1 = far, enter = - 1;
		for ( let i = 0; i < 5; i ++ ) {

			const p = planes[ i ];
			const denom = p[ 0 ] * ld[ 0 ] + p[ 1 ] * ld[ 1 ] + p[ 2 ] * ld[ 2 ];
			const dist = p[ 0 ] * lo[ 0 ] + p[ 1 ] * lo[ 1 ] + p[ 2 ] * lo[ 2 ] - p[ 3 ];
			if ( Math.abs( denom ) < EPS ) {

				if ( dist > 0 ) return Infinity;
				continue;

			}

			const t = - dist / denom;
			if ( denom < 0 ) {

				if ( t > t0 ) { t0 = t; enter = i; }

			} else if ( t < t1 ) t1 = t;
			if ( t0 > t1 ) return Infinity;

		}

		if ( t0 < 0 || enter < 0 ) return Infinity;
		const p = planes[ enter ];
		N.set( 0, 0, 0 ).addScaledVector( ux, p[ 0 ] ).addScaledVector( UP, p[ 1 ] ).addScaledVector( uz, p[ 2 ] );
		return t0;

	}

	// Whether a disc meets the wedge's footprint, with the span along z it covers left in `footSpan`.
	footprint( cx, cz, r ) {

		const { c, h, ux, uz } = this;
		const dx = cx - c.x, dz = cz - c.z;
		const qx = dx * ux.x + dz * ux.z, qz = dx * uz.x + dz * uz.z;
		const ex = Math.abs( qx ) - h.x, ez = Math.abs( qz ) - h.z;
		const ox = ex > 0 ? ex : 0, oz = ez > 0 ? ez : 0;
		if ( ox * ox + oz * oz > r * r ) return false;
		const xs = clamp( qx, - h.x, h.x ), w = Math.sqrt( Math.max( 0, r * r - ( xs - qx ) ** 2 ) );
		footSpan.lo = Math.max( - h.z, qz - w );
		footSpan.hi = Math.min( h.z, qz + w );
		return true;

	}

	tops( cx, cz, r, out ) {

		if ( ! this.footprint( cx, cz, r ) ) return false;
		const k = this.h.y / this.h.z;
		out.lo = this.c.y + k * footSpan.lo;
		out.hi = this.c.y + k * footSpan.hi;
		out.normal.copy( this.normal );
		return true;

	}

	bottom( cx, cz, r ) {

		return this.footprint( cx, cz, r ) ? this.c.y - this.h.y : Infinity;

	}

}

const profileHit = { z: 0, y: 0, nz: 0, ny: 0, d: 0, inside: false };
const footSpan = { lo: 0, hi: 0 };
const wedgePlanes = [ [ 1, 0, 0, 0 ], [ - 1, 0, 0, 0 ], [ 0, - 1, 0, 0 ], [ 0, 0, 1, 0 ], [ 0, 0, 0, 0 ] ];

/** An upright cylinder at (`x`, `z`), radius `r`, from `y0` up to `y1`: a post, a pole, a drum. */
export class Cylinder extends Shape {

	constructor( x, z, r, y0, y1 ) {

		super();
		Object.assign( this, { x, z, r, y0, y1 } );
		this.min.set( x - r, y0, z - r );
		this.max.set( x + r, y1, z + r );

	}

	sdf( x, y, z ) {

		const dr = Math.hypot( x - this.x, z - this.z ) - this.r;
		const hh = ( this.y1 - this.y0 ) / 2, dy = Math.abs( y - ( this.y0 + this.y1 ) / 2 ) - hh;
		const or = dr > 0 ? dr : 0, oy = dy > 0 ? dy : 0, inner = Math.max( dr, dy );
		return Math.sqrt( or * or + oy * oy ) + ( inner < 0 ? inner : 0 );

	}

	closest( x, y, z, P, N ) {

		const ex = x - this.x, ez = z - this.z, rho = Math.hypot( ex, ez );
		const rx = rho > EPS ? ex / rho : 1, rz = rho > EPS ? ez / rho : 0;
		const dr = rho - this.r, hh = ( this.y1 - this.y0 ) / 2, ym = ( this.y0 + this.y1 ) / 2, dy = Math.abs( y - ym ) - hh;
		if ( dr <= 0 && dy <= 0 ) {

			if ( dr >= dy ) {

				P.set( this.x + rx * this.r, y, this.z + rz * this.r );
				N.set( rx, 0, rz );
				return dr;

			}

			const s = y < ym ? - 1 : 1;
			P.set( x, ym + s * hh, z );
			N.set( 0, s, 0 );
			return dy;

		}

		const pr = Math.min( rho, this.r ), py = clamp( y, this.y0, this.y1 );
		P.set( this.x + rx * pr, py, this.z + rz * pr );
		N.set( x - P.x, y - P.y, z - P.z );
		const d = N.length();
		if ( d < EPS ) N.set( rx, 0, rz );
		else N.divideScalar( d );
		return d;

	}

	// A ray from inside misses: the course's rays look for what is in the way, not what they start in.
	ray( o, dir, far, N ) {

		if ( this.sdf( o.x, o.y, o.z ) < 0 ) return Infinity;
		let best = Infinity;
		const ox = o.x - this.x, oz = o.z - this.z;
		const a = dir.x * dir.x + dir.z * dir.z;
		if ( a > EPS ) {

			const b = 2 * ( ox * dir.x + oz * dir.z ), c = ox * ox + oz * oz - this.r * this.r, disc = b * b - 4 * a * c;
			if ( disc >= 0 ) {

				const t = ( - b - Math.sqrt( disc ) ) / ( 2 * a ), y = o.y + dir.y * t;
				if ( t >= 0 && t < far && y >= this.y0 && y <= this.y1 ) {

					best = t;
					N.set( ( ox + dir.x * t ) / this.r, 0, ( oz + dir.z * t ) / this.r );

				}

			}

		}

		if ( Math.abs( dir.y ) > EPS ) {

			for ( const [ yc, s ] of [ [ this.y1, 1 ], [ this.y0, - 1 ] ] ) {

				const t = ( yc - o.y ) / dir.y;
				if ( t < 0 || t >= best || t >= far || dir.y * s > 0 ) continue;
				const px = ox + dir.x * t, pz = oz + dir.z * t;
				if ( px * px + pz * pz <= this.r * this.r ) {

					best = t;
					N.set( 0, s, 0 );

				}

			}

		}

		return best;

	}

	// Whether a disc meets the cylinder seen from above.
	overlaps( cx, cz, r ) {

		return ( cx - this.x ) ** 2 + ( cz - this.z ) ** 2 <= ( r + this.r ) ** 2;

	}

	tops( cx, cz, r, out ) {

		if ( ! this.overlaps( cx, cz, r ) ) return false;
		out.lo = out.hi = this.y1;
		out.normal.copy( UP );
		return true;

	}

	bottom( cx, cz, r ) {

		return this.overlaps( cx, cz, r ) ? this.y0 : Infinity;

	}

}

/** A tube of radius `r` round the segment `a`–`b`, rounded at its ends (a capsule): bars, pipes, cables, ropes. */
export class Tube extends Shape {

	constructor( a, b, r ) {

		super();
		this.a = a.clone();
		this.b = b.clone();
		this.r = r;
		this.min.copy( a ).min( b ).subScalar( r );
		this.max.copy( a ).max( b ).addScalar( r );
		this.d = new THREE.Vector3().subVectors( b, a );
		this.len2 = this.d.lengthSq();

	}

	// Where along the axis (0 at a, 1 at b) the point nearest (x, y, z) is.
	param( x, y, z ) {

		const { a, d } = this;
		return this.len2 > EPS ? clamp( ( ( x - a.x ) * d.x + ( y - a.y ) * d.y + ( z - a.z ) * d.z ) / this.len2, 0, 1 ) : 0;

	}

	sdf( x, y, z ) {

		const s = this.param( x, y, z ), { a, d } = this;
		return Math.hypot( x - a.x - d.x * s, y - a.y - d.y * s, z - a.z - d.z * s ) - this.r;

	}

	closest( x, y, z, P, N ) {

		const s = this.param( x, y, z ), { a, d } = this;
		N.set( x - a.x - d.x * s, y - a.y - d.y * s, z - a.z - d.z * s );
		let l = N.length();
		if ( l < EPS ) {

			N.set( - d.z, 0, d.x );
			if ( N.lengthSq() < EPS ) N.set( 1, 0, 0 );
			N.normalize();
			l = 0;

		} else N.divideScalar( l );
		P.set( a.x + d.x * s, a.y + d.y * s, a.z + d.z * s ).addScaledVector( N, this.r );
		return l - this.r;

	}

	// Exact for a tube: the closest points of two segments.
	segment( px, py, pz, qx, qy, qz, out ) {

		const { a, d } = this;
		const d1x = qx - px, d1y = qy - py, d1z = qz - pz;
		const rx = px - a.x, ry = py - a.y, rz = pz - a.z;
		const A = d1x * d1x + d1y * d1y + d1z * d1z, E = this.len2, F = d.x * rx + d.y * ry + d.z * rz;
		let s, t;
		if ( A <= EPS && E <= EPS ) {

			s = t = 0;

		} else if ( A <= EPS ) {

			s = 0;
			t = clamp( F / E, 0, 1 );

		} else {

			const C = d1x * rx + d1y * ry + d1z * rz;
			if ( E <= EPS ) {

				t = 0;
				s = clamp( - C / A, 0, 1 );

			} else {

				const B = d1x * d.x + d1y * d.y + d1z * d.z, den = A * E - B * B;
				s = den > EPS ? clamp( ( B * F - C * E ) / den, 0, 1 ) : 0;
				t = ( B * s + F ) / E;
				if ( t < 0 ) { t = 0; s = clamp( - C / A, 0, 1 ); } else if ( t > 1 ) { t = 1; s = clamp( ( B - C ) / A, 0, 1 ); }

			}

		}

		out.t = s;
		const x = px + d1x * s, y = py + d1y * s, z = pz + d1z * s;
		const cx = a.x + d.x * t, cy = a.y + d.y * t, cz = a.z + d.z * t;
		const N = out.normal.set( x - cx, y - cy, z - cz );
		let l = N.length();
		if ( l < EPS ) {

			N.set( - d.z, 0, d.x );
			if ( N.lengthSq() < EPS ) N.set( 1, 0, 0 );
			N.normalize();
			l = 0;

		} else N.divideScalar( l );
		out.point.set( cx, cy, cz ).addScaledVector( N, this.r );
		out.d = l - this.r;
		return out.d;

	}

	// The side of the tube first, then its rounded ends.
	ray( o, dir, far, N ) {

		if ( this.sdf( o.x, o.y, o.z ) < 0 ) return Infinity;
		const { a, b, d: ba, r } = this;
		const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
		const baba = this.len2, bard = ba.x * dir.x + ba.y * dir.y + ba.z * dir.z, baoa = ba.x * oax + ba.y * oay + ba.z * oaz;
		const rdoa = dir.x * oax + dir.y * oay + dir.z * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
		let t = Infinity;
		const k2 = baba - bard * bard;
		if ( k2 > EPS ) {

			const k1 = baba * rdoa - baoa * bard, k0 = baba * oaoa - baoa * baoa - r * r * baba, h = k1 * k1 - k2 * k0;
			if ( h >= 0 ) {

				const tb = ( - k1 - Math.sqrt( h ) ) / k2, y = baoa + tb * bard;
				if ( y > 0 && y < baba && tb >= 0 ) t = tb;

			}

		}

		if ( t === Infinity ) {

			for ( const e of [ a, b ] ) {

				const ox = o.x - e.x, oy = o.y - e.y, oz = o.z - e.z;
				const bb = ox * dir.x + oy * dir.y + oz * dir.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = bb * bb - cc;
				if ( h >= 0 ) {

					const ts = - bb - Math.sqrt( h );
					if ( ts >= 0 && ts < t ) t = ts;

				}

			}

		}

		if ( t >= far ) return Infinity;
		const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t, s = this.param( x, y, z );
		N.set( x - a.x - ba.x * s, y - a.y - ba.y * s, z - a.z - ba.z * s ).normalize();
		return t;

	}

	// The span of the axis (0–1, left in `axisSpan`) that passes over a disc of radius R, seen from above.
	span( cx, cz, R ) {

		const { a, d } = this, fx = a.x - cx, fz = a.z - cz, A = d.x * d.x + d.z * d.z;
		if ( A < EPS ) {

			if ( fx * fx + fz * fz > R * R ) return false;
			axisSpan.lo = 0; axisSpan.hi = 1;
			return true;

		}

		const B = 2 * ( fx * d.x + fz * d.z ), C = fx * fx + fz * fz - R * R, disc = B * B - 4 * A * C;
		if ( disc < 0 ) return false;
		const s = Math.sqrt( disc ), t0 = Math.max( 0, ( - B - s ) / ( 2 * A ) ), t1 = Math.min( 1, ( - B + s ) / ( 2 * A ) );
		if ( t0 > t1 ) return false;
		axisSpan.lo = t0; axisSpan.hi = t1;
		return true;

	}

	tops( cx, cz, r, out ) {

		if ( ! this.span( cx, cz, r + this.r ) ) return false;
		const y0 = this.a.y + this.d.y * axisSpan.lo, y1 = this.a.y + this.d.y * axisSpan.hi;
		out.lo = Math.min( y0, y1 ) + this.r;
		out.hi = Math.max( y0, y1 ) + this.r;
		out.normal.copy( UP );
		return true;

	}

	bottom( cx, cz, r ) {

		if ( ! this.span( cx, cz, r + this.r ) ) return Infinity;
		return Math.min( this.a.y + this.d.y * axisSpan.lo, this.a.y + this.d.y * axisSpan.hi ) - this.r;

	}

}

const axisSpan = { lo: 0, hi: 0 };
