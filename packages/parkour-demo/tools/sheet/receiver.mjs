// Receives frames the game posts from the browser (sheet.js, shot.js) and saves them into tools/sheet/out/: the RGBA
// bytes as <name>.rgba and the size as <name>.json (png.mjs turns them into PNG files).
//
//   node tools/sheet/receiver.mjs [port]     (by default port.js's, where sheet.js and shot.js post)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './png.mjs';
import { PORT } from './port.js';

const port = Number( process.argv[ 2 ] ) || PORT;

fs.mkdirSync( OUT, { recursive: true } );
http.createServer( ( request, response ) => {

	// The game runs on another origin (the dev server).
	response.setHeader( 'Access-Control-Allow-Origin', '*' );
	response.setHeader( 'Access-Control-Allow-Methods', 'POST, OPTIONS' );
	response.setHeader( 'Access-Control-Allow-Headers', '*' );
	if ( request.method === 'OPTIONS' ) return response.end();

	const url = new URL( request.url, 'http://localhost' );
	const name = path.basename( url.pathname ).replace( /[^\w.-]/g, '_' );
	const chunks = [];
	request.on( 'data', ( chunk ) => chunks.push( chunk ) );
	request.on( 'end', () => {

		const data = Buffer.concat( chunks );
		fs.writeFileSync( path.join( OUT, name + '.rgba' ), data );
		fs.writeFileSync( path.join( OUT, name + '.json' ), JSON.stringify( { w: Number( url.searchParams.get( 'w' ) ), h: Number( url.searchParams.get( 'h' ) ), bytes: data.length } ) );
		response.end( 'ok' );
		console.log( `${name}: ${data.length} bytes` );

	} );

} ).listen( port, '127.0.0.1', () => console.log( `receiving frames on ${port}` ) );
