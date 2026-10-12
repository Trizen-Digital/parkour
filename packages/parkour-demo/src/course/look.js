/**
 * The courses' look: one material for every course surface, switching between the graybox (each kind of surface its
 * own hue, hazards striped) and Runner Vision (a white world where what is usable turns red), and the red highlight
 * that Runner Vision lays on the next moves.
 *
 * Each vertex carries its graybox colour (`gray`, with the hazard stripes' weight in w), its Runner Vision colour
 * (`rv`) and the tint slot of the affordance it belongs to (`aff`, 0 for none; mesh.js writes them). A small texture
 * holds a texel per slot: red is the highlight's weight (0–1), green says the affordance is usable. The views:
 *
 * - `graybox`: the graybox colours.
 * - `off`: Runner Vision's colours with no red.
 * - `classic`: red only where Runner Vision highlights the next moves.
 * - `full`: everything usable red.
 *
 * There is one look, shared by every course, so loading another course reuses the compiled material.
 */
import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, int, ivec2, max, mix, step, textureLoad, uniform, uv } from 'three/tsl';
import { gridLine } from '../stage/stage.js';
import { colors } from './metrics.js';

/** The views, as the look's `view` uniform holds them. */
export const VIEWS = { graybox: 0, off: 1, classic: 2, full: 3 };
// The tint texture's size: one texel per affordance slot.
const W = 256, H = 64;

class Look {

	constructor() {

		this.view = uniform( 0 );
		this.mode = 'graybox';
		this.capacity = W * H;
		this.data = new Uint8Array( W * H * 4 );
		this.texture = new THREE.DataTexture( this.data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType );
		this.texture.needsUpdate = true;
		this.material = this.surface();
		// The stripes along hangable edges lie on the tops: pulled toward the camera so they draw over them.
		this.stripe = this.surface( { polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 4 } );
		this.lines = new THREE.LineBasicNodeMaterial( { vertexColors: true } );
		this.dirty = false;

	}

	// The surface material: the view's colour, red by the slot's texel, and a faint 1 m and 0.5 m grid to judge sizes by.
	surface( params = {} ) {

		// Both faces cast shadows: with the back faces alone (three's default for a front-sided material) the shadow
		// starts at the far side of a solid and leaves a lit strip along its foot.
		const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.82, metalness: 0, shadowSide: THREE.DoubleSide, ...params } );
		const id = int( attribute( 'aff', 'float' ).add( 0.5 ) );
		const texel = textureLoad( this.texture, ivec2( id.mod( int( W ) ), id.div( int( W ) ) ) );
		const gray = attribute( 'gray', 'vec4' ), vision = step( 0.5, this.view );
		const m = uv();
		const bands = step( 0.5, fract( m.x.add( m.y ).mul( 2.5 ) ) ).mul( gray.w ).mul( vision.oneMinus() );
		const base = mix( mix( gray.rgb, color( colors.surfaces.hazard.chevrons ), bands ), attribute( 'rv', 'vec3' ), vision );
		const red = max( texel.r, texel.g.mul( step( 2.5, this.view ) ) );
		const tinted = mix( base, color( colors.red ), red );
		const grid = gridLine( m, float( 1 ), float( 1.2 ) ).mul( 0.7 ).max( gridLine( m, float( 0.5 ), float( 0.8 ) ).mul( 0.3 ) );
		mat.colorNode = tinted.mul( float( 1 ).sub( grid.mul( 0.22 ) ) );
		return mat;

	}

	/** @param {string} mode One of VIEWS' names; anything else is ignored. */
	setView( mode ) {

		if ( ! ( mode in VIEWS ) ) return;
		this.mode = mode;
		this.view.value = VIEWS[ mode ];

	}

	/** Marks which of a course's affordances are usable, and clears every highlight. */
	assign( course ) {

		this.data.fill( 0 );
		const n = course.byIndex.length;
		if ( n > this.capacity ) console.warn( `course ${course.name}: ${n} affordances, the look tints ${this.capacity}` );
		for ( const a of course.byIndex ) if ( a?.usable && a.tint < this.capacity ) this.data[ a.tint * 4 + 1 ] = 255;
		this.texture.needsUpdate = true;

	}

	/** Sets a slot's highlight (0–1); `flush` sends the changes. */
	tint( index, weight ) {

		if ( index <= 0 || index >= this.capacity ) return;
		this.data[ index * 4 ] = Math.round( Math.min( 1, Math.max( 0, weight ) ) * 255 );
		this.dirty = true;

	}

	flush() {

		if ( this.dirty ) this.texture.needsUpdate = true;
		this.dirty = false;

	}

}

let look = null;

/** The look every course shares. */
export function getLook() {

	return look ??= new Look();

}
