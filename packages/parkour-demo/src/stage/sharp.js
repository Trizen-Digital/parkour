// What the motion blur leaves sharp: the runner. The mark rides in the alpha of the scene pass's normals target (its
// rgb the packed normal), from a value each object sets as it draws: 1 for the meshes marked here, 0 for everything
// else (src/stage/post.js writes the targets and reads the mark). A target of its own would take the pass past the
// 32 bytes of colour a pixel WebGPU allows on every machine. Rendering only.

import { normalView, packNormalToRGB, uniform, vec4 } from 'three/tsl';

// Whether the object being drawn is kept sharp: set for each object as it draws.
const mark = uniform( 0 ).onObjectUpdate( ( { object } ) => object.userData.keepSharp ? 1 : 0 );

/** The normals target's value: the packed normal, and whether the pixel is kept sharp. */
const markedNormal = vec4( packNormalToRGB( normalView ), mark );

/**
 * Marks every mesh under a root as kept sharp.
 * @param {Object3D} root
 */
function keepSharp( root ) {

	root.traverse( ( object ) => {

		if ( object.isMesh ) object.userData.keepSharp = true;

	} );

}

export { markedNormal, keepSharp };
