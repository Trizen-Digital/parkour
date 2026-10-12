// What a build of the demo is: the commit it was made from, the versions of the packages it runs on and a hash of its
// motion data. Replays record it (`build`), so a shared replay says what to check out to run it again exactly
// (`npm run qa:open`). The dev server's QA store asks it live; a hosted or installed build has it baked in when it is
// built (vite.config.js).

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = fileURLToPath( new URL( '../', import.meta.url ) );

// The packages a run depends on: a different version of any of them can change a run.
const PACKAGES = [ '@trizen/parkour', '@trizen/parkour-box3d', '@trizen/parkour-rapier', 'three', 'box3d.js', '@dimforge/rapier3d-compat' ];

// A patch can be large; 64 MB is far more than any change to the demo.
function git( command, cwd, { trim = true } = {} ) {

	try {

		const out = execSync( `git ${ command }`, { cwd, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ], maxBuffer: 64 * 1024 * 1024 } );
		return trim ? out.trim() : out;

	} catch {

		return '';

	}

}

// A package's version as installed: its package.json in the nearest node_modules up from the demo.
function versionOf( name, from = DEMO ) {

	for ( let dir = from; ; dir = dirname( dir ) ) {

		const file = join( dir, 'node_modules', name, 'package.json' );
		if ( existsSync( file ) ) return JSON.parse( readFileSync( file, 'utf8' ) ).version;
		if ( dirname( dir ) === dir ) return null;

	}

}

let motionCache = null;

// The motion data's hash (moves.json and every take), worked out again only when a file in it changes.
function motionHash( project = DEMO ) {

	const data = join( project, 'public/data' ), takes = join( data, 'takes' );
	const files = [ join( data, 'moves.json' ), ...readdirSync( takes ).filter( ( file ) => file.endsWith( '.json' ) ).sort().map( ( file ) => join( takes, file ) ) ];
	const stamp = files.map( ( file ) => statSync( file ).mtimeMs ).join( ',' );
	if ( motionCache?.stamp === stamp ) return motionCache.hash;

	const hash = createHash( 'sha256' );
	for ( const file of files ) hash.update( file.slice( data.length ) ).update( readFileSync( file ) );
	motionCache = { stamp, hash: hash.digest( 'hex' ).slice( 0, 16 ) };
	return motionCache.hash;

}

/**
 * @param {object} options
 * @param {'dev'|'hosted'|'installed'} options.how how the page runs: the dev server, the hosted build
 *   (parkour.trizen.dev) or the installed package (`npx @trizen/parkour-demo`)
 * @param {string} [options.project] the demo's folder
 * @returns {object} the build
 */
function buildInfo( { how, project = DEMO } ) {

	const env = process.env;
	const sha = env.VERCEL_GIT_COMMIT_SHA || git( 'rev-parse HEAD', project );
	const remote = git( 'remote get-url origin', project ) || ( env.VERCEL_GIT_REPO_OWNER ? `https://github.com/${ env.VERCEL_GIT_REPO_OWNER }/${ env.VERCEL_GIT_REPO_SLUG }` : '' );
	// Pushed: some remote branch holds the commit, so anyone can check it out. A hosted build was built from a push.
	const pushed = Boolean( env.VERCEL_GIT_COMMIT_SHA ) || ( remote !== '' && git( 'branch -r --contains HEAD', project ) !== '' );

	return {
		commit: sha.slice( 0, 7 ),
		sha,
		branch: env.VERCEL_GIT_COMMIT_REF || git( 'rev-parse --abbrev-ref HEAD', project ),
		dirty: git( 'status --porcelain --untracked-files=no', project ) !== '',
		remote,
		pushed,
		how,
		url: env.VERCEL_URL ? `https://${ env.VERCEL_URL }/` : null,
		version: JSON.parse( readFileSync( join( project, 'package.json' ), 'utf8' ) ).version,
		packages: Object.fromEntries( PACKAGES.map( ( name ) => [ name, versionOf( name, project ) ] ) ),
		motion: motionHash( project ),
	};

}

/** The changes to tracked files since the commit, as a patch `git apply` takes: what a dirty build ran on. */
function workingPatch( project = DEMO ) {

	return git( 'diff HEAD --binary', project, { trim: false } );

}

export { buildInfo, workingPatch, versionOf };
