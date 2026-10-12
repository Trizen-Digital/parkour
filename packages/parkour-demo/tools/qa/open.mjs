// Opens a shared replay (a .qa.zip) in a clone of the repo: checks out the commit it was recorded on in a worktree of
// its own (with the working changes it carries, if its build was dirty), runs it there, then runs it on the code as it
// is now, and says for each whether it comes out exactly as recorded or the first frame that differs. The recording's
// environment and this one are printed side by side, so a replay that differs even at its own commit says whether the
// place changed (another browser engine, another processor) or the run is not deterministic.
//
//   npm run qa:open -- <file.qa.zip> [--serve] [--no-install]
//
// --serve then serves the demo at the replay's commit on http://localhost:5414/ with the replay open in the editor.
// Worktrees are kept in .qa-worktrees/ (not in git) and used again; `git worktree remove` drops one.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const DEMO = fileURLToPath( new URL( '../../', import.meta.url ) );
// Where the demo sits in the repo: the worktree has it at the same place.
const DEMO_IN_REPO = 'packages/parkour-demo';
// The port --serve serves on: one the dev servers (5410, 5411), the installed demo (5412) and the hosted preview (5413)
// leave free.
const SERVE_PORT = 5414;

const args = process.argv.slice( 2 );
const zipFile = args.find( ( arg ) => ! arg.startsWith( '--' ) );
if ( ! zipFile ) {

	console.log( 'usage: npm run qa:open -- <file.qa.zip> [--serve] [--no-install]' );
	process.exit( 2 );

}

const git = ( cwd, ...command ) => execFileSync( 'git', command, { cwd, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] } ).trim();
const tryGit = ( cwd, ...command ) => {

	try {

		return git( cwd, ...command );

	} catch {

		return null;

	}

};

// The zip, unpacked where the checks can read it.
const files = unzipSync( new Uint8Array( fs.readFileSync( zipFile ) ) );
const manifest = files[ 'manifest.json' ] && JSON.parse( strFromU8( files[ 'manifest.json' ] ) );
if ( manifest?.format !== 'qa-share/1' ) {

	console.error( `${zipFile} is not a shared replay (no qa-share/1 manifest)` );
	process.exit( 1 );

}

const rec = JSON.parse( strFromU8( files[ 'replay.json' ] ) );
const unpacked = fs.mkdtempSync( path.join( os.tmpdir(), `qa-${rec.id}-` ) );
for ( const [ name, bytes ] of Object.entries( files ) ) {

	if ( name.endsWith( '/' ) ) continue;
	const to = path.join( unpacked, name );
	fs.mkdirSync( path.dirname( to ), { recursive: true } );
	fs.writeFileSync( to, bytes );

}

const replayFile = path.join( unpacked, 'replay.json' ), courseFile = path.join( unpacked, 'course.json' );
const patchFile = files[ 'patch.diff' ] ? path.join( unpacked, 'patch.diff' ) : null;

const root = tryGit( DEMO, 'rev-parse', '--show-toplevel' );
if ( ! root ) {

	console.error( 'qa:open runs in a clone of the repo (git clone https://github.com/trizen-digital/parkour)' );
	process.exit( 1 );

}

const build = manifest.build ?? rec.build ?? null;
const sha = build?.sha || build?.commit || null;

// This copy's check, run on a copy of the demo: its code, its data and its packages.
function check( demo ) {

	const out = execFileSync( process.execPath, [ path.join( DEMO, 'tools/qa/check.mjs' ), replayFile, courseFile, '--demo', demo, '--json' ], { cwd: demo, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'inherit' ] } );
	return JSON.parse( out.trim().split( '\n' ).pop() );

}

const verdict = ( result ) => result.exact ? `exact (${result.frames} frames)` : `comes out differently from frame ${result.divergedAt} (${result.at} s)`;

// The worktree at the replay's commit, with its working changes: named by both, so each is made once.
function worktreeAt( commit ) {

	// cat-file -e says nothing either way: only failing says the commit is missing.
	const has = () => tryGit( root, 'cat-file', '-e', `${commit}^{commit}` ) !== null;
	if ( ! has() ) {

		console.log( `Fetching ${commit}…` );
		tryGit( root, 'fetch', 'origin', commit );
		if ( ! has() ) throw new Error( `commit ${commit} is not in this clone or on origin${build?.pushed === false ? ' (the replay says it was never pushed)' : ''}` );

	}

	const patch = patchFile ? fs.readFileSync( patchFile ) : null;
	const name = commit.slice( 0, 10 ) + ( patch ? `-${createHash( 'sha256' ).update( patch ).digest( 'hex' ).slice( 0, 8 )}` : '' );
	const tree = path.join( root, '.qa-worktrees', name );
	if ( ! fs.existsSync( tree ) ) {

		console.log( `Checking out ${commit.slice( 0, 7 )} in .qa-worktrees/${name}…` );
		git( root, 'worktree', 'add', '--detach', tree, commit );
		if ( patchFile ) {

			console.log( 'Applying the working changes the replay carries…' );
			git( tree, 'apply', '--whitespace=nowarn', patchFile );

		}

	}

	if ( ! args.includes( '--no-install' ) && ! fs.existsSync( path.join( tree, 'node_modules' ) ) ) {

		console.log( 'Installing its packages…' );
		execFileSync( 'npm', [ fs.existsSync( path.join( tree, 'package-lock.json' ) ) ? 'ci' : 'install', '--no-audit', '--no-fund' ], { cwd: tree, stdio: 'inherit' } );

	}

	return tree;

}

const describe = ( env ) => env ? `${env.browser?.name} ${env.browser?.version} (${env.browser?.engine}) on ${env.os?.name} ${env.os?.version}${env.os?.arch ? `, ${env.os.arch}` : ''}` : 'not recorded';

console.log( `\n${rec.title || 'Untitled'}  (${rec.id})` );
console.log( `  ${ 'recorded on'.padEnd( 16 ) }${build ? `${build.commit}${build.dirty ? ' + working changes' : ''} (${build.how ?? 'dev'}${build.version ? `, demo ${build.version}` : ''})` : 'an unknown build'}` );
console.log( `  ${ 'played in'.padEnd( 16 ) }${describe( manifest.environment ?? rec.environment )}` );
console.log( `  ${ 'checked in'.padEnd( 16 ) }node ${process.version} on ${os.platform()} ${os.release()}, ${os.arch()} (headless)\n` );

let tree = null, atCommit = null;
if ( sha ) {

	try {

		tree = worktreeAt( sha );
		atCommit = check( path.join( tree, DEMO_IN_REPO ) );
		console.log( `  ${ `at ${sha.slice( 0, 7 )}${patchFile ? '+' : ''}`.padEnd( 16 ) }${verdict( atCommit )}` );

	} catch ( error ) {

		console.log( `  ${ `at ${sha.slice( 0, 7 )}`.padEnd( 16 ) }could not run: ${error.message}` );

	}

} else {

	console.log( '  The replay names no commit: only the code as it is now is checked.' );

}

const head = tryGit( root, 'rev-parse', '--short', 'HEAD' ), dirty = tryGit( root, 'status', '--porcelain', '--untracked-files=no' );
const now = check( DEMO );
console.log( `  ${ `now (${head}${dirty ? '+' : ''})`.padEnd( 16 ) }${verdict( now )}\n` );

if ( atCommit && ! atCommit.exact ) console.log( '  It does not come out as recorded even at its own commit: either the place differs (the replay was played in a browser; this check is node) or something in the run is not deterministic.\n' );
else if ( atCommit?.exact && ! now.exact ) console.log( '  It replays exactly at its commit and differently now: the code changed what this run does since.\n' );

if ( args.includes( '--serve' ) ) {

	const serveTree = tree ?? root;
	const demo = path.join( serveTree, DEMO_IN_REPO );
	const incoming = path.join( demo, 'qa/incoming' );
	fs.mkdirSync( path.join( incoming, 'courses' ), { recursive: true } );
	fs.copyFileSync( replayFile, path.join( incoming, `${rec.id}.json` ) );
	if ( rec.course?.file ) fs.copyFileSync( courseFile, path.join( incoming, 'courses', rec.course.file ) );
	for ( const name of Object.keys( files ) ) if ( name.startsWith( 'stills/' ) ) fs.copyFileSync( path.join( unpacked, name ), path.join( incoming, name.slice( 7 ) ) );

	console.log( `Serving ${tree ? `${sha.slice( 0, 7 )}` : 'the code as it is now'}: http://localhost:${SERVE_PORT}/?replay=${encodeURIComponent( rec.id )}\n` );
	spawn( 'npx', [ 'vite', '--port', String( SERVE_PORT ), '--strictPort' ], { cwd: demo, stdio: 'inherit' } );

}
