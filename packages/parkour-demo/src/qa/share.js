// Sharing replays: a replay packed as one file (`<id>.qa.zip`) that anyone can attach to a GitHub issue or a pull
// request, and opened again in any copy of the demo. The zip carries everything needed to run the replay again
// exactly: the recording, its course as it was, the build it was made on (and the working changes, when that build
// was dirty) and where it was played. `npm run qa:open -- <zip>` checks it out at that commit and runs it there and on
// the code as it is now.
//
//   manifest.json   qa-share/1: the replay's id and title, its build, its environment, the files
//   replay.json     the replay (qa-replay/1)
//   course.json     the course definition it ran on, as it was written
//   stills/…        its thumbnail and the stills at its notes
//   summary.md      the issue's text: what it is, the notes, how to run it again
//   patch.diff      the working changes since the build's commit (only when the build was dirty)

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { store } from './store.js';
import { describeEnvironment } from './environment.js';
import { engineOf } from '@trizen/parkour/replay/tape.js';

const FORMAT = 'qa-share/1';

// Where replays become issues: the demo's repository, with its replay issue form (.github/ISSUE_TEMPLATE/replay.yml).
const ISSUES = 'https://github.com/trizen-digital/parkour/issues/new';

// GitHub refuses issue URLs much longer than this (characters); the notes are cut to fit.
const LONGEST_URL = 7000;

const stillsOf = ( rec ) => [ `${rec.id}.jpg`, ...( rec.notes ?? [] ).map( ( note ) => note.still ?? `${rec.id}.${note.id}.jpg` ) ];

function buildLine( build ) {

	if ( ! build ) return 'not recorded';
	return `${build.commit}${build.dirty ? ' (with working changes)' : ''} on ${build.branch || 'no branch'}, ${build.how ?? 'dev'}${build.version ? `, demo ${build.version}` : ''}${build.pushed === false ? ', not pushed' : ''}`;

}

/** The issue's text for a replay: what it is, where it was played, the notes, how to run it again. */
function summaryOf( rec, fileName ) {

	const lane = rec.course?.lane !== null && rec.course?.lane !== undefined ? `, lane ${rec.course.lane + 1}` : '';
	const seconds = rec.window ? rec.window.t1 - rec.window.t0 : rec.duration;
	const lines = [
		`# ${rec.title || 'Untitled replay'}`,
		'',
		`Replay \`${rec.id}\`: ${rec.course?.name ?? 'a course'}${lane}, ${( seconds ?? 0 ).toFixed( 1 )} s, on ${engineOf( rec.settings )}, ${rec.setup?.easy ? 'Easy' : 'Manual'}.`,
		'',
		`- **Build:** ${buildLine( rec.build )}`,
		`- **Played on:** ${describeEnvironment( rec.environment )}, ${rec.setup?.device ?? 'unknown device'}, ${rec.setup?.fps ?? '?'} fps`,
	];
	if ( rec.description ) lines.push( '', rec.description );
	if ( rec.notes?.length ) lines.push( '', '## Notes', '', ...rec.notes.map( ( note ) => `- ${note.t.toFixed( 2 )} s: ${note.text}` ) );
	lines.push( '', '## Run it again', '', 'In a clone of the repo:', '', '```bash', `npm run qa:open -- ${fileName}`, '```', '', 'Or drop the zip on the replay library (L) of any copy of the demo.', '' );
	return lines.join( '\n' );

}

/** The link that opens a new issue on the replay issue form, filled in from the replay. */
function issueUrl( rec ) {

	const fields = {
		template: 'replay.yml',
		title: `Replay: ${rec.title || rec.id}`,
		commit: buildLine( rec.build ),
		engine: engineOf( rec.settings ),
		environment: describeEnvironment( rec.environment ),
		what: [ rec.description, ...( rec.notes ?? [] ).map( ( note ) => `${note.t.toFixed( 2 )} s: ${note.text}` ) ].filter( Boolean ).join( '\n' ),
	};
	let url = `${ISSUES}?${new URLSearchParams( fields )}`;
	while ( url.length > LONGEST_URL && fields.what.length > 0 ) {

		fields.what = fields.what.slice( 0, Math.floor( fields.what.length * 0.8 ) ) + '…';
		url = `${ISSUES}?${new URLSearchParams( fields )}`;

	}

	return url;

}

/**
 * Packs a saved replay as a .qa.zip.
 *
 * @param {object} rec the replay, as saved
 * @returns {Promise<{ blob: Blob, fileName: string }>}
 */
async function packReplay( rec ) {

	const fileName = `${rec.id}.qa.zip`;
	const files = {
		'replay.json': strToU8( JSON.stringify( rec, null, '\t' ) ),
		'course.json': strToU8( await store.getCourseText( rec.course.file ) ),
		'summary.md': strToU8( summaryOf( rec, fileName ) ),
	};
	for ( const still of stillsOf( rec ) ) {

		const blob = await store.getFile( still );
		if ( blob ) files[ `stills/${still}` ] = new Uint8Array( await blob.arrayBuffer() );

	}

	// A dirty build ran on changes no commit has: they travel with the replay, so it can be run again.
	if ( rec.build?.dirty ) {

		const patch = await store.workingPatch().catch( () => '' );
		if ( patch ) files[ 'patch.diff' ] = strToU8( patch );

	}

	const manifest = {
		format: FORMAT, id: rec.id, title: rec.title ?? '', created: rec.created, shared: new Date().toISOString(),
		course: rec.course, engine: engineOf( rec.settings ), build: rec.build ?? null, environment: rec.environment ?? null,
		files: Object.keys( files ).sort(),
	};
	files[ 'manifest.json' ] = strToU8( JSON.stringify( manifest, null, '\t' ) );

	// Stills are JPEGs already; packing them again only costs time.
	const zipped = zipSync( files, { level: 6, mtime: new Date( rec.created ?? Date.now() ) } );
	return { blob: new Blob( [ zipped ], { type: 'application/zip' } ), fileName };

}

function download( blob, fileName ) {

	const url = URL.createObjectURL( blob ), link = document.createElement( 'a' );
	link.href = url;
	link.download = fileName;
	document.body.appendChild( link );
	link.click();
	link.remove();
	setTimeout( () => URL.revokeObjectURL( url ), 10000 );

}

/**
 * Shares a saved replay: downloads its .qa.zip and opens a new GitHub issue filled in from it. The issue's tab is
 * opened at once (a tab opened after the zip is packed would be taken for a pop-up), then pointed at the issue.
 *
 * @param {string} id the replay's id
 * @returns {Promise<{ fileName: string, issue: string, opened: boolean }>}
 */
async function shareReplay( id ) {

	const tab = window.open( '', '_blank' );
	// The issue's page gets no hold on this one.
	if ( tab ) tab.opener = null;
	try {

		const rec = await store.get( id );
		const { blob, fileName } = await packReplay( rec );
		download( blob, fileName );
		const issue = issueUrl( rec );
		if ( tab ) tab.location.href = issue;
		return { fileName, issue, opened: Boolean( tab ) };

	} catch ( error ) {

		tab?.close();
		throw error;

	}

}

/**
 * Opens a shared .qa.zip: its replay, course and stills go in the store's incoming place (qa/incoming/ on a server,
 * this browser on the hosted demo).
 *
 * @param {Blob} file the .qa.zip
 * @returns {Promise<object>} the replay
 */
async function openSharedReplay( file ) {

	let files;
	try {

		files = unzipSync( new Uint8Array( await file.arrayBuffer() ) );

	} catch {

		throw new Error( 'That file is not a shared replay (a .qa.zip)' );

	}

	const manifest = files[ 'manifest.json' ] && JSON.parse( strFromU8( files[ 'manifest.json' ] ) );
	if ( manifest?.format !== FORMAT || ! files[ 'replay.json' ] ) throw new Error( 'That zip is not a shared replay: it has no qa-share/1 manifest' );

	const rec = JSON.parse( strFromU8( files[ 'replay.json' ] ) );
	if ( ! /^[\w.-]+$/.test( rec.id ?? '' ) ) throw new Error( 'That shared replay has no usable id' );

	// The replay first, so its stills and course land beside it.
	await store.put( rec, { place: 'incoming' } );
	if ( files[ 'course.json' ] && rec.course?.file ) await store.putCourse( rec.course.file, strFromU8( files[ 'course.json' ] ), { place: 'incoming' } );
	for ( const [ path, bytes ] of Object.entries( files ) ) {

		if ( ! path.startsWith( 'stills/' ) ) continue;
		const still = path.slice( 'stills/'.length );
		if ( /^[\w.-]+$/.test( still ) && still.startsWith( `${rec.id}.` ) ) await store.putFile( still, new Blob( [ bytes ], { type: 'image/jpeg' } ), { place: 'incoming' } );

	}

	return rec;

}

export { FORMAT, packReplay, shareReplay, openSharedReplay, summaryOf, issueUrl };
