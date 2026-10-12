/**
 * The course's meshes. Every static surface goes into one mesh with the shared look (look.js): each face carries its
 * graybox and Runner Vision colours, chosen by what the deriving found it to be (a top, a plain face, a wall to climb,
 * a vault face, a slide slope…) or by the look the course file gives the prim, and the tint slot of the affordance it
 * belongs to, so Runner Vision can turn it red. Hangable edges get a stripe along their top and face. Things that turn
 * or swing (door leaves, valve wheels, buttons, anchor rings, ropes) are meshes of their own in the same look.
 */
import * as THREE from 'three/webgpu';
import { colors } from './metrics.js';
import { Wedge } from './shapes.js';

const UP = new THREE.Vector3( 0, 1, 0 ), DOWN = new THREE.Vector3( 0, - 1, 0 );
const SURFACES = Object.fromEntries( Object.entries( colors.surfaces ).map( ( [ k, s ] ) => [ k, { graybox: new THREE.Color( s.graybox ), vision: new THREE.Color( s.vision ), hazard: k === 'hazard' ? 1 : 0 } ] ) );
// A slope's surface by its kind: walked slopes are tops, slide slopes their own colour, steeper ones faces.
const SLOPE_SURFACE = { walk: 'top', slide: 'slide', wall: 'face' };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n3 = new THREE.Matrix3();
const ONE = new THREE.Vector3( 1, 1, 1 );

// Gathers faces into one geometry with the look's attributes.
class SurfaceBuilder {

	constructor() {

		this.pos = []; this.nor = []; this.uv = []; this.gray = []; this.rv = []; this.aff = []; this.index = [];
		this.count = 0;
		this.set( 'face' );

	}

	// The surface (a key of the metrics' colours) and tint slot of the faces that follow.
	set( key, aff = 0 ) {

		const s = SURFACES[ key ] ?? SURFACES.face;
		this.graybox = s.graybox; this.vision = s.vision; this.hazard = s.hazard; this.slot = aff ?? 0;
		return this;

	}

	vertex( x, y, z, nx, ny, nz, u, v ) {

		this.pos.push( x, y, z );
		this.nor.push( nx, ny, nz );
		this.uv.push( u, v );
		this.gray.push( this.graybox.r, this.graybox.g, this.graybox.b, this.hazard );
		this.rv.push( this.vision.r, this.vision.g, this.vision.b );
		this.aff.push( this.slot );
		return this.count ++;

	}

	// A convex polygon, fanned into triangles; `uvOf( point )` gives its texture coordinates (in metres, for the grid).
	polygon( pts, n, uvOf ) {

		const i0 = this.count;
		for ( const p of pts ) {

			const [ u, v ] = uvOf( p );
			this.vertex( p.x, p.y, p.z, n.x, n.y, n.z, u, v );

		}

		for ( let k = 1; k < pts.length - 1; k ++ ) this.index.push( i0, i0 + k, i0 + k + 1 );

	}

	// A three.js geometry placed by a matrix (and disposed of: only its triangles are kept).
	geometry( geo, matrix, uvOf ) {

		const pos = geo.attributes.position, nor = geo.attributes.normal, uv0 = geo.attributes.uv, i0 = this.count;
		_n3.getNormalMatrix( matrix );
		const p = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector2();
		for ( let i = 0; i < pos.count; i ++ ) {

			p.fromBufferAttribute( pos, i ).applyMatrix4( matrix );
			n.fromBufferAttribute( nor, i ).applyMatrix3( _n3 ).normalize();
			if ( uv0 ) t.fromBufferAttribute( uv0, i );
			const [ u, v ] = uvOf( p, n, t );
			this.vertex( p.x, p.y, p.z, n.x, n.y, n.z, u, v );

		}

		if ( geo.index ) for ( let i = 0; i < geo.index.count; i ++ ) this.index.push( i0 + geo.index.getX( i ) );
		else for ( let i = 0; i < pos.count; i ++ ) this.index.push( i0 + i );
		geo.dispose();

	}

	build() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.nor, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uv, 2 ) );
		g.setAttribute( 'gray', new THREE.Float32BufferAttribute( this.gray, 4 ) );
		g.setAttribute( 'rv', new THREE.Float32BufferAttribute( this.rv, 3 ) );
		g.setAttribute( 'aff', new THREE.Float32BufferAttribute( this.aff, 1 ) );
		g.setIndex( this.count > 65535 ? new THREE.Uint32BufferAttribute( this.index, 1 ) : new THREE.Uint16BufferAttribute( this.index, 1 ) );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;

	}

}

// The look a prim forces on all its faces: out of bounds, or what the course file says.
const lookOf = ( prim ) => prim.roles.has( 'out' ) ? 'out' : prim.look ?? null;

// The look of a prim's top: its own, else the forced look when that is one a top shows too.
const topLookOf = ( prim ) => {

	const key = lookOf( prim );
	return prim.lookTop ?? ( key === 'out' || key === 'noRun' || key === 'hazard' ? key : null );

};

// The tint slot of a prim's own line or object (a pipe, a springboard), which all its faces light up with.
function ownTint( prim ) {

	const own = prim.affordances.find( ( a ) => a.collection === 'lines' || a.collection === 'objects' );
	return own ? own.tint : null;

}

// An oriented box: six quads, centre c, half extents h along ux, uy, uz.
function addBox( B, c, ux, uy, uz, h ) {

	for ( const [ axis, u1, u2, ha, h1, h2 ] of [ [ ux, uy, uz, h.x, h.y, h.z ], [ uy, uz, ux, h.y, h.z, h.x ], [ uz, ux, uy, h.z, h.x, h.y ] ] ) {

		for ( const s of [ 1, - 1 ] ) {

			const order = s > 0 ? [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] : [ [ - 1, - 1 ], [ - 1, 1 ], [ 1, 1 ], [ 1, - 1 ] ];
			const pts = order.map( ( [ a, b ] ) => c.clone().addScaledVector( axis, s * ha ).addScaledVector( u1, a * h1 ).addScaledVector( u2, b * h2 ) );
			const n = axis.clone().multiplyScalar( s );
			B.polygon( pts, n, ( p ) => [ p.dot( u1 ), p.dot( u2 ) ] );

		}

	}

}

// An upright quad along a side: from s0 to s1 along `dir` from `a0`, from y0 up to y1, facing n.
function addSide( B, a0, dir, n, s0, s1, y0, y1 ) {

	const p = ( s, y ) => new THREE.Vector3( a0.x + dir.x * s, y, a0.z + dir.z * s );
	B.polygon( [ p( s0, y0 ), p( s1, y0 ), p( s1, y1 ), p( s0, y1 ) ], n, ( q ) => [ q.x * dir.x + q.z * dir.z, q.y ] );

}

// A flat box's four sides, as derive.js walks them.
function boxSides( s ) {

	const top = s.c.y + s.h.y, out = [];
	for ( const [ axis, sign, off, hw ] of [ [ s.ux, 1, s.h.x, s.h.z ], [ s.ux, - 1, s.h.x, s.h.z ], [ s.uz, 1, s.h.z, s.h.x ], [ s.uz, - 1, s.h.z, s.h.x ] ] ) {

		const n = axis.clone().multiplyScalar( sign ).setY( 0 ).normalize(), dir = new THREE.Vector3( n.z, 0, - n.x );
		const a0 = s.c.clone().addScaledVector( n, off ).addScaledVector( dir, - hw ).setY( top );
		out.push( { n, dir, a0, length: 2 * hw } );

	}

	return out;

}

// A flat box: its top (a thin vault's top is part of the vault), its underside, and its sides face by face as derived.
function flatBox( B, prim ) {

	const s = prim.shape, { c, h, ux, uz } = s, top = c.y + h.y, bottom = c.y - h.y;
	const key = lookOf( prim ), own = ownTint( prim );
	const P = ( x, y, z ) => c.clone().addScaledVector( ux, x * h.x ).addScaledVector( UP, y * h.y ).addScaledVector( uz, z * h.z );
	const flatUV = ( p ) => [ p.dot( ux ), p.dot( uz ) ];
	B.set( topLookOf( prim ) ?? ( prim.vaultTop ? 'vault' : 'top' ), own ?? ( prim.vaultTop ? prim.tint : 0 ) );
	B.polygon( [ P( - 1, 1, - 1 ), P( - 1, 1, 1 ), P( 1, 1, 1 ), P( 1, 1, - 1 ) ], UP, flatUV );
	B.set( key ?? 'face', own ?? 0 );
	B.polygon( [ P( - 1, - 1, - 1 ), P( 1, - 1, - 1 ), P( 1, - 1, 1 ), P( - 1, - 1, 1 ) ], DOWN, flatUV );
	if ( prim.faces.length ) {

		for ( const f of prim.faces ) {

			B.set( key ?? f.kind, own ?? f.aff );
			addSide( B, f.a0, f.dir, f.n, f.s0, f.s1, bottom, top );

		}

	} else {

		B.set( key ?? 'face', own ?? 0 );
		for ( const f of boxSides( s ) ) addSide( B, f.a0, f.dir, f.n, 0, f.length, bottom, top );

	}

}

// A wedge: the slope (coloured by its kind), the base, the two triangular ends, and the back face as derived.
function wedge( B, prim ) {

	const s = prim.shape, { c, h, ux, uz } = s, top = c.y + h.y, bottom = c.y - h.y;
	const key = lookOf( prim ), own = ownTint( prim );
	const P = ( x, y, z ) => c.clone().addScaledVector( ux, x * h.x ).addScaledVector( UP, y * h.y ).addScaledVector( uz, z * h.z );
	B.set( topLookOf( prim ) ?? SLOPE_SURFACE[ prim.slope?.kind ] ?? 'top', own ?? 0 );
	B.polygon( [ P( - 1, - 1, - 1 ), P( - 1, 1, 1 ), P( 1, 1, 1 ), P( 1, - 1, - 1 ) ], s.normal, ( p ) => [ p.dot( ux ), p.y ] );
	B.set( key ?? 'face', own ?? 0 );
	B.polygon( [ P( - 1, - 1, - 1 ), P( 1, - 1, - 1 ), P( 1, - 1, 1 ), P( - 1, - 1, 1 ) ], DOWN, ( p ) => [ p.dot( ux ), p.dot( uz ) ] );
	B.polygon( [ P( 1, - 1, - 1 ), P( 1, 1, 1 ), P( 1, - 1, 1 ) ], ux, ( p ) => [ p.dot( uz ), p.y ] );
	B.polygon( [ P( - 1, - 1, - 1 ), P( - 1, - 1, 1 ), P( - 1, 1, 1 ) ], ux.clone().negate(), ( p ) => [ p.dot( uz ), p.y ] );
	if ( prim.faces.length ) {

		for ( const f of prim.faces ) {

			B.set( key ?? f.kind, own ?? f.aff );
			addSide( B, f.a0, f.dir, f.n, f.s0, f.s1, bottom, top );

		}

	} else {

		const dir = new THREE.Vector3( uz.z, 0, - uz.x ), a0 = c.clone().addScaledVector( uz, h.z ).addScaledVector( dir, - h.x ).setY( top );
		addSide( B, a0, dir, uz, 0, 2 * h.x, bottom, top );

	}

}

// A cylinder from a to b. Its sides are mapped by arc length and length (from the ground for an upright one), its caps
// by plan position, so the grid lies square on them.
function cylinder( B, a, b, r, segments = 14 ) {

	_v.subVectors( b, a );
	const len = _v.length(), dir = _v.clone().divideScalar( len );
	_q.setFromUnitVectors( UP, dir );
	_m.compose( _w.addVectors( a, b ).multiplyScalar( 0.5 ), _q, ONE );
	B.geometry( new THREE.CylinderGeometry( r, r, len, segments, 1 ), _m, ( p, n, t ) => Math.abs( n.dot( dir ) ) > 0.5 ? [ p.x, p.z ] : [ t.x * Math.PI * 2 * r, p.clone().sub( a ).dot( dir ) + ( Math.abs( dir.y ) > 0.9 ? a.y : 0 ) ] );

}

// One prim's static faces. Ropes and door leaves are meshes of their own; volumes and anchors draw nothing here.
function addPrim( B, prim, course ) {

	const s = prim.shape;
	switch ( prim.type ) {

		case 'box':
		case 'springboard':
			if ( s instanceof Wedge ) wedge( B, prim );
			else if ( s.flat ) flatBox( B, prim );
			else {

				B.set( lookOf( prim ) ?? 'face', ownTint( prim ) ?? 0 );
				addBox( B, s.c, s.ux, s.uy, s.uz, s.h );

			}

			break;
		case 'wedge': wedge( B, prim ); break;
		case 'cylinder':
			B.set( lookOf( prim ) ?? 'face', 0 );
			cylinder( B, new THREE.Vector3( s.x, s.y0, s.z ), new THREE.Vector3( s.x, s.y1, s.z ), s.r, 16 );
			break;
		case 'bar':
		case 'cable':
		case 'pipe': {

			// Drawn no thinner than 2.4 cm, so a wire still shows; a pipe is held to its wall by brackets every 1.5 m.
			const line = prim.affordances[ 0 ];
			B.set( lookOf( prim ), line.tint );
			cylinder( B, s.a, s.b, Math.max( s.r, 0.012 ), prim.type === 'pipe' ? 12 : 8 );
			if ( prim.type === 'pipe' && line.pipe.n && line.pipe.wallGap ) {

				B.set( 'face', 0 );
				const n = line.pipe.n, gap = line.pipe.wallGap, side = new THREE.Vector3( n.z, 0, - n.x );
				const len = s.a.distanceTo( s.b );
				for ( let d = 0.4; d < len; d += 1.5 ) {

					const p = s.a.clone().lerp( s.b, d / len ).addScaledVector( n, - gap / 2 );
					addBox( B, p, side, UP, n, new THREE.Vector3( 0.03, 0.02, gap / 2 ) );

				}

			}

			break;

		}

		case 'beam': {

			B.set( lookOf( prim ), ownTint( prim ) );
			addBox( B, s.c, s.ux, s.uy, s.uz, s.h );
			break;

		}

		case 'ladder': ladder( B, prim, course ); break;
		case 'door': doorFrame( B, prim ); break;
		case 'valve': valveStem( B, prim ); break;
		case 'button': buttonPlate( B, prim ); break;

	}

}

// Two rails (running on past the top to climb out between) and the rungs.
function ladder( B, prim, course ) {

	const line = prim.affordances[ 0 ], { width, n, rungs } = line.ladder, a = line.a;
	const ux = new THREE.Vector3( n.z, 0, - n.x ), top = line.b.y + course.metrics.ladder.rails;
	B.set( lookOf( prim ), line.tint );
	for ( const s of [ - 1, 1 ] ) {

		const c = a.clone().addScaledVector( ux, s * width / 2 ).setY( ( a.y + top ) / 2 );
		addBox( B, c, ux, UP, n, new THREE.Vector3( 0.025, ( top - a.y ) / 2, 0.03 ) );

	}

	for ( const y of rungs ) cylinder( B, a.clone().addScaledVector( ux, - width / 2 ).setY( y ), a.clone().addScaledVector( ux, width / 2 ).setY( y ), 0.016, 8 );

}

// The frame round a door's opening: two posts and a head, a centimetre proud of the wall all round (the opening's
// sides and the wall's faces), so none of its faces lies in one of the wall's: those would flicker.
function doorFrame( B, prim ) {

	const o = prim.affordances[ 0 ], ux = new THREE.Vector3( Math.cos( o.yaw ), 0, - Math.sin( o.yaw ) ), depth = ( prim.def.wall?.depth ?? 0.12 ) / 2 + 0.01;
	B.set( 'face', 0 );
	for ( const s of [ - 1, 1 ] ) addBox( B, o.p.clone().addScaledVector( ux, s * ( o.width / 2 + 0.025 ) ).setY( o.p.y + o.height / 2 ), ux, UP, o.n, new THREE.Vector3( 0.035, o.height / 2, depth ) );
	addBox( B, o.p.clone().setY( o.p.y + o.height + 0.025 ), ux, UP, o.n, new THREE.Vector3( o.width / 2 + 0.06, 0.035, depth ) );

}

// The stem a valve wheel turns on, out from the wall.
function valveStem( B, prim ) {

	const o = prim.affordances[ 0 ], n = o.n;
	B.set( lookOf( prim ), o.tint );
	cylinder( B, o.p.clone().addScaledVector( n, - 0.16 ), o.p.clone().addScaledVector( n, - 0.02 ), 0.03, 10 );

}

// The plate a button sits in.
function buttonPlate( B, prim ) {

	const o = prim.affordances[ 0 ], n = o.n, u = new THREE.Vector3( n.z, 0, - n.x );
	B.set( lookOf( prim ), o.tint );
	addBox( B, o.p.clone().addScaledVector( n, - 0.015 ), u, UP, n, new THREE.Vector3( o.size, o.size, 0.015 ) );

}

// A valve's wheel: a rim, two spokes and a hub, facing out of the wall.
function valveWheel( o, material ) {

	const B = new SurfaceBuilder().set( 'interact', o.tint ), r = o.r, Z = new THREE.Vector3( 0, 0, 1 ), X = new THREE.Vector3( 1, 0, 0 ), Y = new THREE.Vector3( 0, 1, 0 );
	B.geometry( new THREE.TorusGeometry( r, 0.022, 8, 28 ), new THREE.Matrix4(), ( p, nn, t ) => [ t.x * 2 * Math.PI * r, t.y ] );
	addBox( B, new THREE.Vector3(), X, Y, Z, new THREE.Vector3( r, 0.012, 0.012 ) );
	addBox( B, new THREE.Vector3(), Y, X.clone().negate(), Z, new THREE.Vector3( r, 0.012, 0.012 ) );
	cylinder( B, new THREE.Vector3( 0, 0, - 0.02 ), new THREE.Vector3( 0, 0, 0.03 ), 0.035, 12 );
	const mesh = new THREE.Mesh( B.build(), material );
	mesh.position.copy( o.p );
	mesh.quaternion.setFromUnitVectors( Z, o.n );
	mesh.castShadow = mesh.receiveShadow = true;
	mesh.name = `valve ${o.id}`;
	return mesh;

}

function buttonCap( o, material ) {

	const B = new SurfaceBuilder().set( 'interact', o.tint );
	cylinder( B, new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, 0.04 ), o.size / 2, 16 );
	const mesh = new THREE.Mesh( B.build(), material );
	mesh.position.copy( o.p );
	mesh.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 0, 1 ), o.n );
	mesh.castShadow = mesh.receiveShadow = true;
	mesh.name = `button ${o.id}`;
	return mesh;

}

// The stripe on a hangable edge: `w` wide on the top (no deeper than the top is) and down the face when there is that
// much face.
function stripe( S, e, w ) {

	const lift = 0.002, n = e.n, dir = e.dir, y = e.y;
	S.set( 'edge', e.tint );
	const at = ( p, dn, dy ) => new THREE.Vector3( p.x + n.x * dn, y + dy, p.z + n.z * dn );
	const inset = Math.min( w, e.depth );
	S.polygon( [ at( e.a, 0, lift ), at( e.b, 0, lift ), at( e.b, - inset, lift ), at( e.a, - inset, lift ) ], UP, ( p ) => [ p.x * dir.x + p.z * dir.z, p.x * n.x + p.z * n.z ] );
	if ( e.face >= w ) S.polygon( [ at( e.a, lift, - w ), at( e.b, lift, - w ), at( e.b, lift, 0 ), at( e.a, lift, 0 ) ], n, ( p ) => [ p.x * dir.x + p.z * dir.z, p.y ] );

}

// A door leaf (with a handle each side) or a panel (with a grip on its face), hung from its hinge side.
function doorLeaf( o, material ) {

	const B = new SurfaceBuilder().set( 'interact', o.tint );
	const w = o.width - 0.02, h = o.height - 0.01, th = 0.05;
	const X = new THREE.Vector3( 1, 0, 0 ), Z = new THREE.Vector3( 0, 0, 1 );
	addBox( B, new THREE.Vector3( 0.01 + w / 2, h / 2, 0 ), X, UP, Z, new THREE.Vector3( w / 2, h / 2, th / 2 ) );
	B.set( 'face', o.tint );
	if ( o.kind === 'door' ) for ( const s of [ - 1, 1 ] ) addBox( B, new THREE.Vector3( w - 0.1, 1.0, s * ( th / 2 + 0.03 ) ), X, UP, Z, new THREE.Vector3( 0.07, 0.015, 0.015 ) );
	else addBox( B, new THREE.Vector3( 0.01 + w / 2, h / 2, - th / 2 - 0.02 ), X, UP, Z, new THREE.Vector3( 0.06, 0.06, 0.02 ) );
	const mesh = new THREE.Mesh( B.build(), material );
	mesh.position.set( o.hinge.x, o.p.y, o.hinge.z );
	mesh.quaternion.setFromAxisAngle( UP, o.yaw );
	mesh.castShadow = mesh.receiveShadow = true;
	mesh.name = `${o.kind} ${o.id}`;
	return mesh;

}

// An anchor: a ring on a plate.
function anchorRing( o, material ) {

	const B = new SurfaceBuilder().set( 'interact', o.tint ), Z = new THREE.Vector3( 0, 0, 1 ), X = new THREE.Vector3( 1, 0, 0 );
	B.geometry( new THREE.TorusGeometry( 0.09, 0.018, 8, 20 ), new THREE.Matrix4().makeTranslation( 0, 0, 0.06 ), ( p, nn, t ) => [ t.x * 2 * Math.PI * 0.09, t.y ] );
	addBox( B, new THREE.Vector3( 0, 0, 0.01 ), X, UP, Z, new THREE.Vector3( 0.12, 0.12, 0.01 ) );
	const mesh = new THREE.Mesh( B.build(), material );
	mesh.position.copy( o.p );
	mesh.quaternion.setFromUnitVectors( Z, o.n );
	mesh.castShadow = mesh.receiveShadow = true;
	mesh.name = `anchor ${o.id}`;
	return mesh;

}

// A rope: a unit-long cylinder, aimed and stretched from its top to its end.
function ropeMesh( material, { tint = 0, r = 0.02, key = 'swing' } = {} ) {

	const B = new SurfaceBuilder().set( key, tint );
	cylinder( B, new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 1, 0 ), Math.max( r, 0.012 ), 8 );
	const mesh = new THREE.Mesh( B.build(), material );
	mesh.castShadow = true;
	mesh.name = 'rope';
	return mesh;

}

/** Points a rope's mesh from its top `a` to its end `b`, stretched to reach. */
export function aimRope( mesh, a, b ) {

	_v.subVectors( b, a );
	const len = Math.max( 1e-3, _v.length() );
	mesh.position.copy( a );
	mesh.quaternion.setFromUnitVectors( UP, _v.divideScalar( len ) );
	mesh.scale.set( 1, len, 1 );

}

/**
 * Builds a course's meshes into its group: the surfaces, the edge stripes, and each object's and rope's own mesh
 * (kept on the affordance as `mesh`).
 * @param {Course} course
 */
export function buildMeshes( course ) {

	const look = course.look, B = new SurfaceBuilder(), S = new SurfaceBuilder();
	for ( const prim of course.prims ) addPrim( B, prim, course );
	for ( const e of course.edges ) if ( e.hangable ) stripe( S, e, course.metrics.colors.stripe );

	const mesh = new THREE.Mesh( B.build(), look.material );
	mesh.name = 'course surfaces';
	mesh.castShadow = mesh.receiveShadow = true;
	course.group.add( mesh );
	if ( S.count ) {

		const stripes = new THREE.Mesh( S.build(), look.stripe );
		stripes.name = 'course stripes';
		stripes.receiveShadow = true;
		course.group.add( stripes );

	}

	const parts = { door: doorLeaf, panel: doorLeaf, valve: valveWheel, button: buttonCap, anchor: anchorRing };
	for ( const o of course.objects ) {

		if ( ! parts[ o.kind ] ) continue;
		o.mesh = parts[ o.kind ]( o, look.material );
		course.group.add( o.mesh );

	}

	for ( const l of course.lines ) {

		if ( l.kind !== 'rope' ) continue;
		l.mesh = ropeMesh( look.material, { tint: l.tint, r: l.r } );
		aimRope( l.mesh, l.a, l.b );
		course.group.add( l.mesh );

	}

}
