/**
 * Runner Vision: the route ahead shown on the course as the runner moves. In the Classic view the next two moves'
 * affordances fade in red as the runner nears them (the next one fully, the one after at half); in the Full view, where
 * everything usable is red already, a red ribbon runs along the planned route for 40 m ahead, its light flowing
 * forward. The plan is remade four times a second, or sooner when the runner has moved on 1.5 m.
 */
import * as THREE from 'three/webgpu';
import { color, float, fract, mix, smoothstep, time, uv } from 'three/tsl';
import { colors } from './metrics.js';

// How much of the route the trail shows (m), its width, and the most points it holds.
const AHEAD = 40;
const RIBBON = 0.16;
const MAX = 768;
// A move's tint fades in from FAR metres away and is full from NEAR.
const FAR = 30, NEAR = 8;
// The tints follow their goal on a critically damped spring of this angular frequency (rad/s): quick, no overshoot.
const OMEGA = 10;

const _a = new THREE.Vector3(), _side = new THREE.Vector3();

// The ribbon along the route: a strip of quads 6 cm over the path, its u coordinate the distance along it.
class Trail {

	constructor() {

		this.positions = new Float32Array( MAX * 2 * 3 );
		this.uvs = new Float32Array( MAX * 2 * 2 );
		const index = [];
		for ( let i = 0; i < MAX - 1; i ++ ) {

			const a = i * 2;
			index.push( a, a + 2, a + 1, a + 1, a + 2, a + 3 );

		}

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( this.positions, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'uv', new THREE.BufferAttribute( this.uvs, 2 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setIndex( index );
		g.setDrawRange( 0, 0 );
		const m = new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide } );
		const t = uv();
		// Bands of white flowing forward along the red, fading toward the trail's far end.
		const flow = smoothstep( 0.35, 0.5, fract( t.x.mul( 0.5 ).sub( time.mul( 1.5 ) ) ) ).mul( 0.35 );
		m.colorNode = mix( color( colors.red ), color( 0xffffff ), flow ).mul( float( 1 ).sub( smoothstep( AHEAD * 0.6, AHEAD, t.x ).mul( 0.6 ) ) );
		this.mesh = new THREE.Mesh( g, m );
		this.mesh.name = 'runner vision trail';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.visible = false;
		this.mesh.renderOrder = 2;

	}

	set( points ) {

		const P = this.positions, U = this.uvs;
		let n = 0, along = 0;
		_side.set( 1, 0, 0 );
		for ( let i = 0; i < points.length && n < MAX; i ++ ) {

			const p = points[ i ];
			if ( i > 0 ) along += p.distanceTo( points[ i - 1 ] );
			if ( along > AHEAD ) break;
			const q = points[ Math.min( i + 1, points.length - 1 ) ], o = points[ Math.max( i - 1, 0 ) ];
			_a.subVectors( q, o ).setY( 0 );
			if ( _a.lengthSq() > 1e-6 ) _side.set( - _a.z, 0, _a.x ).normalize();
			for ( const s of [ - 1, 1 ] ) {

				const k = n * 2 + ( s > 0 ? 1 : 0 );
				P[ k * 3 ] = p.x + _side.x * s * RIBBON / 2;
				P[ k * 3 + 1 ] = p.y + 0.06;
				P[ k * 3 + 2 ] = p.z + _side.z * s * RIBBON / 2;
				U[ k * 2 ] = along;
				U[ k * 2 + 1 ] = s > 0 ? 1 : 0;

			}

			n ++;

		}

		const g = this.mesh.geometry;
		g.attributes.position.needsUpdate = true;
		g.attributes.uv.needsUpdate = true;
		g.setDrawRange( 0, Math.max( 0, n - 1 ) * 6 );
		this.mesh.visible = n > 1;

	}

	hide() {

		this.mesh.visible = false;

	}

}

export class Vision {

	/** @param {Course} course */
	constructor( course ) {

		this.course = course;
		// The tint of each highlighted slot: its weight `w`, its rate `v`, and the `goal` it heads for.
		this.tints = new Map();
		this.steps = [];
		this.moves = [];
		this.target = null;
		this.timer = 0;
		this.at = new THREE.Vector3( Infinity, 0, 0 );
		this.points = [];
		this.trail = null;
		this.heading = new THREE.Vector3();

	}

	/**
	 * Follows a runner: replans when due, then draws the view's Runner Vision.
	 * @param {THREE.Vector3} position
	 * @param {THREE.Vector3} velocity
	 * @param {number} dt (s)
	 * @return {Object|null} The next target on the route.
	 */
	update( position, velocity, dt ) {

		const course = this.course, route = course.route, mode = course.look.mode;
		if ( ! route ) return null;
		this.timer -= dt;
		if ( this.timer <= 0 || position.distanceToSquared( this.at ) > 2.25 ) {

			this.timer = 0.25;
			this.at.copy( position );
			// Standing still, the plan keeps facing the way the runner last moved.
			const v = Math.hypot( velocity.x, velocity.z ) > 0.3 ? velocity : this.heading;
			this.steps = route.planSteps( position, v );
			this.target = route.nextTarget( position, v, this.steps );
			this.moves = route.nextMoves( position, v, this.steps, 2 );

		}

		const sp = Math.hypot( velocity.x, velocity.z );
		if ( sp > 0.3 ) this.heading.set( velocity.x / sp, 0, velocity.z / sp );
		this.fadeTints( position, mode === 'classic', dt );
		if ( mode === 'full' ) this.drawTrail( position );
		else this.trail?.hide();
		return this.target;

	}

	// The Classic view's tints: each next move's usable affordances head for a weight by how near the move starts.
	fadeTints( position, on, dt ) {

		const look = this.course.look;
		for ( const t of this.tints.values() ) t.goal = 0;
		if ( on ) {

			this.moves.forEach( ( link, k ) => {

				const d = link.from.p.distanceTo( position );
				const w = ( k === 0 ? 1 : 0.5 ) * THREE.MathUtils.smootherstep( FAR - d, 0, FAR - NEAR );
				for ( const a of link.affordances ) {

					if ( ! a.usable ) continue;
					const t = this.tints.get( a.tint ) ?? { w: 0, v: 0, goal: 0 };
					t.goal = Math.max( t.goal, w );
					this.tints.set( a.tint, t );

				}

			} );

		}

		// A long frame is taken as a thirtieth of a second, so the spring stays steady.
		const h = Math.min( dt, 1 / 30 );
		for ( const [ index, t ] of this.tints ) {

			t.v += ( - 2 * OMEGA * t.v - OMEGA * OMEGA * ( t.w - t.goal ) ) * h;
			t.w = Math.min( 1, Math.max( 0, t.w + t.v * h ) );
			look.tint( index, t.w );
			if ( t.goal === 0 && t.w < 1e-3 ) {

				look.tint( index, 0 );
				this.tints.delete( index );

			}

		}

		look.flush();

	}

	// The trail from the runner along the plan: from the point of the first link's path past the nearest one onward.
	drawTrail( position ) {

		if ( ! this.trail ) {

			this.trail = new Trail();
			this.course.group.add( this.trail.mesh );

		}

		const pts = this.points;
		pts.length = 0;
		pts.push( position );
		let first = true;
		for ( const s of this.steps ) {

			const path = s.link.path;
			let i = 0;
			if ( first ) {

				let best = Infinity;
				for ( let j = 0; j < path.length; j ++ ) {

					const d = path[ j ].distanceToSquared( position );
					if ( d < best ) {

						best = d;
						i = j;

					}

				}

				i = Math.min( i + 1, path.length - 1 );
				first = false;

			}

			for ( ; i < path.length; i ++ ) pts.push( path[ i ] );

		}

		this.trail.set( pts );

	}

	/** Takes every tint off and hides the trail. */
	clear() {

		for ( const index of this.tints.keys() ) this.course.look.tint( index, 0 );
		this.tints.clear();
		this.course.look.flush();
		this.trail?.hide();

	}

	dispose() {

		this.trail?.mesh.geometry.dispose();
		this.trail?.mesh.material.dispose();

	}

}
