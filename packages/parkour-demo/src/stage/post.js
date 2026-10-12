// Post-processing: screen-space global illumination and ambient occlusion, resolved by temporal anti-aliasing, and
// motion blur of the scenery after it.
//
// The scene renders once into several targets (colour, albedo, normals, motion); SSGI reads them for the light that
// bounces off nearby surfaces and the occlusion in corners, the bounce is tinted by each surface's albedo and added,
// and TRAA blends frames over time, which both smooths edges and settles SSGI's noise. Motion blur smears the resolved
// scenery along each pixel's motion, and leaves the runner (marked sharp as it draws: src/stage/sharp.js) and the sky
// as they are: a pixel of either keeps its colour, and a sample landing on either counts as the pixel's own, so
// neither smears into what is round it (the runner into the scenery, the scenery over sky something moved off). Each
// of SSGI and the blur can be off: the pipeline's output is made for the pair asked for, once each.

import * as THREE from 'three/webgpu';
import { Fn, Loop, add, convertToTexture, diffuseColor, float, int, max, mix, mrt, output, pass, sample, step, uniform, unpackRGBToNormal, uv, vec2, vec4, velocity } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { markedNormal } from './sharp.js';

// The blur's samples along the motion, and how much of a frame's motion it smears over (a shutter of 0.4 frames).
const BLUR_SAMPLES = 8;
const BLUR_SHUTTER = 0.4;

// Depth at or past this is nothing drawn: the sky.
const SKY_DEPTH = 0.999999;

/**
 * @param {WebGPURenderer} renderer
 * @param {Scene} scene
 * @param {PerspectiveCamera} camera
 * @returns {{ pipeline: RenderPipeline, gi: object, use: (options: {ssgi: boolean, motionBlur: boolean}) => void }}
 *   the pipeline to render through, the SSGI node (its intensities and radius are on the settings' Video tab), and
 *   what sets which effects its output has
 */
export function createGIPipeline( renderer, scene, camera ) {

	const pipeline = new THREE.RenderPipeline( renderer );
	const scenePass = pass( scene, camera, { samples: 0 } );
	scenePass.setMRT( mrt( {
		output,
		diffuseColor,
		// The packed normal, and in its alpha the mark of what the blur keeps sharp (1 on the runner).
		normal: markedNormal,
		velocity,
	} ) );
	// Albedo and normals fit in eight bits a channel: half the memory and bandwidth of the default.
	scenePass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;
	scenePass.getTexture( 'normal' ).type = THREE.UnsignedByteType;

	const color = scenePass.getTextureNode( 'output' );
	const albedo = scenePass.getTextureNode( 'diffuseColor' );
	const depth = scenePass.getTextureNode( 'depth' );
	const motion = scenePass.getTextureNode( 'velocity' );
	const packedNormal = scenePass.getTextureNode( 'normal' );
	const normal = sample( ( uv ) => unpackRGBToNormal( packedNormal.sample( uv ).rgb ) );

	// Two slices of eight steps each per pixel, reaching 4 m: cheap, and TRAA averages the noise away.
	const gi = ssgi( color, depth, normal, camera );
	gi.sliceCount.value = 2;
	gi.stepCount.value = 8;
	gi.radius.value = 4;
	gi.thickness.value = 0.5;
	gi.giIntensity.value = 2;
	gi.aoIntensity.value = 1;
	const lit = vec4( add( color.rgb.mul( gi.getAONode() ), albedo.rgb.mul( gi.getGINode().rgb ) ), color.a );
	const shutter = uniform( BLUR_SHUTTER );

	// 1 where a pixel is kept as it is: the runner, or the sky.
	const kept = ( at ) => max( packedNormal.sample( at ).a, step( SKY_DEPTH, depth.sample( at ).r ) );

	// The scenery blurred along its motion: the image sampled across the stretch it moved over this shutter.
	const blurred = ( image ) => Fn( () => {

		const here = uv();
		const own = image.sample( here ).toVar();
		// The motion is in clip space: half of it, y flipped, in texture coordinates (as TRAA reads it).
		const along = motion.sample( here ).xy.mul( vec2( 0.5, - 0.5 ) ).mul( shutter ).toVar();
		const sum = vec4( 0 ).toVar();
		Loop( { start: int( 0 ), end: int( BLUR_SAMPLES ), type: 'int', condition: '<' }, ( { i } ) => {

			const at = here.add( along.mul( float( i ).div( BLUR_SAMPLES - 1 ).sub( 0.5 ) ) );
			sum.addAssign( mix( image.sample( at ), own, kept( at ) ) );

		} );

		return mix( sum.div( BLUR_SAMPLES ), own, kept( here ) );

	} )();

	const outputs = new Map();
	const outputFor = ( withGI, withBlur ) => {

		const key = `${withGI}:${withBlur}`;
		if ( ! outputs.has( key ) ) {

			const resolved = traa( withGI ? lit : color, depth, motion, camera );
			outputs.set( key, withBlur ? blurred( convertToTexture( resolved ) ) : resolved );

		}

		return outputs.get( key );

	};

	const use = ( { ssgi: withGI, motionBlur: withBlur } ) => {

		const node = outputFor( withGI, withBlur );
		if ( pipeline.outputNode === node ) return;
		pipeline.outputNode = node;
		pipeline.needsUpdate = true;

	};

	use( { ssgi: true, motionBlur: false } );
	return { pipeline, gi, use };

}
