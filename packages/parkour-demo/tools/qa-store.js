// The QA store: `qa-api`, which lets the page keep replays in a qa/ folder, where they are reviewed and read like any
// other file. The dev server mounts it as a Vite plugin (qaStore) on the repo's qa/; the installed demo
// (`npx @trizendigital/parkour-demo`) mounts the same handler (createQaStore) on the qa/ folder it runs in.
//
// A replay lives in one of three places:
//
//   qa/replays/<id>.json           curated: committed, and run by the tests (tests/qa.test.mjs)
//   qa/local/<id>.json             your own captures: where Save puts them (not in git)
//   qa/incoming/<id>.json          replays others shared, opened from a .qa.zip (not in git)
//
// each with <id>.jpg (thumbnail) and <id>.<note>.jpg (stills) beside it, and the course definitions they ran on in
// qa/courses/ (curated) or qa/local/courses/ and qa/incoming/courses/, named by hash and never rewritten. Promote
// moves a replay, its stills and its course into the curated place. Also:
//
//   qa/categories.json          the library's columns (not in git: each person's own)
//   qa/review/                  images made for review (contact sheets from the QA console)
//   qa/bench/comments.json      comments on the benchmark's timeline (qa-bench-comments/1), with <id>.jpg stills (not in
//                               git: each person's own)
//   qa/trash/<id>/              deleted replays (and qa/trash/bench/, deleted comments' stills)
//
// The JSON is written readably: short values on one line, the rest indented, so a replay diffs well.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfo, workingPatch } from './build-info.mjs';
import { librarySummary } from '../src/qa/summary.js';

const ROOT = fileURLToPath( new URL( '../qa/', import.meta.url ) );

// The headless check a promoted replay is run through.
const CHECK = fileURLToPath( new URL( './qa/check.mjs', import.meta.url ) );

// Names in a path: a replay's id, a file's name. Nothing that could leave the folder.
const NAME = /^[\w.-]+$/;

// What a PATCH may change in a replay: what the editor edits and the checks. The recording itself never changes.
const EDITABLE = [ 'title', 'description', 'category', 'notes', 'window', 'verified', 'checked', 'updated' ];

// Where replays live, in the order a lookup tries them.
const PLACES = [ 'curated', 'local', 'incoming' ];

// Values up to this long (characters as JSON) stay on one line.
const LINE = 100;

function formatJSON( value, indent = '' ) {

	const inline = JSON.stringify( value );
	if ( value === null || typeof value !== 'object' || inline.length <= LINE ) return inline;
	if ( Array.isArray( value ) && value.every( ( item ) => item === null || typeof item !== 'object' ) ) return inline;
	const next = indent + '\t';
	if ( Array.isArray( value ) ) return `[\n${value.map( ( item ) => next + formatJSON( item, next ) ).join( ',\n' )}\n${indent}]`;
	const entries = Object.entries( value ).filter( ( [ , item ] ) => item !== undefined );
	return `{\n${entries.map( ( [ key, item ] ) => `${next}${JSON.stringify( key )}: ${formatJSON( item, next )}` ).join( ',\n' )}\n${indent}}`;

}

/**
 * The store's request handler.
 *
 * @param {object} [options]
 * @param {string} [options.root] the qa/ folder
 * @param {() => object} [options.build] what the page runs (tools/build-info.mjs): live from git by default
 * @param {() => string} [options.patch] the working changes since the build's commit, when it is dirty
 * @returns {{ handle: ( request, response ) => Promise<void> }}
 */
export function createQaStore( { root = ROOT, build = () => buildInfo( { how: 'dev' } ), patch = () => workingPatch() } = {} ) {

	const folders = {
		curated: join( root, 'replays' ), local: join( root, 'local' ), incoming: join( root, 'incoming' ),
		trash: join( root, 'trash' ), review: join( root, 'review' ), bench: join( root, 'bench' ),
	};
	const coursesOf = ( place ) => place === 'curated' ? join( root, 'courses' ) : join( folders[ place ], 'courses' );
	const commentsFile = join( folders.bench, 'comments.json' );
	const readComments = () => readJSON( commentsFile, { format: 'qa-bench-comments/1', comments: [] } );
	// Each replay's summary for the library, read again only when its file changes.
	const summaries = new Map();

	const ensure = ( folder ) => existsSync( folder ) || mkdirSync( folder, { recursive: true } );
	const readJSON = ( file, fallback ) => existsSync( file ) ? JSON.parse( readFileSync( file, 'utf8' ) ) : fallback;
	const writeJSON = ( file, value ) => {

		ensure( join( file, '..' ) );
		writeFileSync( file, formatJSON( value ) + '\n' );

	};

	// The place a replay is in, or null.
	const placeOf = ( id ) => PLACES.find( ( place ) => existsSync( join( folders[ place ], `${id}.json` ) ) ) ?? null;
	const replayFile = ( id, place ) => join( folders[ place ], `${id}.json` );
	// A still is named after its replay (<id>.jpg, <id>.<note>.jpg) and lives where the replay does.
	const fileFolder = ( name, fallback ) => folders[ placeOf( name.split( '.' )[ 0 ] ) ?? fallback ];
	const placeParam = ( query, fallback = 'local' ) => {

		const place = new URLSearchParams( query ).get( 'place' );
		return PLACES.includes( place ) ? place : fallback;

	};

	// What the library shows of a replay.
	function summary( id, place ) {

		const file = replayFile( id, place ), modified = statSync( file ).mtimeMs, known = summaries.get( id );
		if ( known?.modified === modified && known.place === place ) return known.summary;
		const replay = readJSON( file );
		// The file's name is the replay's id, whatever the file says.
		const result = librarySummary( { ...replay, id }, { place, thumb: existsSync( join( folders[ place ], `${id}.jpg` ) ) } );
		summaries.set( id, { modified, place, summary: result } );
		return result;

	}

	async function body( request ) {

		const chunks = [];
		for await ( const chunk of request ) chunks.push( chunk );
		return Buffer.concat( chunks );

	}

	function send( response, status, data, type = 'application/json' ) {

		response.statusCode = status;
		response.setHeader( 'Content-Type', type );
		response.setHeader( 'Cache-Control', 'no-store' );
		response.end( typeof data === 'string' || Buffer.isBuffer( data ) ? data : JSON.stringify( data ) );

	}

	// Moves a replay and every file named after it (thumbnail, stills) from one folder to another.
	function moveReplay( id, from, to ) {

		ensure( to );
		for ( const file of readdirSync( from ) ) if ( file === `${id}.json` || file.startsWith( `${id}.` ) ) renameSync( join( from, file ), join( to, file ) );
		summaries.delete( id );

	}

	async function handle( request, response ) {

		const [ path, query = '' ] = request.url.split( '?' );
		const [ , kind, name ] = path.split( '/' ).map( decodeURIComponent );
		const method = request.method;
		if ( name !== undefined && ! NAME.test( name ) ) return send( response, 400, { error: 'bad name' } );

		if ( kind === 'index' && method === 'GET' ) {

			const replays = [];
			for ( const place of PLACES ) {

				if ( ! existsSync( folders[ place ] ) ) continue;
				for ( const id of readdirSync( folders[ place ] ).filter( ( file ) => file.endsWith( '.json' ) ).map( ( file ) => file.slice( 0, - 5 ) ) ) {

					try {

						replays.push( summary( id, place ) );

					} catch ( error ) {

						replays.push( { id, place, title: `(unreadable: ${error.message})`, category: null, notes: [] } );

					}

				}

			}

			replays.sort( ( a, b ) => String( b.created ).localeCompare( String( a.created ) ) );
			return send( response, 200, { categories: readJSON( join( root, 'categories.json' ), [] ), replays } );

		}

		if ( kind === 'replays' && name ) {

			const place = placeOf( name ), file = place && replayFile( name, place );
			if ( method === 'GET' ) return file ? send( response, 200, readFileSync( file, 'utf8' ), 'application/json' ) : send( response, 404, { error: 'no such replay' } );
			if ( method === 'PUT' ) {

				// A replay already somewhere is written where it is; a new one goes where it is asked to, local by default.
				writeJSON( file ?? replayFile( name, placeParam( query ) ), JSON.parse( await body( request ) ) );
				return send( response, 200, { ok: true } );

			}

			if ( method === 'PATCH' ) {

				if ( ! file ) return send( response, 404, { error: 'no such replay' } );
				const replay = readJSON( file ), patch = JSON.parse( await body( request ) );
				for ( const key of EDITABLE ) if ( key in patch ) replay[ key ] = patch[ key ];
				writeJSON( file, replay );
				return send( response, 200, { ok: true } );

			}

			if ( method === 'DELETE' ) {

				if ( ! file ) return send( response, 404, { error: 'no such replay' } );
				moveReplay( name, folders[ place ], join( folders.trash, name ) );
				return send( response, 200, { ok: true } );

			}

		}

		// Promote: a local or incoming replay, its stills and its course into the curated place, to be committed.
		if ( kind === 'promote' && name && method === 'POST' ) {

			const place = placeOf( name );
			if ( ! place ) return send( response, 404, { error: 'no such replay' } );
			if ( place === 'curated' ) return send( response, 200, { ok: true } );
			const courseFile = readJSON( replayFile( name, place ) ).course?.file;
			if ( courseFile && NAME.test( courseFile ) && ! existsSync( join( coursesOf( 'curated' ), courseFile ) ) ) {

				const from = PLACES.map( ( p ) => join( coursesOf( p ), courseFile ) ).find( ( f ) => existsSync( f ) );
				if ( from ) {

					ensure( coursesOf( 'curated' ) );
					copyFileSync( from, join( coursesOf( 'curated' ), courseFile ) );

				}

			}

			moveReplay( name, folders[ place ], folders.curated );

			// How it runs in node, once: a replay played in a browser may come out differently in node, and the tests
			// check node still makes this same run (tests/qa.test.mjs).
			const file = replayFile( name, 'curated' ), replay = readJSON( file );
			if ( courseFile && existsSync( join( coursesOf( 'curated' ), courseFile ) ) ) {

				const check = JSON.parse( execFileSync( process.execPath, [ CHECK, file, join( coursesOf( 'curated' ), courseFile ), '--json' ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'inherit' ] } ).trim().split( '\n' ).pop() );
				const { commit, dirty } = build();
				replay.headless = { exact: check.exact, divergedAt: check.divergedAt, fingerprint: check.fingerprint, ...check.ran, commit, dirty };
				writeJSON( file, replay );

			}

			return send( response, 200, { ok: true, headless: replay.headless ?? null } );

		}

		if ( kind === 'categories' ) {

			const file = join( root, 'categories.json' );
			if ( method === 'GET' ) return send( response, 200, readJSON( file, [] ) );
			if ( method === 'PUT' ) {

				writeJSON( file, JSON.parse( await body( request ) ) );
				return send( response, 200, { ok: true } );

			}

		}

		if ( kind === 'courses' && name ) {

			const found = PLACES.map( ( place ) => join( coursesOf( place ), name ) ).find( ( file ) => existsSync( file ) );
			if ( method === 'GET' ) return found ? send( response, 200, readFileSync( found, 'utf8' ), 'application/json' ) : send( response, 404, { error: 'no such course' } );
			if ( method === 'PUT' ) {

				// Named by its hash: a course already there is the same course.
				const data = await body( request );
				if ( ! found ) {

					const folder = coursesOf( placeParam( query ) );
					ensure( folder );
					writeFileSync( join( folder, name ), data );

				}

				return send( response, 200, { ok: true } );

			}

		}

		if ( ( kind === 'files' || kind === 'review' ) && name ) {

			const folder = kind === 'files' ? fileFolder( name, placeParam( query ) ) : folders.review, file = join( folder, name );
			if ( method === 'GET' ) return existsSync( file ) ? send( response, 200, readFileSync( file ), name.endsWith( '.png' ) ? 'image/png' : 'image/jpeg' ) : send( response, 404, { error: 'no such file' } );
			if ( method === 'PUT' ) {

				ensure( folder );
				writeFileSync( file, await body( request ) );
				return send( response, 200, { ok: true } );

			}

		}

		// The benchmark's comments: the list, and one comment put (added or changed) or deleted by its id.
		if ( kind === 'bench' ) {

			if ( name === undefined && method === 'GET' ) return send( response, 200, readComments() );
			if ( name !== undefined && method === 'PUT' ) {

				const comment = { ...JSON.parse( await body( request ) ), id: name }, file = readComments();
				const at = file.comments.findIndex( ( c ) => c.id === name );
				if ( at < 0 ) file.comments.push( comment );
				else file.comments[ at ] = comment;
				file.comments.sort( ( a, b ) => String( a.created ).localeCompare( String( b.created ) ) );
				writeJSON( commentsFile, file );
				return send( response, 200, { ok: true } );

			}

			if ( name !== undefined && method === 'DELETE' ) {

				const file = readComments();
				file.comments = file.comments.filter( ( c ) => c.id !== name );
				writeJSON( commentsFile, file );
				const still = join( folders.bench, `${name}.jpg` );
				if ( existsSync( still ) ) {

					ensure( join( folders.trash, 'bench' ) );
					renameSync( still, join( folders.trash, 'bench', `${name}.jpg` ) );

				}

				return send( response, 200, { ok: true } );

			}

		}

		if ( kind === 'benchfiles' && name ) {

			const file = join( folders.bench, name );
			if ( method === 'GET' ) return existsSync( file ) ? send( response, 200, readFileSync( file ), 'image/jpeg' ) : send( response, 404, { error: 'no such file' } );
			if ( method === 'PUT' ) {

				ensure( folders.bench );
				writeFileSync( file, await body( request ) );
				return send( response, 200, { ok: true } );

			}

		}

		if ( kind === 'build' && method === 'GET' ) return send( response, 200, build() );
		// The working changes a dirty build ran on, for a shared replay to carry (empty when it is clean).
		if ( kind === 'patch' && method === 'GET' ) return send( response, 200, build().dirty ? patch() : '', 'text/plain; charset=utf-8' );
		return send( response, 404, { error: `no route ${method} ${path}` } );

	}

	return {
		handle: ( request, response ) => handle( request, response ).catch( ( error ) => send( response, 500, { error: error.message } ) ),
	};

}

/**
 * The store as a Vite plugin, on the dev server.
 *
 * @param {object} [options] as createQaStore
 * @returns {object} the Vite plugin
 */
export function qaStore( options = {} ) {

	const store = createQaStore( options );

	return {
		name: 'qa-store',
		configureServer( server ) {

			server.middlewares.use( `${server.config.base}qa-api`, store.handle );

		},
	};

}
