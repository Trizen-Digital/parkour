/**
 * Reading a course file's prims. Each authored prim becomes one or more course prims (a solid shape with roles, or a
 * prim with no shape for things that are only an affordance) and the affordances it is authored as: a bar, a pipe, a
 * cable, a beam, a rope and a ladder are lines; anchors, valves, buttons, springboards and doors are objects; volumes
 * are volumes. Edges, walls and slopes are not authored: `derive.js` finds them on the solids afterwards.
 *
 * Course files are in metres with yaw in degrees (a prim at yaw 0 faces +z).
 */
import * as THREE from 'three/webgpu';
import { DEG } from '@trizendigital/parkour/math.js';
import { Box, Cylinder, Tube, Wedge } from './shapes.js';

const UP = new THREE.Vector3( 0, 1, 0 );

const vec = ( a, fallback = [ 0, 0, 0 ] ) => new THREE.Vector3().fromArray( a ?? fallback );
const yawTurn = ( yaw ) => new THREE.Quaternion().setFromAxisAngle( UP, yaw );
const facing = ( yaw ) => new THREE.Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );

/**
 * Reads one authored prim into the course.
 * @param {Course} course
 * @param {Object} d The prim as written in the course file.
 * @param {Array<Function>} fittings Steps that need the course's solids in place first (a bar's posts and a cable's
 * gantries stand on the ground under them; a pipe finds the wall behind it); the course runs them after indexing.
 * @return {Object|null} The prim, or null for an unknown type.
 */
export function readPrim( course, d, fittings ) {

	const read = READERS[ d.type ];
	if ( read ) return read( course, d, fittings );
	console.warn( `course ${course.name}: unknown prim type '${d.type}'`, d );
	return null;

}

const READERS = {

	// A box by its corners (`min`, `max`) or by `p` (the middle of its base), `size` [ width, height, length ] and yaw.
	box( course, d ) {

		const { centre, half, yaw } = placeBox( d );
		return course.addPrim( 'box', d, new Box( centre, yawTurn( yaw ), half ), { derive: true } );

	},

	// A slope rising toward +z (turned by its yaw), `size` [ width, height, length ], its base's middle at `p`.
	wedge( course, d ) {

		const p = vec( d.p ), [ w, h, l ] = d.size;
		return course.addPrim( 'wedge', d, new Wedge( p.clone().setY( p.y + h / 2 ), ( d.yaw ?? 0 ) * DEG, new THREE.Vector3( w / 2, h / 2, l / 2 ) ), { derive: true } );

	},

	// An upright cylinder standing at `p`: a post or a pole (thin and tall enough, the world makes it a pole).
	cylinder( course, d ) {

		const p = vec( d.p );
		return course.addPrim( 'cylinder', d, new Cylinder( p.x, p.z, d.r ?? 0.1, p.y, p.y + ( d.h ?? 1 ) ) );

	},

	// A swing bar from `a` to `b`, 5 cm thick unless given; `posts` stands it on a post at each end.
	bar( course, d, fittings ) {

		const a = vec( d.a ), b = vec( d.b ), r = d.r ?? 0.025;
		const prim = course.addPrim( 'bar', d, new Tube( a, b, r ), { look: 'swing', roles: [ 'bar' ] } );
		course.addAffordance( 'lines', { kind: 'bar', prim, a, b, r, usable: true } );
		if ( d.posts ) fittings.push( () => {

			for ( const [ end, side ] of [ [ a, 'L' ], [ b, 'R' ] ] ) addPost( course, prim, end, r, side );

		} );
		return prim;

	},

	// A drainpipe from `a` to `b` (12 cm across unless given). `n` points from the wall out to where the runner
	// climbs; without it the pipe finds the nearest wall itself.
	pipe( course, d, fittings ) {

		const a = vec( d.a ), b = vec( d.b ), r = d.r ?? 0.06;
		const prim = course.addPrim( 'pipe', d, new Tube( a, b, r ), { look: 'climb', roles: [ 'pipe' ] } );
		const line = course.addAffordance( 'lines', { kind: 'pipe', prim, a, b, r, pipe: { n: d.n ? vec( d.n ).normalize() : null, wallGap: null } } );
		fittings.push( () => findPipeWall( course, line ) );
		return prim;

	},

	// A cable between `a` and `b`. Steeper than 1° it is a zipline (ridden from its high end), flatter a wire to
	// balance on, unless `kind` says. `anchors` puts a gantry at each end.
	cable( course, d, fittings ) {

		const a = vec( d.a ), b = vec( d.b ), r = d.r ?? 0.015;
		const prim = course.addPrim( 'cable', d, new Tube( a, b, r ), { look: 'swing', roles: [ 'cable' ] } );
		const [ high, low ] = a.y >= b.y ? [ a, b ] : [ b, a ];
		const slope = Math.atan2( high.y - low.y, Math.hypot( high.x - low.x, high.z - low.z ) ) / DEG;
		course.addAffordance( 'lines', { kind: 'cable', prim, a, b, r, cable: { high, low, slope, kind: d.kind ?? ( slope > 1 ? 'zipline' : 'wire' ) } } );
		if ( d.anchors ) fittings.push( () => {

			addGantry( course, prim, high, low, 'high' );
			addGantry( course, prim, low, high, 'low' );

		} );
		return prim;

	},

	// A balance beam whose top runs from `a` to `b`: a box `width` across and `thickness` deep under that line.
	beam( course, d ) {

		const a = vec( d.a ), b = vec( d.b ), width = d.width ?? 0.1, thickness = d.thickness ?? 0.1;
		const along = b.clone().sub( a ).normalize(), across = new THREE.Vector3( along.z, 0, - along.x );
		if ( across.lengthSq() < 1e-12 ) across.set( 1, 0, 0 );
		across.normalize();
		const up = along.clone().cross( across );
		const turn = new THREE.Quaternion().setFromRotationMatrix( new THREE.Matrix4().makeBasis( across, up, along ) );
		const centre = a.clone().add( b ).multiplyScalar( 0.5 ).addScaledVector( up, - thickness / 2 );
		const prim = course.addPrim( 'beam', d, new Box( centre, turn, new THREE.Vector3( width / 2, thickness / 2, a.distanceTo( b ) / 2 ) ), { look: 'balance', roles: [ 'beam' ] } );
		course.addAffordance( 'lines', { kind: 'beam', prim, a, b, r: width / 2, beam: { width } } );
		return prim;

	},

	// A rope hanging from `a`, to `b` or `length` below it. Nothing collides with it: it swings.
	rope( course, d ) {

		const a = vec( d.a ), b = d.b ? vec( d.b ) : a.clone().setY( a.y - ( d.length ?? 3 ) ), r = d.r ?? 0.02;
		const prim = course.addPrim( 'rope', d, new Tube( a, b, r ), { look: 'swing', collide: false, roles: [ 'rope' ] } );
		course.addAffordance( 'lines', { kind: 'rope', prim, a, b, r } );
		return prim;

	},

	// A flight of stairs climbing along its yaw from `p`. Each step is a solid box from the base up to its tread, so
	// the flight has no gaps underneath to snag on.
	stairs( course, d ) {

		const p = vec( d.p ), yaw = ( d.yaw ?? 0 ) * DEG, width = d.width ?? 2, rise = d.rise ?? 0.25, run = d.run ?? 0.3;
		const steps = d.steps ?? Math.round( ( d.h ?? 3 ) / rise ), forward = facing( yaw );
		const prim = course.addPrim( 'stairs', d, null );
		for ( let k = 1; k <= steps; k ++ ) {

			const c = p.clone().addScaledVector( forward, run * ( k - 0.5 ) ).setY( p.y + rise * k / 2 );
			course.addPrim( 'box', { roles: [ 'stairs', ...( d.roles ?? [] ) ] }, new Box( c, yawTurn( yaw ), new THREE.Vector3( width / 2, rise * k / 2, run / 2 ) ), { id: `${prim.id}/step${k}`, parent: prim, derive: true } );

		}

		return prim;

	},

	// A ladder `h` high against a wall, facing along its yaw (out from the wall). Its rails run on past the top, by
	// the metrics' rail height, to climb out between.
	ladder( course, d ) {

		const m = course.metrics;
		const p = vec( d.p ), h = d.h ?? 3, yaw = ( d.yaw ?? 0 ) * DEG, width = d.width ?? 0.5, spacing = d.rungs ?? m.ladder.rungs;
		const n = facing( yaw ), rails = m.ladder.rails;
		const centre = p.clone().setY( p.y + ( h + rails ) / 2 );
		const prim = course.addPrim( 'ladder', d, new Box( centre, yawTurn( yaw ), new THREE.Vector3( width / 2 + 0.03, ( h + rails ) / 2, 0.04 ) ), { look: 'climb', roles: [ 'ladder' ] } );
		const rungs = [];
		for ( let y = p.y + spacing; y <= p.y + h + 1e-6; y += spacing ) rungs.push( y );
		course.addAffordance( 'lines', { kind: 'ladder', prim, a: p.clone(), b: p.clone().setY( p.y + h ), r: 0.016, ladder: { rungs, width, n, spacing } } );
		return prim;

	},

	door( course, d ) {

		return readDoor( course, d, 'door' );

	},

	// A breakable panel: a door in every way but its name.
	panel( course, d ) {

		return readDoor( course, d, 'panel' );

	},

	// A point to fire the rope at: a swing anchor overhead (faces down) or a pull-up anchor on an edge (faces out).
	anchor( course, d ) {

		const p = vec( d.p ), form = d.form ?? 'swing', yaw = ( d.yaw ?? 0 ) * DEG;
		const n = form === 'swing' ? new THREE.Vector3( 0, - 1, 0 ) : facing( yaw );
		const prim = course.addPrim( 'anchor', d, null, { look: 'interact', roles: [ 'anchor' ] } );
		course.addAffordance( 'objects', { kind: 'anchor', prim, p, form, n, yaw } );
		return prim;

	},

	valve( course, d ) {

		return readSwitch( course, d, { r: d.r ?? 0.2 } );

	},

	button( course, d ) {

		return readSwitch( course, d, { size: d.size ?? 0.12 } );

	},

	// A springboard at `p` facing along its yaw: a box step, or a `plank` ramp (a wedge) at a roof's edge. Its object
	// sits where the runner takes off from it: on the step's top, or near the plank's high end.
	springboard( course, d ) {

		const p = vec( d.p ), [ w, h, l ] = d.size ?? [ 1.2, 0.6, 0.6 ], yaw = ( d.yaw ?? 0 ) * DEG, form = d.form ?? 'step';
		const half = new THREE.Vector3( w / 2, h / 2, l / 2 ), centre = p.clone().setY( p.y + h / 2 );
		const shape = form === 'plank' ? new Wedge( centre, yaw, half ) : new Box( centre, yawTurn( yaw ), half );
		const prim = course.addPrim( 'springboard', d, shape, { derive: true, look: 'vault', lookTop: 'vault', roles: [ 'springboard' ] } );
		const forward = facing( yaw );
		const top = form === 'plank' ? p.clone().addScaledVector( forward, l / 2 - 0.15 ).setY( p.y + h * ( 1 - 0.15 / l ) ) : p.clone().setY( p.y + h );
		course.addAffordance( 'objects', { kind: 'springboard', prim, p: top, n: forward, yaw, form, height: h, size: [ w, h, l ] } );
		return prim;

	},

	// A box of space that does something when entered: `kill`, a named `trigger` (a "finish" one ends the route).
	volume( course, d ) {

		const box = d.min ? new THREE.Box3( vec( d.min ), vec( d.max ) ) : new THREE.Box3().setFromCenterAndSize( vec( d.p ).setY( d.p[ 1 ] + d.size[ 1 ] / 2 ), vec( d.size ) );
		const prim = course.addPrim( 'volume', d, null, { roles: [ d.kind ?? 'trigger' ] } );
		course.addAffordance( 'volumes', { kind: d.kind ?? 'trigger', prim, box, name: d.name ?? null, usable: false } );
		return prim;

	},

};

function placeBox( d ) {

	if ( d.min ) {

		const min = vec( d.min ), max = vec( d.max );
		return { centre: min.clone().add( max ).multiplyScalar( 0.5 ), half: max.clone().sub( min ).multiplyScalar( 0.5 ), yaw: 0 };

	}

	const p = vec( d.p ), [ w, h, l ] = d.size;
	return { centre: p.clone().setY( p.y + h / 2 ), half: new THREE.Vector3( w / 2, h / 2, l / 2 ), yaw: ( d.yaw ?? 0 ) * DEG };

}

// A door (or panel) `width` × `height` at `p`, opening along its yaw. With `wall` it sits in a wall of that size:
// solid pieces either side and a lintel over it when the wall is taller than the door. The leaf is a solid of its own,
// 1 cm clear of the frame, drawn as its own mesh.
function readDoor( course, d, kind ) {

	const p = vec( d.p ), yaw = ( d.yaw ?? 0 ) * DEG, width = d.width ?? 1, height = d.height ?? 2.2, thickness = 0.05;
	const n = facing( yaw ), across = new THREE.Vector3( Math.cos( yaw ), 0, - Math.sin( yaw ) );
	const prim = course.addPrim( 'door', d, null, { look: 'interact', roles: [ 'door' ] } );
	if ( d.wall ) {

		const { width: wallWidth, height: wallHeight, depth = 0.3 } = d.wall, side = ( wallWidth - width ) / 2;
		const piece = ( name, x, y, sx, sy ) => {

			const c = p.clone().addScaledVector( across, x ).setY( p.y + y );
			course.addPrim( 'box', { roles: d.roles }, new Box( c, yawTurn( yaw ), new THREE.Vector3( sx / 2, sy / 2, depth / 2 ) ), { id: `${prim.id}/${name}`, parent: prim, derive: true } );

		};

		piece( 'wallL', - ( width + side ) / 2, wallHeight / 2, side, wallHeight );
		piece( 'wallR', ( width + side ) / 2, wallHeight / 2, side, wallHeight );
		if ( wallHeight > height ) piece( 'lintel', 0, ( height + wallHeight ) / 2, width, wallHeight - height );

	}

	course.addPrim( 'leaf', {}, new Box( p.clone().setY( p.y + height / 2 - 0.005 ), yawTurn( yaw ), new THREE.Vector3( width / 2 - 0.01, height / 2 - 0.005, thickness / 2 ) ), { id: `${prim.id}/leaf`, parent: prim, roles: [ 'decor', 'door' ], look: 'interact' } );
	course.addAffordance( 'objects', { kind, prim, p: p.clone(), n, yaw, width, height, hinge: p.clone().addScaledVector( across, - width / 2 ) } );
	return prim;

}

// A valve wheel or a button on a wall at `p`, facing out along its yaw.
function readSwitch( course, d, size ) {

	const p = vec( d.p ), yaw = ( d.yaw ?? 0 ) * DEG;
	const prim = course.addPrim( d.type, d, null, { look: 'interact', roles: [ d.type ] } );
	course.addAffordance( 'objects', { kind: d.type, prim, p, n: facing( yaw ), yaw, ...size } );
	return prim;

}

// A post under one end of a bar, down to the ground (or 3 m when there is none).
function addPost( course, bar, end, r, side ) {

	const ground = course.groundAt( end.x, end.z, end.y - r - 0.01 );
	const bottom = ground ? ground.y : end.y - 3;
	const prim = course.addPrim( 'cylinder', { roles: [ 'decor' ] }, new Cylinder( end.x, end.z, 0.05, bottom, end.y - r ), { id: `${bar.id}/post${side}`, parent: bar } );
	course.index( prim );

}

// A gantry over one end of a cable: two posts 0.75 m either side of it and a crossbar just above the cable.
function addGantry( course, cable, end, other, name ) {

	const along = new THREE.Vector3( other.x - end.x, 0, other.z - end.z ).normalize(), side = new THREE.Vector3( - along.z, 0, along.x );
	const top = end.y + 0.12, half = 0.75;
	for ( const s of [ - 1, 1 ] ) {

		const x = end.x + side.x * half * s, z = end.z + side.z * half * s;
		const ground = course.groundAt( x, z, end.y );
		const prim = course.addPrim( 'cylinder', { roles: [ 'decor' ] }, new Cylinder( x, z, 0.06, ground ? ground.y : end.y - 3, top + 0.06 ), { id: `${cable.id}/${name}${s > 0 ? 'R' : 'L'}`, parent: cable } );
		course.index( prim );

	}

	const yaw = Math.atan2( side.x, side.z );
	const crossbar = course.addPrim( 'box', { roles: [ 'decor' ] }, new Box( end.clone().setY( top ), yawTurn( yaw ), new THREE.Vector3( 0.05, 0.05, half + 0.06 ) ), { id: `${cable.id}/${name}Bar`, parent: cable } );
	course.index( crossbar );

}

// The wall behind a pipe and the gap to it, which says whether the pipe can be climbed (METRICS: 0.10–0.25 m off the
// wall). With `n` given, one ray back from the pipe; otherwise rays all round it, the nearest wall that isn't the pipe.
function findPipeWall( course, line ) {

	const mid = line.a.clone().add( line.b ).multiplyScalar( 0.5 ), skin = line.r + 0.001;
	if ( line.pipe.n ) {

		const hit = course.raycast( mid.clone().addScaledVector( line.pipe.n, - skin ), line.pipe.n.clone().negate(), 1 );
		line.pipe.wallGap = hit ? hit.distance + skin : null;
		return;

	}

	let best = null;
	for ( let i = 0; i < 16; i ++ ) {

		const a = i / 16 * Math.PI * 2, dir = new THREE.Vector3( Math.sin( a ), 0, Math.cos( a ) );
		const hit = course.raycast( mid.clone().addScaledVector( dir, skin ), dir, 0.6 );
		if ( hit && hit.prim !== line.prim && ( ! best || hit.distance + skin < best.d ) ) best = { d: hit.distance + skin, n: hit.normal.clone() };

	}

	line.pipe.n = best ? best.n.setY( 0 ).normalize() : null;
	line.pipe.wallGap = best ? best.d : null;

}
