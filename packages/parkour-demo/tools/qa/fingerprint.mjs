// A replay's run in one place, as one value: every frame's hash, in order, hashed. A curated replay keeps its
// fingerprint from node (`headless`, written when it is promoted), so the tests can tell a change to what the run does
// from a difference between the browser it was played in and node (tests/qa.test.mjs).

import { createHash } from 'node:crypto';

/**
 * @param {number[]} hashes each frame's hash, in order
 * @returns {string} 16 hex digits
 */
function fingerprintOf( hashes ) {

	return createHash( 'sha256' ).update( hashes.join( ',' ) ).digest( 'hex' ).slice( 0, 16 );

}

export { fingerprintOf };
