// QA in the page: capture the last seconds of play, note what went wrong, save it as a replay in the repo's qa/
// folder, and open saved replays to scrub, check and play on from. It also keeps the pause menu, the hub the replays
// and the benchmark open from and go back to.
//
// The QA keeps the live game recording (recorder.js) and is in one of eight states: 'live' (playing), 'armed'
// (paused after a capture or Play From Here; the first press plays on), 'menu' (the pause menu), 'resuming' (the menu
// closed; play goes on once every key and button is let go), 'editor' (a capture or a saved replay open), 'gallery'
// (the library open), 'bench' (the benchmark open: src/bench/Bench.js) or 'busy' (running a replay, saving). A
// capture opens on the looks the game kept of its last seconds (visual.js); a saved replay is run again on a
// simulation of its own, which also says whether it still comes out the same. "Play from here" runs a replay on the
// live simulation up to the playhead and hands it over. Replays and their stills go through the QA store (store.js).
//
// Every state but 'live' and 'armed' holds the run: no frame runs, so nothing reaches the tape, and the input is
// cleared when play goes on (the recorder notes that). The menu opens when the run pauses itself (its pause key: Esc,
// P or the pad's Menu) or when the pointer is let go in play; when the run paused itself, play goes on through the
// same key, pressed through the raw input, so the tape has both presses.

import * as THREE from 'three/webgpu';
import { random } from '@trizendigital/parkour/sim/random.js';
import { YBotFigure } from '../figure/YBotFigure.js';
import { Editor } from './Editor.js';
import { Gallery } from './Gallery.js';
import { store } from './store.js';
import { environment } from './environment.js';
import { Recorder } from './recorder.js';
import { Replay, replaySim, takeOver } from './replay.js';
import { FORMAT, engineOf, hashString, summarize, timesOf, traceOf } from '@trizendigital/parkour/replay/tape.js';
import { VisualRig, VisualRing } from './visual.js';
import { Bench } from '../bench/Bench.js';
import { ACTIONS } from '@trizendigital/parkour/data/actions.js';
import { toast, ui } from '../ui/state.svelte.js';
import { idle } from '../ui/nav.js';

// Colours for new categories, in order.
const PALETTE = [ '#4fb3c8', '#e0796b', '#f0b45a', '#63d297', '#a78bfa', '#f472b6', '#60a5fa', '#c9c58a' ];

// A capture shorter than this many frames has nothing to look at.
const SHORTEST_CAPTURE = 30;

// Long work (running a replay) gives the page a turn this often (ms).
const WORK_SLICE = 40;

// Lets the page draw and handle events, without setTimeout's 4 ms floor.
const channel = new MessageChannel(), waiting = [];
channel.port1.onmessage = () => waiting.shift()?.();

/** @returns {Promise<void>} resolved on the page's next task */
function nextTask() {

	return new Promise( ( resolve ) => {

		waiting.push( resolve );
		channel.port2.postMessage( 0 );

	} );

}

class QA {

	/**
	 * @param {Game} game
	 * @param {Player} player
	 */
	constructor( game, player ) {

		this.game = game;
		this.player = player;
		this.settings = { record: true, keep: 20 };
		this.recorder = new Recorder( { keep: this.settings.keep } );
		// The ring keeps two seconds more than a capture, so the capture's first frames have their looks.
		this.ring = new VisualRing( this.settings.keep + 2 );
		this.clock = 0;
		this.recorder.onFrame = ( f ) => this.ring.push( this.recorder.tape.base + f, this.clock += Math.min( this.recorder.tape.frames[ f ].dt, 0.05 ) );
		this.state = 'live';
		this.requests = new Set();
		/** The lane being played (the QA console's lanes), noted on a capture. */
		this.lane = null;
		/** While a replay's course is on show, a course change does not reach the player. */
		this.holdCourse = false;
		this.categories = null;
		// The replay simulation of the last course a replay ran on.
		this.cache = null;
		this.editor = new Editor( this );
		this.gallery = new Gallery( this );
		this.bench = new Bench( this );

	}

	/**
	 * How many seconds a capture takes.
	 * @param {number} seconds
	 */
	setKeep( seconds ) {

		this.settings.keep = seconds;
		this.recorder.keep = seconds;
		this.ring.seconds = seconds + 2;

	}

	/**
	 * Records a new simulation (the player made one for a course).
	 * @param {Simulation} sim
	 * @param {DeviceState} raw
	 * @param {Course} course
	 */
	attach( sim, raw, course ) {

		this.sim = sim;
		this.raw = raw;
		this.recorder.setRecording( this.settings.record );
		this.recorder.attach( sim, raw );
		this.liveRig = new VisualRig( sim.figure, sim.camera );
		this.ring.setRig( this.liveRig );
		this.course = course;
		this.courseText = JSON.stringify( course.def );
		this.courseRef = this.courseReference( course, this.courseText );
		this.shownHash = this.courseRef.hash;
		this.lane = null;
		// The look kept to put back was the last simulation's.
		this.liveShown = null;

	}

	// How a replay names its course: by name, and by the hash of its definition (the store keeps each definition once,
	// so a replay finds its course as it was even after the file changes).
	courseReference( course, text ) {

		const tools = this.game.tools;
		const generated = tools?.last && course.def === tools.last ? { seed: tools.params.seed, length: tools.params.length, difficulty: tools.params.difficulty } : null;
		const name = generated ? 'generated' : course.def?.name ?? this.game.params.course;
		const hash = hashString( text );
		return { name, title: course.def?.title ?? course.name, hash, file: `${String( name ).replace( /[^\w-]+/g, '_' )}-${hash}.json`, generated };

	}

	/**
	 * Starts the run again through the recorder.
	 * @param {number|object} start
	 */
	respawn( start ) {

		const tape = this.recorder.tape;
		const spawn = this.recorder.respawn( start );
		if ( this.recorder.tape !== tape ) {

			this.ring.clear();
			this.clock = 0;

		}

		return spawn;

	}

	/**
	 * Whether the QA holds the game this frame (the tools are open, or play waits for a press to go on).
	 * @param {number} dt
	 * @returns {boolean}
	 */
	holds( dt ) {

		if ( this.state === 'editor' ) this.editor.update( dt );
		if ( this.state === 'bench' ) this.bench.update( dt );
		if ( this.state === 'resuming' ) return ! this.goLive();
		if ( this.open ) return true;
		if ( this.state !== 'armed' ) return false;

		// Armed: any key, mouse button, pad button or stick push plays on (and counts as that frame's input).
		const input = this.sim.input, pads = [ ...( input.navigator?.getGamepads?.() ?? [] ) ].filter( Boolean );
		const pad = pads.some( ( p ) => p.buttons.some( ( button ) => button.pressed ) || p.axes.slice( 0, 2 ).some( ( axis ) => Math.abs( axis ) > 0.3 ) );
		if ( input.keys.size || input.mouseButtons.size || pad || this.raw.queued.some( ( [ , edge ] ) => edge === 'pressed' ) ) {

			this.state = 'live';
			ui.armed = '';
			return false;

		}

		// The mouse moved while waiting does not turn the view on the first frame back.
		input.mouse.x = input.mouse.y = input.mouse.wheel = 0;
		return true;

	}

	beginFrame() {

		this.recorder.easy = this.player.easy;
		this.recorder.beginFrame();

	}

	captureInput( dt ) {

		this.recorder.capture( dt );

	}

	endFrame() {

		this.recorder.endFrame();

	}

	// The menu closed: once nothing is held, play goes on, the input cleared of what the menu took. A run that paused
	// itself goes on through its own pause key, pressed through the raw input, so the tape has it.
	goLive() {

		if ( ! idle() ) return false;
		this.state = 'live';
		const input = this.sim.input;
		input.clear();
		if ( this.sim.paused ) {

			input.queueKey( ACTIONS.pause.keys[ 0 ], 'pressed' );
			input.queueKey( ACTIONS.pause.keys[ 0 ], 'released' );

		}

		return true;

	}

	/**
	 * Asks for 'capture', 'library', 'bench' or 'menu' after the frame (a key read inside the frame, or the run paused).
	 * @param {string} name
	 */
	request( name ) {

		this.requests.add( name );

	}

	afterFrame() {

		if ( ! this.requests.size ) return;
		const requests = [ ...this.requests ];
		this.requests.clear();
		if ( requests.includes( 'capture' ) ) this.capture();
		else if ( requests.includes( 'library' ) ) this.openGallery();
		else if ( requests.includes( 'bench' ) ) this.openBench();
		else if ( requests.includes( 'menu' ) ) this.openMenu();

	}

	/** Whether the menu or the tools have the page (the game does not run). */
	get open() {

		return this.state !== 'live' && this.state !== 'armed';

	}

	// Whether the menu, the library or the benchmark may open now: from play, or from the menu.
	get free() {

		return this.state === 'live' || this.state === 'armed' || this.state === 'menu';

	}

	/**
	 * Opens the benchmark over the game.
	 * @param {object} [options] Bench.open's
	 */
	openBench( options ) {

		if ( ! this.free ) return;
		return this.bench.open( options );

	}

	/**
	 * Opens the pause menu, holding the run.
	 * @param {string} [screen] 'pause', 'settings' or 'mode'
	 */
	openMenu( screen = 'pause' ) {

		if ( this.state === 'live' || this.state === 'armed' ) {

			this.pause( 'menu' );
			ui.menuItem = 0;

		}

		if ( this.state !== 'menu' ) return;
		ui.screen = screen;

	}

	/** The pointer was let go: in play, the menu opens. */
	lostCapture() {

		if ( this.state === 'live' ) this.openMenu();

	}

	/** Closes the menu: play goes on once nothing is held, with the pointer captured again where the browser lets it. */
	resume() {

		if ( this.state !== 'menu' ) return;
		ui.screen = null;
		this.liveShown = null;
		this.state = 'resuming';
		this.game.inspect.enable( Boolean( this.game.params.freeCamera ) );
		// The pointer is captured again where the browser lets it (a click or a key counts; a pad button may not). The
		// touch controls hold it themselves.
		if ( ! this.game.params.freeCamera && ! this.player.touch.on ) {

			try {

				this.player.canvas.requestPointerLock?.()?.catch?.( () => {} );

			} catch {}

		}

	}

	/** Starts the course again (from its first spawn, or the tutorial's flag), and goes back to play. */
	restart() {

		if ( this.state !== 'menu' ) return;
		this.player.restart();
		this.resume();

	}

	/** @returns {string} the recording's state for the HUD */
	status() {

		if ( ! this.settings.record ) return 'off';
		if ( ! this.recorder.tape ) return 'waiting';
		return `${this.recorder.length.toFixed( 1 )} s`;

	}

	// Back to the game, paused until a press.
	arm( text = 'Press any key' ) {

		ui.screen = null;
		this.state = 'armed';
		this.game.inspect.enable( Boolean( this.game.params.freeCamera ) );
		ui.armed = text;

	}

	/**
	 * @param {string} text
	 * @param {string} [kind] '', 'good' or 'warn' (stays longer)
	 */
	toast( text, kind = '' ) {

		toast( text, kind );

	}

	// The menu or the tools take the page: the live look is kept to put back, the pointer let go (the state first, so
	// letting go of the pointer does not open the menu).
	pause( state ) {

		this.liveShown ??= this.liveRig.capture( new Float64Array( this.liveRig.size ) );
		this.state = state;
		ui.armed = '';
		this.sim.input.releaseCapture();

	}

	// The live game back on show (its course, its figure, its look), the input cleared.
	async restoreLive() {

		this.state = 'busy';
		try {

			await this.showLive();

		} catch ( error ) {

			console.error( error );
			toast( `Course restore failed · ${error.message}`, 'warn' );

		}

		this.sim.input.clear();

	}

	async backToPlay( text ) {

		await this.restoreLive();
		this.arm( text );

	}

	/** The live game back on show, under the pause menu. */
	async backToMenu() {

		await this.restoreLive();
		this.state = 'menu';
		ui.screen = 'pause';

	}

	/** Opens the editor on the last seconds of play. */
	capture() {

		if ( this.state !== 'live' && this.state !== 'armed' ) return;
		const made = this.makeRecording( this.settings.keep );
		if ( ! made || made.rec.range.to - made.rec.range.from < SHORTEST_CAPTURE ) return toast( 'Nothing to capture' );
		const { rec, base } = made, visuals = new Map();
		for ( const [ f, look ] of this.ring.copy( base + rec.range.from, base + rec.range.to ) ) visuals.set( f - base, look );
		this.pause( 'editor' );
		this.editor.open( { rec, visuals, rig: this.liveRig, trace: rec.trace, kind: 'capture', divergedAt: null } );

	}

	/**
	 * A recording of the last seconds, ready to save (format FORMAT).
	 * @param {number} [seconds]
	 * @returns {{rec: object, base: number}|null} the recording, and its first frame's number on the live tape
	 */
	makeRecording( seconds = this.settings.keep ) {

		const body = this.recorder.take( seconds );
		if ( ! body ) return null;
		const now = new Date(), pad = ( x ) => String( x ).padStart( 2, '0' );
		const dts = body.input.dt.slice( body.range.from ).map( Number ).filter( ( dt ) => dt > 0 ).sort( ( a, b ) => a - b );
		const { base, ...rest } = body;
		const rec = {
			format: FORMAT,
			id: `${now.getFullYear()}${pad( now.getMonth() + 1 )}${pad( now.getDate() )}-${pad( now.getHours() )}${pad( now.getMinutes() )}${pad( now.getSeconds() )}-${this.courseRef.file.replace( /-[0-9a-f]{8}\.json$/, '' )}`,
			title: '',
			category: null,
			created: now.toISOString(),
			updated: now.toISOString(),
			description: '',
			notes: [],
			course: { ...this.courseRef, lane: this.lane },
			build: null,
			// The median frame time gives the frame rate it was played at.
			setup: { device: this.player.deviceName, fps: dts.length ? Math.round( 1 / dts[ dts.length >> 1 ] ) : null, easy: this.player.easy },
			verified: null,
			checked: null,
			summary: null,
			...rest,
			courseDef: this.courseText,
		};
		return { rec, base };

	}

	// The replay simulation for a recording's course and physics engine, kept while replays run on the same ones.
	async simFor( rec, definition ) {

		const engine = engineOf( rec.settings );
		const key = `${rec.course.hash} ${engine}`;
		if ( this.cache?.key !== key ) {

			this.dropCache();
			const figure = new YBotFigure();
			const sim = await replaySim( definition, { figure, engine } );
			this.cache = { key, sim, figure, rig: new VisualRig( figure, sim.camera ) };

		}

		return this.cache;

	}

	// The replay simulation is let go of, and its physics worlds with it (box3d keeps only so many alive at once).
	dropCache() {

		if ( ! this.cache ) return;
		this.cache.sim.holder.add( this.cache.figure.root );
		this.cache.sim.dispose();
		this.cache = null;

	}

	/**
	 * @param {object} rec
	 * @returns {Promise<object>} the recording's course definition (from the store if it is not in the recording)
	 */
	async definitionOf( rec ) {

		if ( rec.courseDef ) return typeof rec.courseDef === 'string' ? JSON.parse( rec.courseDef ) : rec.courseDef;
		const definition = await store.getCourse( rec.course.file );
		rec.courseDef = JSON.stringify( definition );
		return definition;

	}

	/**
	 * Runs a recording again on the replay simulation. The random streams are the page's: they are put back after, so
	 * the live game's draws are untouched.
	 * @param {object} rec
	 * @param {object} [options]
	 * @param {number} [options.to] the last frame
	 * @param {(f: number) => boolean} [options.keep] which frames' looks to keep
	 * @param {(row: object) => void} [options.onFrame]
	 * @param {(fraction: number) => void} [options.progress]
	 * @returns {Promise<{divergedAt: number|null, rows: object[], visuals: Map<number, Float64Array>, cache: object}>}
	 */
	async rerun( rec, { to = rec.frames - 1, keep = () => false, onFrame = null, progress = null } = {} ) {

		const saved = random.save();
		try {

			const definition = await this.definitionOf( rec );
			const cache = await this.simFor( rec, definition );
			const replay = new Replay( cache.sim, rec );
			const rows = [], visuals = new Map();
			let started = performance.now();
			while ( ! replay.done && replay.f <= to ) {

				const row = replay.step();
				rows.push( row );
				if ( keep( row.f ) ) visuals.set( row.f, cache.rig.capture() );
				onFrame?.( row );
				if ( performance.now() - started > WORK_SLICE ) {

					progress?.( row.f / Math.max( 1, to ) );
					await nextTask();
					started = performance.now();

				}

			}

			replay.end();
			return { divergedAt: replay.divergedAt, rows, visuals, cache };

		} finally {

			random.restore( saved );

		}

	}

	/**
	 * Shows a course (a replay's) in the game without giving it to the player.
	 * @param {string} hash
	 * @param {object} definition
	 */
	async showCourse( hash, definition ) {

		if ( this.shownHash === hash ) return;
		this.holdCourse = true;
		await this.game.loadCourse( definition );
		this.shownHash = hash;

	}

	/** Shows a replay's figure in place of the live one. */
	showFigure( figure ) {

		const live = this.sim.figure.root;
		if ( figure.root.parent !== this.player.root ) this.player.root.add( figure.root );
		this.liveVisible ??= live.visible;
		live.visible = false;

	}

	hideReplay() {

		if ( this.cache ) this.cache.sim.holder.add( this.cache.figure.root );
		if ( this.liveVisible !== undefined ) this.sim.figure.root.visible = this.liveVisible;
		this.liveVisible = undefined;

	}

	/** Puts the live game back on show: its course, its figure, its look. */
	async showLive() {

		await this.showCourse( this.courseRef.hash, this.course.def );
		if ( this.game.course !== this.player.course ) {

			this.player.adoptCourse( this.game.course );
			this.course = this.game.course;

		}

		this.holdCourse = false;
		this.hideReplay();
		if ( this.liveShown ) this.liveRig.apply( this.liveShown );
		this.liveShown = null;

	}

	/**
	 * Opens a saved replay in the editor, run again (which says whether it still comes out the same).
	 * @param {string} id
	 */
	async openReplay( id ) {

		this.gallery.close();
		this.state = 'busy';
		this.editor.loading();
		try {

			const rec = await store.get( id );
			await this.loadCategories();
			const range = rec.range ?? { from: 0, to: rec.frames - 1 };
			const { divergedAt, rows, visuals, cache } = await this.rerun( rec, {
				to: range.to,
				keep: ( f ) => f >= range.from,
				progress: ( fraction ) => this.editor.progress( fraction ),
			} );
			await this.showCourse( rec.course.hash, await this.definitionOf( rec ) );
			this.showFigure( cache.figure );
			this.state = 'editor';
			this.editor.open( { rec, visuals, rig: cache.rig, trace: { ...traceOf( rows ), easys: rec.trace.easys ?? [] }, kind: 'saved', divergedAt } );
			this.recordCheck( rec, divergedAt );
			if ( divergedAt !== null ) {

				const t = timesOf( rec.input.dt );
				toast( `Differs at ${( t[ divergedAt ] - t[ range.from ] ).toFixed( 2 )} s`, 'warn' );

			}

		} catch ( error ) {

			console.error( error );
			toast( `Open failed · ${error.message}`, 'warn' );
			this.editor.close();
			this.state = 'gallery';
			ui.screen = 'replays';
			this.gallery.open();

		}

	}

	/**
	 * Play from here: the recording run on the live simulation up to a frame, then the player's.
	 * @param {object} rec
	 * @param {number} to
	 */
	async takeOver( rec, to ) {

		this.state = 'busy';
		const player = this.player, definition = await this.definitionOf( rec );
		this.hideReplay();
		this.liveShown = null;

		// The run goes on on the recording's physics engine, and the player runs on it from now on: another course is
		// built on it, and the same one built again if the live run is on another engine.
		const engine = engineOf( rec.settings );
		player.settings.engine = engine;
		if ( rec.course.hash === this.courseRef.hash ) {

			await this.showLive();

		} else {

			this.holdCourse = false;
			await this.game.loadCourse( definition );

		}

		await player.setEngine( engine );
		this.lane = rec.course.lane ?? null;

		// The pilot sits out the replay (the recording has its presses), then comes back as it was.
		const sim = this.sim, pilot = player.pilot;
		pilot.toggle( false );
		const t = timesOf( rec.input.dt ), keepFrom = t[ to + 1 ] - this.ring.seconds;
		this.ring.clear();
		await takeOver( this, rec, to, {
			onFrame: ( row ) => t[ row.f ] >= keepFrom && this.ring.push( row.f, t[ row.f + 1 ] ),
			pause: async ( f ) => {

				this.editor.progress( f / Math.max( 1, to ) );
				await nextTask();

			},
		} );
		sim.camera.aspect = innerWidth / innerHeight;
		sim.camera.updateProjectionMatrix();
		this.courseRef = { ...rec.course };
		delete this.courseRef.lane;
		this.shownHash = this.courseRef.hash;
		this.clock = t[ to + 1 ];
		pilot.toggle( player.easy );
		this.editor.close();
		this.arm();

	}

	async loadCategories() {

		if ( this.categories ) return this.categories;
		try {

			this.categories = await store.categories();

		} catch ( error ) {

			this.categories = [];
			toast( error.message, 'warn' );

		}

		return this.categories;

	}

	async saveCategories() {

		await store.putCategories( this.categories );

	}

	/**
	 * @param {string} name
	 * @param {string} [description]
	 * @returns {object} the category, added to the list (not yet saved)
	 */
	newCategory( name, description = '' ) {

		const id = `c${Date.now().toString( 36 )}`;
		const used = new Set( this.categories.map( ( category ) => category.color ) );
		const color = PALETTE.find( ( c ) => ! used.has( c ) ) ?? PALETTE[ this.categories.length % PALETTE.length ];
		const category = { id, name, description, color };
		this.categories.push( category );
		return category;

	}

	openGallery() {

		const fromReplay = this.state === 'editor' && this.editor.session?.kind === 'saved';
		if ( ! this.free && ! fromReplay ) return;
		if ( fromReplay ) this.editor.close();
		else this.pause( 'gallery' );
		this.state = 'gallery';
		ui.screen = 'replays';
		this.gallery.open();

	}

	async closeGallery() {

		this.gallery.close();
		await this.backToMenu();

	}

	/**
	 * Saves a capture: the commit it was made on, its course (once per definition), its stills, its summary.
	 * @param {object} session the editor's
	 * @returns {Promise<boolean>} whether it was saved
	 */
	async save( session ) {

		const rec = session.rec;
		rec.updated = new Date().toISOString();
		try {

			rec.build = await store.build();
			rec.environment = await environment();

		} catch ( error ) {

			toast( error.message, 'warn' );
			return false;

		}

		await store.putCourse( rec.course.file, rec.courseDef );
		await this.stills( session );
		rec.summary = summarize( rec );
		await store.put( this.writable( rec ) );
		session.saved = true;
		return true;

	}

	/**
	 * Runs a saved capture again and notes whether it replays exactly (a capture that does not, straight after it was
	 * made, is a determinism bug).
	 * @param {object} session
	 * @returns {Promise<object>} rec.verified
	 */
	async verify( session ) {

		const rec = session.rec;
		const { divergedAt } = await this.rerun( rec, { progress: ( fraction ) => this.editor.progress( fraction ) } );
		const t = timesOf( rec.input.dt );
		rec.verified = { ok: divergedAt === null, at: divergedAt === null ? null : + ( t[ divergedAt ] - t[ rec.range.from ] ).toFixed( 3 ), frame: divergedAt, commit: rec.build?.commit ?? null, date: new Date().toISOString() };
		await store.patch( rec.id, { verified: rec.verified } );
		return rec.verified;

	}

	/**
	 * Notes how a replay ran on the code as it is now (`checked`), when that changed.
	 * @param {object} rec
	 * @param {number|null} divergedAt
	 * @returns {Promise<object|null>}
	 */
	async recordCheck( rec, divergedAt ) {

		try {

			const build = await store.build(), t = timesOf( rec.input.dt ), from = rec.range?.from ?? 0;
			const checked = { ok: divergedAt === null, at: divergedAt === null ? null : + ( t[ divergedAt ] - t[ from ] ).toFixed( 3 ), frame: divergedAt, commit: build.commit, dirty: build.dirty, date: new Date().toISOString() };
			const before = rec.checked;
			rec.checked = checked;
			if ( ! before || before.ok !== checked.ok || before.frame !== checked.frame || before.commit !== checked.commit || before.dirty !== checked.dirty ) await store.patch( rec.id, { checked } );
			return checked;

		} catch ( error ) {

			console.warn( error );
			return null;

		}

	}

	// What goes in the replay's file: the course definition lives in the store's courses, once.
	writable( rec ) {

		const out = { ...rec };
		delete out.courseDef;
		return out;

	}

	// The thumbnail (at the first note, or the window's start) and a still for each note.
	async stills( session ) {

		const rec = session.rec, editor = this.editor;
		const shot = async ( f, width ) => {

			editor.show( f );
			return this.snap( width );

		};

		const first = rec.notes[ 0 ]?.f ?? rec.window.from;
		await store.putFile( `${rec.id}.jpg`, await shot( first, 512 ) );
		for ( const note of rec.notes ) {

			if ( note.still ) continue;
			await store.putFile( `${rec.id}.${note.id}.jpg`, await shot( note.f, 960 ) );
			note.still = `${rec.id}.${note.id}.jpg`;

		}

		editor.show( editor.frame );

	}

	/**
	 * Renders what is on show from the game's camera into a JPEG.
	 * @param {number} [width] (px); the height follows the window's shape
	 * @returns {Promise<Blob>}
	 */
	async snap( width = 960 ) {

		const stage = this.game.stage, renderer = stage.renderer, canvas = renderer.domElement;
		const height = Math.max( 2, Math.round( width * canvas.height / canvas.width ) );
		const camera = ( this.stillCamera ??= new THREE.PerspectiveCamera() ).copy( this.game.camera );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
		if ( this.stillTarget?.width !== width || this.stillTarget?.height !== height ) {

			this.stillTarget?.dispose();
			this.stillTarget = new THREE.RenderTarget( width, height );

		}

		const target = this.stillTarget;
		renderer.setOutputRenderTarget( target );
		renderer.setRenderTarget( target );
		try {

			// The node system's frame advances as for a drawn frame (TRAA and other per-frame nodes need it).
			renderer._nodes?.nodeFrame?.update();
			stage.render( camera );
			const pixels = await renderer.readRenderTargetPixelsAsync( target, 0, 0, width, height );
			return await jpeg( pixels, width, height, ! renderer.backend.isWebGPUBackend );

		} finally {

			renderer.setOutputRenderTarget( null );
			renderer.setRenderTarget( null );

		}

	}

}

// Pixels read back from a render target as a JPEG. WebGPU pads each row to 256 bytes; WebGL reads bottom up.
async function jpeg( pixels, width, height, flip ) {

	const padded = Math.ceil( width * 4 / 256 ) * 256;
	const stride = pixels.length === width * height * 4 ? width * 4 : padded;
	const image = new ImageData( width, height );
	for ( let y = 0; y < height; y ++ ) {

		const from = ( flip ? height - 1 - y : y ) * stride;
		image.data.set( pixels.subarray( from, from + width * 4 ), y * width * 4 );

	}

	const canvas = document.createElement( 'canvas' );
	canvas.width = width;
	canvas.height = height;
	canvas.getContext( '2d' ).putImageData( image, 0, 0 );
	return new Promise( ( resolve ) => canvas.toBlob( resolve, 'image/jpeg', 0.86 ) );

}

export { QA, nextTask };
