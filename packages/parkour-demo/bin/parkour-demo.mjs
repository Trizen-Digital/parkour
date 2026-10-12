#!/usr/bin/env node
// The installed demo: `npx @trizendigital/parkour-demo` serves the game as it was built into the package (app/, with the
// package's public/ beside it: the courses, the Y Bot, its takes) and the QA store on a qa/ folder in the folder it is
// run from, so replays saved, shared and opened here are kept there. Replays record the build baked into the package
// (app/build.json): the commit and the versions it was made from.
//
//   npx @trizendigital/parkour-demo [--port 5412] [--qa ./qa]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQaStore } from '../tools/qa-store.js';

const PACKAGE = fileURLToPath( new URL( '../', import.meta.url ) );
const ROOTS = [ path.join( PACKAGE, 'app' ), path.join( PACKAGE, 'public' ) ];

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : fallback;

if ( args.includes( '--help' ) || args.includes( '-h' ) ) {

	console.log( 'usage: npx @trizendigital/parkour-demo [--port 5412] [--qa ./qa]' );
	process.exit( 0 );

}

// 5412: beside the dev servers (5410, 5411), so all of them can run at once.
const port = Number( option( '--port', process.env.PORT || 5412 ) );
const qa = path.resolve( option( '--qa', 'qa' ) );

if ( ! fs.existsSync( path.join( ROOTS[ 0 ], 'index.html' ) ) ) {

	console.error( 'This copy of the demo has no build (app/): run `npm run build:package` in packages/parkour-demo first.' );
	process.exit( 1 );

}

// The library's columns are each person's own: the QA store starts with none, and keeps those made here in ./qa/.
fs.mkdirSync( qa, { recursive: true } );

const build = JSON.parse( fs.readFileSync( path.join( ROOTS[ 0 ], 'build.json' ), 'utf8' ) );
const store = createQaStore( { root: qa, build: () => build, patch: () => '' } );

const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm',
	'.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

// The file a URL names: in app/ first, then public/; never outside them.
function fileFor( url ) {

	const relative = decodeURIComponent( url.split( '?' )[ 0 ] ).replace( /^\/+/, '' ) || 'index.html';
	for ( const root of ROOTS ) {

		const file = path.join( root, relative );
		if ( ! file.startsWith( root + path.sep ) ) return null;
		if ( fs.existsSync( file ) && fs.statSync( file ).isFile() ) return file;

	}

	return null;

}

const server = http.createServer( ( request, response ) => {

	if ( request.url.startsWith( '/qa-api/' ) ) {

		request.url = request.url.slice( '/qa-api'.length );
		return store.handle( request, response );

	}

	const file = fileFor( request.url );
	if ( ! file ) {

		response.statusCode = 404;
		return response.end( 'Not found' );

	}

	response.setHeader( 'Content-Type', TYPES[ path.extname( file ).toLowerCase() ] ?? 'application/octet-stream' );
	response.setHeader( 'Cache-Control', 'no-cache' );
	fs.createReadStream( file ).pipe( response );

} );

server.on( 'error', ( error ) => {

	console.error( error.code === 'EADDRINUSE' ? `Port ${port} is taken: pass --port <another>` : error.message );
	process.exit( 1 );

} );

server.listen( port, () => {

	console.log( `Parkour demo ${build.version} (${build.commit}${build.dirty ? '+' : ''}): http://localhost:${port}/` );
	console.log( `Replays are kept in ${qa}` );

} );
