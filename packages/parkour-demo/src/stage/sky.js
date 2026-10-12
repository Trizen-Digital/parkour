// The sky: an HDR panorama split into the light it gives.
//
// The sun in a real sky is thousands of times brighter than the rest; left in the environment map it would blow out
// every reflection and cast no shadow. So the pixels brighter than a clamp are taken out and measured: their sum is
// the sun (a direction, a colour, an irradiance) for the scene's shadowing directional light, and what is left is a
// soft environment. The lower half becomes a ground the sky itself lights, and the horizon's average colour is kept
// for the haze.

import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Luminance of linear RGB (Rec. 709).
const LUMINANCE = [ 0.2126, 0.7152, 0.0722 ];

// The ground fades in over this far below the horizon, so the sky meets it without a seam.
const GROUND_FADE = THREE.MathUtils.degToRad( 4 );

// Pixels within this of the horizon give the haze its colour.
const HORIZON_BAND = THREE.MathUtils.degToRad( 1 );

/**
 * @param {string} url an equirectangular HDR
 * @param {object} [options]
 * @param {number} [options.clamp] the brightest luminance the environment keeps; the rest is the sun
 * @param {number[]} [options.groundAlbedo] linear RGB of the ground under the sky (none: the panorama's own)
 * @returns {Promise<{ texture: DataTexture, backdrop: DataTexture, sunDirection: Vector3, sunColor: Color,
 *   sunIrradiance: number, horizon: Color }>} the environment, the background (the sky above a horizon carried down,
 *   so the far ground never shows the panorama's), the sun, and the horizon's colour
 */
export async function loadSky( url, { clamp = 64, groundAlbedo = null } = {} ) {

	const hdr = await new HDRLoader().setDataType( THREE.FloatType ).loadAsync( url );
	const { width, height, data } = hdr.image;
	const elevation = ( row ) => Math.PI / 2 - ( ( row + 0.5 ) / height ) * Math.PI;
	const solidAngle = ( row ) => ( 2 * Math.PI / width ) * ( Math.PI / height ) * Math.cos( elevation( row ) );
	const luminance = ( i ) => LUMINANCE[ 0 ] * data[ i ] + LUMINANCE[ 1 ] * data[ i + 1 ] + LUMINANCE[ 2 ] * data[ i + 2 ];

	// Over the upper half: the sun's irradiance (what the clamp takes out), the sky's on level ground (what it leaves,
	// by the cosine), the sun's direction (weighted by what was taken) and the horizon's colour.
	const sun = new THREE.Vector3(), direction = new THREE.Vector3();
	const sunIrradiance = [ 0, 0, 0 ], skyIrradiance = [ 0, 0, 0 ], horizon = [ 0, 0, 0 ];
	let horizonPixels = 0;
	for ( let row = 0; row < height / 2; row ++ ) {

		const up = elevation( row ), dOmega = solidAngle( row ), cosine = Math.sin( up );
		for ( let column = 0; column < width; column ++ ) {

			const i = ( row * width + column ) * 4;
			const lum = luminance( i );
			const kept = lum > clamp ? clamp / lum : 1;
			for ( let c = 0; c < 3; c ++ ) {

				sunIrradiance[ c ] += data[ i + c ] * ( 1 - kept ) * dOmega;
				skyIrradiance[ c ] += data[ i + c ] * kept * dOmega * cosine;

			}

			if ( kept < 1 ) {

				const around = ( ( column + 0.5 ) / width - 0.5 ) * 2 * Math.PI;
				direction.set( Math.cos( around ) * Math.cos( up ), Math.sin( up ), Math.sin( around ) * Math.cos( up ) );
				sun.addScaledVector( direction, lum * ( 1 - kept ) * dOmega );

			}

			if ( up < HORIZON_BAND ) {

				for ( let c = 0; c < 3; c ++ ) horizon[ c ] += data[ i + c ];
				horizonPixels ++;

			}

		}

	}

	sun.normalize();

	// A Lambertian ground lit by the sun and the sky.
	const ground = groundAlbedo && groundAlbedo.map( ( albedo, c ) => albedo / Math.PI * ( sunIrradiance[ c ] * Math.max( sun.y, 0 ) + skyIrradiance[ c ] ) );

	const half = new Uint16Array( data.length );
	const toHalf = THREE.DataUtils.toHalfFloat;
	for ( let row = 0; row < height; row ++ ) {

		const g = ground ? THREE.MathUtils.smootherstep( - elevation( row ), 0, GROUND_FADE ) : 0;
		for ( let column = 0; column < width; column ++ ) {

			const i = ( row * width + column ) * 4;
			const lum = luminance( i );
			const kept = lum > clamp ? clamp / lum : 1;
			for ( let c = 0; c < 3; c ++ ) half[ i + c ] = toHalf( g > 0 ? data[ i + c ] * kept * ( 1 - g ) + ground[ c ] * g : data[ i + c ] * kept );
			half[ i + 3 ] = toHalf( 1 );

		}

	}

	// The background: the row just above the horizon copied down over the lower half.
	const backdrop = half.slice();
	const horizonRow = Math.ceil( height / 2 ) - 1;
	for ( let row = horizonRow + 1; row < height; row ++ ) backdrop.copyWithin( row * width * 4, horizonRow * width * 4, ( horizonRow + 1 ) * width * 4 );

	const equirect = ( pixels ) => {

		const map = new THREE.DataTexture( pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType );
		map.mapping = THREE.EquirectangularReflectionMapping;
		map.colorSpace = THREE.LinearSRGBColorSpace;
		map.minFilter = map.magFilter = THREE.LinearFilter;
		map.generateMipmaps = false;
		map.flipY = true;
		map.needsUpdate = true;
		return map;

	};

	const peak = Math.max( ...sunIrradiance );
	return {
		texture: equirect( half ),
		backdrop: equirect( backdrop ),
		sunDirection: sun,
		sunColor: new THREE.Color().fromArray( sunIrradiance.map( ( value ) => value / peak ) ),
		sunIrradiance: peak,
		horizon: new THREE.Color().fromArray( horizon.map( ( value ) => value / horizonPixels ) ),
	};

}
