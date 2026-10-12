import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three/webgpu';

// The clips the figure samples, one per take: `<url><take>.json` holds the take's length, one row of key times every
// track shares, and each track's values (`<bone>.position` or `<bone>.quaternion`), as `npm run moves:build` writes
// them. Only the figure reads clips: the simulation's timing comes from the take table.

/**
 * Loads the clip of every take in the table.
 * @param {string} url the folder of clip files
 * @param {Map<string, object>} [takes] the take table (no takes, no clips)
 * @returns {Promise<Map<string, AnimationClip>>}
 */
async function loadClips( url, takes = new Map() ) {

	const names = [ ...takes.keys() ];
	const files = await Promise.all( names.map( ( name ) => fetch( url + name + '.json' ).then( ( response ) => response.json() ) ) );

	return new Map( names.map( ( name, i ) => [ name, clipFrom( name, files[ i ] ) ] ) );

}

function clipFrom( name, { length, times, tracks } ) {

	// One times array for every track: the keys are the same for all of them.
	const shared = new Float32Array( times );

	return new AnimationClip( name, length, Object.entries( tracks ).map( ( [ track, values ] ) =>
		new ( track.endsWith( '.quaternion' ) ? QuaternionKeyframeTrack : VectorKeyframeTrack )( track, shared, values )
	) );

}

export { loadClips };
