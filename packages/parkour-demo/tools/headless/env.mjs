// The browser the game expects, enough of it for node: import this first, and the simulation loads and runs headless
// (the tests, the golden traces, the lanes and reach tools).
//
// `three` resolves to `three/webgpu` as in the page (hooks.mjs); localStorage is a map in memory; fetch reads files
// from public/ or the project (as the dev server serves them); the GLTF loader reads the model from disk.

import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register( './hooks.mjs', import.meta.url );

/** The project's folder. */
const PROJECT = fileURLToPath( new URL( '../../', import.meta.url ) );

const memory = new Map();
globalThis.localStorage ??= { getItem: ( key ) => memory.get( key ) ?? null, setItem: ( key, value ) => memory.set( key, String( value ) ), removeItem: ( key ) => memory.delete( key ) };

/**
 * The file a URL the page would fetch stands for: under public/ first, then the project.
 * @param {string|URL|Request} url
 * @returns {string|null} null for a remote URL
 */
function local( url ) {

	const text = String( url?.url ?? url );
	if ( /^[a-z]+:\/\//i.test( text ) && ! text.startsWith( 'file:' ) ) return null;
	if ( text.startsWith( 'file:' ) ) return fileURLToPath( text );
	if ( path.isAbsolute( text ) && fs.existsSync( text ) ) return text;
	const relative = text.replace( /^\.?\//, '' );
	for ( const root of [ path.join( PROJECT, 'public' ), PROJECT ] ) {

		const file = path.join( root, relative );
		if ( fs.existsSync( file ) ) return file;

	}

	return path.join( PROJECT, relative );

}

const remoteFetch = globalThis.fetch;

globalThis.fetch = async ( url, options ) => {

	const file = local( url );
	if ( ! file ) return remoteFetch( url, options );
	try {

		const data = fs.readFileSync( file );
		return {
			ok: true,
			status: 200,
			json: async () => JSON.parse( data.toString( 'utf8' ) ),
			text: async () => data.toString( 'utf8' ),
			arrayBuffer: async () => data.buffer.slice( data.byteOffset, data.byteOffset + data.byteLength ),
		};

	} catch {

		return { ok: false, status: 404, json: async () => null, text: async () => '', arrayBuffer: async () => new ArrayBuffer( 0 ) };

	}

};

const { GLTFLoader } = await import( 'three/addons/loaders/GLTFLoader.js' );

GLTFLoader.prototype.load = function ( url, onLoad, onProgress, onError ) {

	try {

		const data = fs.readFileSync( local( url ) );
		this.parse( data.buffer.slice( data.byteOffset, data.byteOffset + data.byteLength ), '', onLoad, onError );

	} catch ( error ) {

		onError ? onError( error ) : console.error( error );

	}

};

export { PROJECT, local };
