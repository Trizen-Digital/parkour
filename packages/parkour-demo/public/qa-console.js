// The QA console: helpers for reviewing replays from the browser's console (qa/README.md, "Reviewing replays").
//
//   await import( '/qa-console.js' )
//
// It waits for the game, then puts on `window`: replays(), replayRun( id ), replayCheck(), replaySheet( id, … ),
// laneRun( course, lane, … ), tapeCheck(), trace( frames ), stateDump(), diffDumps( a, b ), and pops( rows ) and
// flow( rows ) for the rows they return; and for the benchmark, benchOpen( … ), benchComments(), benchRows( … ) and
// benchSheet( … ). Each one holds the game while it works, so the page's frames do not run the
// live simulation underneath it.

const { store } = await import( '/src/qa/store.js' );
const { findPops, runAt, timesOf, decodeInput, pressesOf } = await import( '/@id/@trizendigital/parkour/replay/tape.js' );
const { LaneDriver, laneStart } = await import( '/src/qa/lanes.js' );
const { stateDump, diffDumps } = await import( '/src/qa/dump.js' );
const { nextTask } = await import( '/src/qa/QA.js' );

// The game boots in a few seconds; a minute is the most it waits.
for ( let i = 0; i < 120 && ! window.game?.ready; i ++ ) await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
const game = window.game, player = game.player, qa = player.qa;

async function holding( work ) {

	const before = qa.state;
	qa.state = 'busy';
	try {

		return await work();

	} finally {

		qa.state = before === 'busy' ? 'live' : before;

	}

}

// A trace row as the console shows it: seconds from t0, the move with its time, speeds in m/s, heights in m.
function row( r, t, t0 ) {

	return {
		f: r.f, t: + ( t[ r.f ] - t0 ).toFixed( 3 ), state: r.state, move: r.move ? `${r.move}@${( r.tau / 1000 ).toFixed( 2 )}` : '', mode: r.mode,
		v: r.v / 100, y: r.y / 1000, acc: r.acc, hash: r.hash, ok: r.ok ?? null,
	};

}

/** The pops (a joint a frame out of place) in rows. */
window.pops = ( rows, k = 2.5, min = 150 ) => findPops( rows.map( ( r ) => r.acc ), 0, rows.length - 1, k, min ).map( ( i ) => ( { t: rows[ i ].t, f: rows[ i ].f, acc: [ rows[ i ].acc, rows[ i + 1 ].acc ], state: rows[ i ].state, move: rows[ i ].move } ) );

/** What happened, one line per change of state or move. */
window.flow = ( rows ) => rows.filter( ( r, i ) => i === 0 || r.state !== rows[ i - 1 ].state || r.move.split( '@' )[ 0 ] !== rows[ i - 1 ].move.split( '@' )[ 0 ] ).map( ( r ) => `${r.t.toFixed( 2 )} ${r.state}${r.move ? ` > ${r.move}` : ''}` );

/** The categories and every replay's summary. */
window.replays = () => store.index();

/** A replay run again on a simulation of its own: whether it reproduces, its rows, its notes with their rows. */
window.replayRun = async ( id, { all = false } = {} ) => {

	const rec = typeof id === 'string' ? await store.get( id ) : id;
	const { categories } = await store.index().catch( () => ( { categories: [] } ) );
	const kept = rec.window ?? rec.range ?? { from: 0, to: rec.frames - 1 }, t = timesOf( rec.input.dt ), t0 = t[ kept.from ];
	const { divergedAt, rows: everyRow } = await holding( () => qa.rerun( rec ) );
	const rows = everyRow.filter( ( r ) => all || ( r.f >= kept.from && r.f <= kept.to ) ).map( ( r ) => row( r, t, t0 ) );
	const category = categories.find( ( c ) => c.id === rec.category ) ?? null;
	const at = ( f ) => + ( t[ f ] - t0 ).toFixed( 3 );
	return {
		id: rec.id, title: rec.title, description: rec.description, category: category && { name: category.name, description: category.description },
		course: rec.course, recordedOn: rec.build, settings: { easy: rec.setup?.easy },
		reproduced: divergedAt === null, divergedAt: divergedAt === null ? null : { frame: divergedAt, t: at( divergedAt ) },
		notes: ( rec.notes ?? [] ).map( ( note ) => ( { t: note.t, text: note.text, frame: note.f, row: rows.find( ( r ) => r.f === note.f ) ?? null } ) ),
		window: { from: kept.from, to: kept.to, seconds: + ( t[ kept.to + 1 ] - t0 ).toFixed( 3 ) },
		flow: flow( rows ), pops: pops( rows ), maxAcc: Math.max( 0, ...rows.slice( 3 ).map( ( r ) => r.acc ) ),
		presses: pressesOf( decodeInput( rec.input ) ).presses.filter( ( [ f ] ) => f >= kept.from && f <= kept.to ).map( ( [ f, name ] ) => `${at( f ).toFixed( 2 )} ${name}` ),
		summary: rec.summary, rows,
	};

};

/** Every replay run again on the code as it is; each file's `checked` is updated. */
window.replayCheck = async () => {

	const { replays: list } = await store.index(), out = [];
	for ( const summary of list ) {

		try {

			const rec = await store.get( summary.id ), t = timesOf( rec.input.dt ), from = rec.range?.from ?? 0;
			const { divergedAt } = await holding( () => qa.rerun( rec ) );
			const checked = await qa.recordCheck( rec, divergedAt );
			out.push( { id: summary.id, title: summary.title, exact: divergedAt === null, at: divergedAt === null ? null : + ( t[ divergedAt ] - t[ from ] ).toFixed( 3 ), frame: divergedAt, verifiedWhenSaved: rec.verified?.ok ?? null, commit: checked?.commit } );

		} catch ( error ) {

			out.push( { id: summary.id, error: String( error.message ) } );

		}

		await nextTask();

	}

	return out;

};

/** A family course's lane driven on the live game by raw input, recorded on the tape like play. */
window.laneRun = async ( course, lane, { easy = false, early = 0, frames = 60 * 7, dt = 1 / 60 } = {} ) => holding( async () => {

	if ( player.course.def.name !== course ) await game.loadCourse( course );
	const definition = player.course.def, index = typeof lane === 'number' ? lane : definition.lanes.findIndex( ( l ) => l.name === lane );
	const chosen = definition.lanes?.[ index ];
	if ( ! chosen ) throw new Error( `${course} has no lane ${lane}` );
	player.settings.easy = easy;
	player.pilot.toggle( easy );
	player.respawn( laneStart( chosen ) );
	qa.lane = index;
	const sim = player.sim, tape = qa.recorder.tape, driver = new LaneDriver( chosen, { early, frames } ), from = tape?.n ?? 0;
	while ( ! driver.done ) {

		const { keys, edges } = driver.next( sim.runner );
		for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
		player.advance( dt, ( input ) => {

			input.keys = new Set( keys );
			input.mouseButtons = new Set();
			input.mouse = { x: 0, y: 0, wheel: 0 };
			input.enabled = true;

		} );
		driver.after( sim );
		if ( driver.frame % 60 === 0 ) await nextTask();

	}

	const t = tape?.t ?? [], rows = ( tape?.rows ?? [] ).slice( from ).map( ( r, i ) => row( { ...r, f: from + i }, t, t[ from ] ) );
	return { course, lane: index, name: chosen.name, expect: chosen.expect, press: chosen.press ?? null, easy, early, ...driver.result( sim ), flow: flow( rows ), pops: pops( rows ), rows };

} );

/** The live tape run again on a fresh simulation: exact, or where it first comes out differently. */
window.tapeCheck = async ( seconds = 3600 ) => {

	const made = qa.makeRecording( seconds );
	if ( ! made ) return { error: 'no tape: respawn (or play a lane) first' };
	const rec = made.rec, t = timesOf( rec.input.dt );
	const { divergedAt, rows } = await holding( () => qa.rerun( rec ) );
	return { frames: rec.frames, seconds: rec.duration, exact: divergedAt === null, divergedAt, at: divergedAt === null ? null : + t[ divergedAt ].toFixed( 3 ), row: divergedAt === null ? null : row( rows[ divergedAt ], t, 0 ), recorded: divergedAt === null ? null : { state: runAt( rec.trace.states, divergedAt ), y: rec.trace.y[ divergedAt ] / 1000, v: rec.trace.v[ divergedAt ] / 100 } };

};

/** The live tape's last rows. */
window.trace = ( frames = 120 ) => {

	const tape = qa.recorder.tape;
	if ( ! tape ) return [];
	const from = Math.max( 0, tape.n - frames );
	return tape.rows.slice( from ).map( ( r, i ) => row( { ...r, f: from + i }, tape.t, 0 ) );

};

/** Stills around a moment of a replay (from its camera, or orbiting the hips) as one image in qa/review/. */
window.replaySheet = async ( id, { at = null, span = 0.5, count = 8, cols = 4, w = 512, orbit = null } = {} ) => holding( async () => {

	const rec = await store.get( id ), t = timesOf( rec.input.dt ), first = ( rec.window ?? rec.range ).from;
	at ??= rec.notes?.[ 0 ]?.t ?? 0;
	const frameAt = ( s ) => {

		let f = first;
		while ( f < rec.frames - 1 && t[ f + 1 ] - t[ first ] <= s ) f ++;
		return f;

	};

	const frames = [ ...new Set( Array.from( { length: count }, ( _, i ) => frameAt( at - span + ( 2 * span * i ) / Math.max( 1, count - 1 ) ) ) ) ];
	const live = qa.liveRig.capture();
	const { visuals, cache, rows } = await qa.rerun( rec, { to: Math.max( ...frames ), keep: ( f ) => frames.includes( f ) } );
	const shots = [];
	try {

		await qa.showCourse( rec.course.hash, await qa.definitionOf( rec ) );
		qa.showFigure( cache.figure );
		for ( const f of frames ) {

			cache.rig.apply( visuals.get( f ), { camera: game.camera } );
			if ( orbit ) {

				const figure = cache.figure, hips = ( figure.root.getObjectByName( figure.roles.hips ) ?? figure.root ).getWorldPosition( new game.THREE.Vector3() );
				const distance = orbit.dist ?? 3.5, yaw = ( orbit.yaw ?? 90 ) * Math.PI / 180, pitch = ( orbit.pitch ?? 10 ) * Math.PI / 180;
				game.camera.position.set( hips.x + Math.sin( yaw ) * Math.cos( pitch ) * distance, hips.y + Math.sin( pitch ) * distance, hips.z + Math.cos( yaw ) * Math.cos( pitch ) * distance );
				game.camera.lookAt( hips );

			}

			shots.push( await createImageBitmap( await qa.snap( w ) ) );

		}

	} finally {

		await qa.showLive();
		qa.liveRig.apply( live );

	}

	const h = shots[ 0 ].height, canvas = document.createElement( 'canvas' );
	canvas.width = w * Math.min( cols, shots.length );
	canvas.height = h * Math.ceil( shots.length / cols );
	const c = canvas.getContext( '2d' );
	c.font = '600 15px ui-monospace, Menlo, monospace';
	shots.forEach( ( bitmap, i ) => {

		const x = ( i % cols ) * w, y = Math.floor( i / cols ) * h, f = frames[ i ], r = rows[ f ];
		c.drawImage( bitmap, x, y );
		const label = `${( t[ f ] - t[ first ] ).toFixed( 2 )} s · f${f} · ${r.state} ${r.move}`;
		c.fillStyle = 'rgba(0,0,0,0.6)';
		c.fillRect( x, y, c.measureText( label ).width + 12, 22 );
		c.fillStyle = '#fff';
		c.fillText( label, x + 6, y + 16 );

	} );
	const blob = await new Promise( ( resolve ) => canvas.toBlob( resolve, 'image/jpeg', 0.86 ) );
	const name = `${id}-${at.toFixed( 2 )}${orbit ? `-orbit${orbit.yaw ?? 90}` : ''}.jpg`;
	await store.putReview( name, blob );
	return { file: `qa/review/${name}`, frames };

} );

// The benchmark (src/bench/, qa/README.md "The benchmark"): its run in the page, its comments in qa/bench/.
const bench = async ( options = {} ) => {

	if ( ! qa.bench.isOpen ) await qa.openBench( options );
	return qa.bench;

};

/** Opens the benchmark: `{ engine, view, comment, station, at }` (a comment opens on its own engine and view). */
window.benchOpen = async ( options = {} ) => ( await bench( options ), 'open' );

/** Every comment, with where it falls on the run on show (frames and seconds) and the station it is in. */
window.benchComments = async () => {

	const b = await bench();
	return b.comments.map( ( comment ) => {

		const at = b.place( comment );
		return { id: comment.id, text: comment.text, view: comment.view, engine: comment.engine, made: comment.made, station: comment.station, done: comment.done, still: comment.still && `qa/bench/${comment.still}`, onThisRun: at && { f0: at.f0, f1: at.f1, t0: + ( at.f0 / 120 ).toFixed( 3 ), t1: + ( at.f1 / 120 ).toFixed( 3 ), exact: at.exact } };

	} );

};

/** The run's rows over a comment's stretch (`{ comment }`) or `{ from, to }` seconds, every `every` frames. */
window.benchRows = async ( { comment = null, from = null, to = null, every = 6 } = {} ) => {

	const b = await bench( comment ? { comment } : {} ), { f0, f1 } = await b.stretch( { comment, from, to } );
	return b.rows( f0, f1, every );

};

/** A contact sheet of `count` frames across a comment's stretch (or `{ at, span }` s), into qa/review/. */
window.benchSheet = async ( { comment = null, at = null, span = 1, count = 8, cols = 4, w = 512, orbit = null } = {} ) => {

	const b = await bench( comment ? { comment } : {} );
	const { f0, f1 } = comment ? await b.stretch( { comment } ) : await b.stretch( { from: at - span, to: at + span } );
	const frames = [ ...new Set( Array.from( { length: count }, ( _, i ) => Math.round( f0 + ( f1 - f0 ) * i / Math.max( 1, count - 1 ) ) ) ) ];
	const blob = await b.sheet( frames, { cols, w, orbit } );
	const name = `bench-${comment ?? ( at ?? 0 ).toFixed( 2 )}-${b.engine}-${b.view}${orbit ? `-orbit${orbit.yaw ?? 90}` : ''}.jpg`;
	await store.putReview( name, blob );
	return { file: `qa/review/${name}`, frames };

};

/** The live simulation's state, flat (`stateDump( sim )` for another). */
window.stateDump = ( sim = player.sim ) => stateDump( sim );
window.diffDumps = diffDumps;

export const ready = 'qa console loaded';
