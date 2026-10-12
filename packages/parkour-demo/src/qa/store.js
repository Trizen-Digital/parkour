// The QA store as the page sees it: replays, their stills, their courses, the categories and the benchmark's
// comments. Two stores answer the same calls:
//
// - the files store: `qa-api` (tools/qa-store.js) on the dev server or the installed demo's server, which keeps them
//   in a qa/ folder, where they are reviewed, promoted and committed;
// - the browser store, on the hosted demo (parkour.trizen.dev), which has no server: it keeps them in this browser
//   (IndexedDB), until they are shared as a .qa.zip.
//
// Which one is decided when the page is built (__PARKOUR_BUILD__, vite.config.js). Every call rejects with the reason.

import { librarySummary } from './summary.js';

/** What the page runs, baked in when it was built (null on the dev server, which asks the files store). */
const BAKED = typeof __PARKOUR_BUILD__ !== 'undefined' ? __PARKOUR_BUILD__ : null;

const API = `${import.meta.env.BASE_URL}qa-api`;

async function request( method, path, body = undefined, type = 'application/json' ) {

	const response = await fetch( `${API}/${path}`, {
		method,
		cache: 'no-store',
		headers: body === undefined ? {} : { 'Content-Type': type },
		body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify( body ) : body,
	} );
	if ( ! response.ok ) {

		let reason = `HTTP ${response.status}`;
		try {

			reason = ( await response.json() ).error ?? reason;

		} catch {}

		throw new Error( `QA store: ${method} ${path}: ${reason}` );

	}

	return response.headers.get( 'Content-Type' )?.includes( 'json' ) ? response.json() : response;

}

const name = encodeURIComponent;
const placeQuery = ( options ) => options?.place ? `?place=${name( options.place )}` : '';

const filesStore = {
	/** Where this store keeps replays: 'files' (a qa/ folder) or 'browser'. */
	kind: 'files',
	/** @returns {Promise<{categories: object[], replays: object[]}>} the categories and every replay's summary */
	index: () => request( 'GET', 'index' ),
	/** @returns {Promise<object>} a replay */
	get: ( id ) => request( 'GET', `replays/${name( id )}` ),
	/** Writes a replay where it is; a new one goes to `options.place` (local unless asked). */
	put: ( rec, options ) => request( 'PUT', `replays/${name( rec.id )}${placeQuery( options )}`, rec ),
	/** Changes a replay's notes, title, description, category, window or checks (nothing else can change). */
	patch: ( id, fields ) => request( 'PATCH', `replays/${name( id )}`, fields ),
	/** Moves a replay and its stills to qa/trash/. */
	remove: ( id ) => request( 'DELETE', `replays/${name( id )}` ),
	/** Moves a local or incoming replay, its stills and its course into qa/replays/, to be committed. */
	promote: ( id ) => request( 'POST', `promote/${name( id )}` ),
	categories: () => request( 'GET', 'categories' ),
	putCategories: ( list ) => request( 'PUT', 'categories', list ),
	getCourse: ( file ) => request( 'GET', `courses/${name( file )}` ),
	/** @returns {Promise<string>} a course definition as it was written (its hash is of this text) */
	getCourseText: async ( file ) => {

		const response = await fetch( `${API}/courses/${name( file )}`, { cache: 'no-store' } );
		if ( ! response.ok ) throw new Error( `QA store: GET courses/${file}: HTTP ${response.status}` );
		return response.text();

	},
	/** Keeps a course definition under its hash; one already there is never written again. */
	putCourse: ( file, json, options ) => request( 'PUT', `courses/${name( file )}${placeQuery( options )}`, json, 'application/json; charset=utf-8' ),
	/** A replay's still or thumbnail. */
	putFile: ( fileName, blob, options ) => request( 'PUT', `files/${name( fileName )}${placeQuery( options )}`, blob, blob.type || 'image/jpeg' ),
	/** @returns {Promise<Blob|null>} a replay's still or thumbnail, or null when it has none */
	getFile: async ( fileName ) => {

		const response = await fetch( `${API}/files/${name( fileName )}`, { cache: 'no-store' } );
		return response.ok ? response.blob() : null;

	},
	/** An image for review (qa/review/: contact sheets made from the console). */
	putReview: ( fileName, blob ) => request( 'PUT', `review/${name( fileName )}`, blob, blob.type || 'image/jpeg' ),
	/** @returns {string} a still's URL (`bust` defeats the browser's cache after it changes) */
	fileUrl: ( fileName, bust = '' ) => `${API}/files/${name( fileName )}${bust ? `?v=${bust}` : ''}`,
	/** @returns {Promise<object>} the code the page runs (tools/build-info.mjs) */
	build: () => BAKED ? Promise.resolve( BAKED ) : request( 'GET', 'build' ),
	/** @returns {Promise<string>} the working changes since the build's commit, when it is dirty ('' when clean) */
	workingPatch: async () => ( await request( 'GET', 'patch' ) ).text(),
	/** @returns {Promise<{format: string, comments: object[]}>} the comments on the benchmark (qa/bench/comments.json) */
	benchComments: () => request( 'GET', 'bench' ),
	/** Adds a comment on the benchmark, or changes it (by its id). */
	putBenchComment: ( comment ) => request( 'PUT', `bench/${name( comment.id )}`, comment ),
	/** Deletes a comment on the benchmark; its still goes to qa/trash/bench/. */
	removeBenchComment: ( id ) => request( 'DELETE', `bench/${name( id )}` ),
	/** A comment's still, in qa/bench/. */
	putBenchFile: ( fileName, blob ) => request( 'PUT', `benchfiles/${name( fileName )}`, blob, blob.type || 'image/jpeg' ),
	/** @returns {string} a comment's still's URL */
	benchFileUrl: ( fileName ) => `${API}/benchfiles/${name( fileName )}`,
};

// The browser store's database: replays ({ place, rec }), files (blobs by name), courses (text by file) and the rest
// (categories, the benchmark's comments) by key.
const DB_NAME = 'parkour-qa';
const TABLES = [ 'replays', 'files', 'courses', 'meta' ];

let opening = null;

function database() {

	opening ??= new Promise( ( resolve, reject ) => {

		const open = indexedDB.open( DB_NAME, 1 );
		open.onupgradeneeded = () => {

			for ( const table of TABLES ) if ( ! open.result.objectStoreNames.contains( table ) ) open.result.createObjectStore( table );

		};
		open.onsuccess = () => resolve( open.result );
		open.onerror = () => reject( new Error( `QA store: this browser keeps no replays (${open.error?.message ?? 'IndexedDB refused'})` ) );

	} );
	return opening;

}

// One request in a transaction on a table: get, put, delete or getAllKeys.
async function table( name, mode, act ) {

	const db = await database();
	return new Promise( ( resolve, reject ) => {

		const request = act( db.transaction( name, mode ).objectStore( name ) );
		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error );

	} );

}

const read = ( t, key ) => table( t, 'readonly', ( s ) => s.get( key ) );
const write = ( t, key, value ) => table( t, 'readwrite', ( s ) => s.put( value, key ) );
const drop = ( t, key ) => table( t, 'readwrite', ( s ) => s.delete( key ) );
const keys = ( t ) => table( t, 'readonly', ( s ) => s.getAllKeys() );

// Object URLs for the stills, made as they are read: a card's thumbnail is set from a URL as it is drawn.
const urls = new Map();

function urlFor( fileName, blob ) {

	if ( urls.has( fileName ) ) URL.revokeObjectURL( urls.get( fileName ) );
	urls.set( fileName, URL.createObjectURL( blob ) );

}

async function loadFiles( prefix ) {

	for ( const key of await keys( 'files' ) ) if ( key === `${prefix}.jpg` || key.startsWith( `${prefix}.` ) ) urlFor( key, await read( 'files', key ) );

}

const missing = ( what ) => {

	throw new Error( `QA store: no such ${what}` );

};

const browserStore = {
	kind: 'browser',
	index: async () => {

		const replays = [];
		for ( const id of await keys( 'replays' ) ) {

			const { place, rec } = await read( 'replays', id );
			const thumb = await read( 'files', `${id}.jpg` );
			if ( thumb ) urlFor( `${id}.jpg`, thumb );
			replays.push( librarySummary( rec, { place, thumb: Boolean( thumb ) } ) );

		}

		replays.sort( ( a, b ) => String( b.created ).localeCompare( String( a.created ) ) );
		return { categories: await browserStore.categories(), replays };

	},
	get: async ( id ) => {

		const entry = await read( 'replays', id ) ?? missing( 'replay' );
		await loadFiles( id );
		return entry.rec;

	},
	put: async ( rec, options ) => {

		const entry = await read( 'replays', rec.id );
		await write( 'replays', rec.id, { place: entry?.place ?? options?.place ?? 'local', rec } );
		return { ok: true };

	},
	patch: async ( id, fields ) => {

		const entry = await read( 'replays', id ) ?? missing( 'replay' );
		for ( const key of [ 'title', 'description', 'category', 'notes', 'window', 'verified', 'checked', 'updated' ] ) if ( key in fields ) entry.rec[ key ] = fields[ key ];
		await write( 'replays', id, entry );
		return { ok: true };

	},
	remove: async ( id ) => {

		await drop( 'replays', id );
		for ( const key of await keys( 'files' ) ) if ( key === `${id}.jpg` || key.startsWith( `${id}.` ) ) await drop( 'files', key );
		return { ok: true };

	},
	promote: () => Promise.reject( new Error( 'QA store: replays are promoted in a clone of the repo; share this one instead' ) ),
	// The library's columns are each person's own (qa/categories.json is not in git): a new browser starts with none.
	categories: async () => await read( 'meta', 'categories' ) ?? [],
	putCategories: async ( list ) => write( 'meta', 'categories', list ),
	getCourse: async ( file ) => JSON.parse( await read( 'courses', file ) ?? missing( 'course' ) ),
	getCourseText: async ( file ) => await read( 'courses', file ) ?? missing( 'course' ),
	putCourse: async ( file, json ) => {

		if ( ! await read( 'courses', file ) ) await write( 'courses', file, json );
		return { ok: true };

	},
	putFile: async ( fileName, blob ) => {

		await write( 'files', fileName, blob );
		urlFor( fileName, blob );
		return { ok: true };

	},
	getFile: async ( fileName ) => await read( 'files', fileName ) ?? null,
	// Review images are the QA console's, on the dev server.
	putReview: () => Promise.reject( new Error( 'QA store: review images need the dev server' ) ),
	fileUrl: ( fileName ) => urls.get( fileName ) ?? '',
	build: () => Promise.resolve( BAKED ),
	workingPatch: () => Promise.resolve( '' ),
	benchComments: async () => await read( 'meta', 'bench' ) ?? { format: 'qa-bench-comments/1', comments: [] },
	putBenchComment: async ( comment ) => {

		const file = await browserStore.benchComments(), at = file.comments.findIndex( ( c ) => c.id === comment.id );
		if ( at < 0 ) file.comments.push( comment );
		else file.comments[ at ] = comment;
		await write( 'meta', 'bench', file );
		return { ok: true };

	},
	removeBenchComment: async ( id ) => {

		const file = await browserStore.benchComments();
		file.comments = file.comments.filter( ( c ) => c.id !== id );
		await write( 'meta', 'bench', file );
		await drop( 'files', `bench/${id}.jpg` );
		return { ok: true };

	},
	putBenchFile: async ( fileName, blob ) => browserStore.putFile( `bench/${fileName}`, blob ),
	benchFileUrl: ( fileName ) => urls.get( `bench/${fileName}` ) ?? '',
};

const store = BAKED?.how === 'hosted' ? browserStore : filesStore;

export { store, BAKED };
