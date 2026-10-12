// The stage: the WebGPU renderer (WebGL2 where WebGPU is missing), the scene, and the sun with its soft cascaded
// shadows. What lights the scene (sky, environment, haze, the sun's colour and direction) comes in as a "look"; the
// game makes it from the sky. Rendering only: nothing here touches a run.

import * as THREE from 'three/webgpu';
import { Fn, abs, float, fract, fwidth, min, reference, renderGroup, texture, vec2 } from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';

/**
 * A grid of lines `size` apart on a plane coordinate `p`, `width` pixels wide whatever the distance (the derivative
 * keeps the lines one width on screen): 1 on a line, 0 between.
 */
export const gridLine = Fn( ( [ p, size, width ] ) => {

	const coord = p.div( size );
	const distance = abs( fract( coord.sub( 0.5 ) ).sub( 0.5 ) ).div( fwidth( coord ) );
	return float( 1 ).sub( min( min( distance.x, distance.y ).div( width ), 1.0 ) );

} );

// A 4 × 4 percentage-closer filter spread over the shadow's radius: softer edges than the built-in 2 × 2.
const softShadowFilter = Fn( ( { depthTexture, shadowCoord, shadow, depthLayer } ) => {

	const mapSize = reference( 'mapSize', 'vec2', shadow ).setGroup( renderGroup );
	const radius = reference( 'radius', 'float', shadow ).setGroup( renderGroup );
	const step = radius.div( 1.5 ).div( mapSize );
	let sum = float( 0 );
	for ( let y = 0; y < 4; y ++ ) {

		for ( let x = 0; x < 4; x ++ ) {

			let depth = texture( depthTexture, shadowCoord.xy.add( vec2( x - 1.5, y - 1.5 ).mul( step ) ) );
			if ( depthTexture.isArrayTexture ) depth = depth.depth( depthLayer );
			sum = sum.add( depth.compare( shadowCoord.z ) );

		}

	}

	return sum.div( 16 );

} );

// Cascaded shadows whose penumbra keeps one width in metres in every cascade: each cascade's filter radius and normal
// bias are set from its texel size, so near and far shadows look alike.
class SoftCSM extends CSMShadowNode {

	/**
	 * @param {DirectionalLight} light
	 * @param {object} data the cascades' setup
	 * @param {object} [options]
	 * @param {number} [options.softness] the penumbra's width (m)
	 * @param {number} [options.normalBias] the normal bias in texels
	 */
	constructor( light, data, { softness = 0.035, normalBias = 1.2 } = {} ) {

		super( light, data );
		this.softness = softness;
		this.normalBiasTexels = normalBias;

	}

	_init( builder ) {

		super._init( builder );
		for ( const light of this.lights ) light.shadow.filterNode = softShadowFilter;

	}

	_updateShadowBounds() {

		super._updateShadowBounds();
		for ( const light of this.lights ) {

			const shadow = light.shadow, texel = ( shadow.camera.right - shadow.camera.left ) / shadow.mapSize.x;
			shadow.radius = THREE.MathUtils.clamp( this.softness / texel, 1.5, 3 );
			shadow.normalBias = texel * this.normalBiasTexels;

		}

	}

}

export class Stage {

	/**
	 * @param {HTMLElement} container where the canvas goes
	 */
	constructor( container ) {

		this.container = container;
		this.scene = new THREE.Scene();
		/** Called after the window is resized (the cameras' aspects). */
		this.onResize = [];
		// Who waits for frames to be drawn (frames()), and how many each still waits for.
		this.waiting = [];

	}

	/** Makes the renderer and the sun. */
	async init() {

		const renderer = new THREE.WebGPURenderer( { antialias: true } );
		// Until the graphics are set (src/stage/quality.js), and never more than they allow.
		renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
		renderer.setSize( innerWidth, innerHeight );
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;
		await renderer.init();
		this.container.appendChild( renderer.domElement );
		this.renderer = renderer;

		// Four cascades over the nearest 120 m; the light reaches 40 m past each so tall things outside a cascade
		// still cast into it.
		const sun = new THREE.DirectionalLight();
		sun.castShadow = true;
		sun.shadow.mapSize.set( 2048, 2048 );
		sun.shadow.bias = - 0.0002;
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 400;
		this.csm = new SoftCSM( sun, { cascades: 4, maxFar: 120, mode: 'practical', lightMargin: 40 } );
		this.csm.fade = true;
		sun.shadow.shadowNode = this.csm;
		this.scene.add( sun, sun.target );
		this.sun = sun;
		this.csmCamera = '';

		addEventListener( 'resize', () => this.resize() );
		return this;

	}

	/**
	 * Lights the scene.
	 * @param {object} look `background` (a texture), `environment`, their `backgroundIntensity` and
	 *   `environmentIntensity`, `yaw` (the sky's turn), `fogNode`, `toneMapping`, `exposure`, `sunColor`,
	 *   `sunIntensity`, `sunDirection`; `pipeline` (post-processing) used when rendering through `camera`
	 */
	setLook( look ) {

		const scene = this.scene;
		this.renderer.toneMapping = look.toneMapping;
		this.renderer.toneMappingExposure = look.exposure;
		scene.background = look.background;
		scene.backgroundIntensity = look.backgroundIntensity;
		scene.environment = look.environment;
		scene.environmentIntensity = look.environmentIntensity;
		scene.backgroundRotation.set( 0, look.yaw, 0 );
		scene.environmentRotation.set( 0, look.yaw, 0 );
		scene.fogNode = look.fogNode;
		this.sun.color.copy( look.sunColor );
		this.sun.intensity = look.sunIntensity;
		this.sun.position.copy( look.sunDirection );
		this.look = look;

	}

	resize() {

		this.renderer.setSize( innerWidth, innerHeight );
		for ( const callback of this.onResize ) callback();

	}

	/**
	 * Draws the scene from a camera: through the look's post-processing when it is the look's camera.
	 * @param {PerspectiveCamera} camera
	 */
	render( camera ) {

		// The shadow cascades are fitted to a camera's frustum: again whenever the camera or its projection changes.
		const csm = this.csm, projection = camera.projectionMatrix.elements;
		const key = `${camera.uuid}:${projection[ 0 ]}:${projection[ 5 ]}`;
		if ( csm.camera !== null && key !== this.csmCamera ) {

			csm.camera = camera;
			csm.updateFrustums();

		}

		this.csmCamera = key;
		const post = this.look.pipeline;
		if ( post && this.look.camera === camera ) post.render();
		else this.renderer.render( this.scene, camera );

		for ( const wait of this.waiting ) if ( -- wait.left <= 0 ) wait.done();
		this.waiting = this.waiting.filter( ( wait ) => wait.left > 0 );

	}

	/**
	 * Waits for frames to be drawn (the graphics detector times them).
	 * @param {number} count
	 * @returns {Promise<void>}
	 */
	frames( count ) {

		return new Promise( ( done ) => this.waiting.push( { left: count, done } ) );

	}

}
