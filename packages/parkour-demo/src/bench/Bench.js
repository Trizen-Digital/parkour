// The benchmark in the page: the autopilot's run of every station, watched in third or first person on either physics
// engine, with a timeline to scrub and comments pinned to stretches of it.
//
// It opens over the game like the QA tools (QA holds the live run while it is open): the benchmark course goes on
// show, a simulation of its own on the chosen engine (the Y Bot, a 16:9 camera, no page devices) runs it, and the page
// camera copies that camera. A run (BenchRun) is worked out ahead of what is shown, a few milliseconds a frame, and
// keyframed, so any moment can be shown exactly: playing runs its recorded frames, scrubbing puts back the keyframe
// before the moment and plays up to it. Third and first person are two runs on the same simulation (first person
// changes how the runner moves, so it is a run of its own); another engine is another simulation.
//
// Comments (qa/bench/comments.json, through the QA store) cover a stretch of the timeline, may overlap, and say which
// view and engine they are about. Each keeps where it is in its station, so it finds its place again on another run,
// or after the code changes.
//
// src/ui/Bench.svelte shows it from `view`; the two timelines are drawn here, on `overview` and `detailCanvas`.

import * as THREE from 'three/webgpu';
import { Simulation } from '@trizendigital/parkour/sim/Simulation.js';
import { random } from '@trizendigital/parkour/sim/random.js';
import { World } from '@trizendigital/parkour/world/World.js';
import { fromCourse } from '../world/fromCourse.js';
import { YBotFigure } from '../figure/YBotFigure.js';
import { ENGINES, backendOf } from '../engines.js';
import { CourseParts } from '../app/CourseParts.js';
import { hashString } from '@trizendigital/parkour/replay/tape.js';
import { store } from '../qa/store.js';
import { benchCourse } from './course.js';
import { BenchRun } from './BenchRun.js';
import { DT } from './Autopilot.js';
import { makeComment, placeComment } from './comments.js';
import { reactive, toast, ui } from '../ui/state.svelte.js';

const VIEWS = [ 'third', 'first' ];
const VIEW_NAMES = { third: 'Third', first: 'First', both: 'Both' };
const ENGINE_NAMES = { box3d: 'box3d', rapier: 'Rapier', both: 'Both' };
const SPEEDS = [ 0.25, 0.5, 1, 2, 4, 8, 16 ];

// Working the run out ahead takes this much of each page frame (ms): less while playing, more while paused.
const WORK_PLAYING = 5;
const WORK_PAUSED = 14;

// At most this many frames are played in one page frame (16× at 60 Hz needs 32).
const MOST_FRAMES = 40;

// The detail timeline shows this long by default (s); the wheel zooms it between DETAIL_RANGE.
const DETAIL = 40;
const DETAIL_RANGE = [ 4, 600 ];

// A new comment covers this long before the playhead (s).
const COMMENT_SPAN = 3;

// The timelines' heights (px), and the detail one's lanes: [ top, height ].
const OVERVIEW_HEIGHT = 30;
const LANES = { ruler: [ 0, 14 ], stations: [ 15, 22 ], states: [ 38, 10 ], comments: [ 50, 0 ] };
const COMMENT_ROW = 13;

// The families' colours on the timelines, in the order the run takes them.
const FAMILIES = {
	run: '#5a6779', obstacles: '#4b7fb8', vaults: '#4fb3c8', ledges: '#2f8f7d', gaps: '#8d79d6', precision: '#b27ad6', strides: '#d68fcf',
	walls: '#63b27a', swings: '#c99a42', climbs: '#b88352', doors: '#a07a5a', ground: '#7b8a52', landings: '#c06a5a',
	tricks: '#d67aa8', 'air tricks': '#e0796b',
};

// A runner state's colour, as the QA editor draws them.
const STATE_COLORS = [
	[ /^(standing|walking|sprinting|striding)$/, '#4b5868' ], [ /^(sliding|aiming)$/, '#7a6a3a' ],
	[ /^(falling|rising|precisionJump)$/, '#6f5aa8' ], [ /^(bailing|limp)$/, '#a8524a' ],
	[ /^(catchingLedge|hanging|leapingToLedge|vaulting|climbing|topping)/, '#2f6f7d' ], [ /^wall/, '#2f7d64' ], [ /^on/, '#9a7334' ], [ /./, '#5a6779' ],
];

// A comment's colour by the view it is about.
const COMMENT_COLORS = { third: '#4fb3c8', first: '#f0b45a', both: '#a78bfa' };

// The keys the overlay shows, as the autopilot holds them.
const KEYS = [
	[ 'KeyW', 'W' ], [ 'KeyA', 'A' ], [ 'KeyS', 'S' ], [ 'KeyD', 'D' ], [ 'ShiftLeft', 'Shift' ], [ 'Space', 'Space' ],
	[ 'Mouse0', 'Grab' ], [ 'KeyE', 'E' ], [ 'KeyF', 'F' ], [ 'KeyR', 'R' ], [ 'KeyT', 'T' ], [ 'KeyG', 'G' ],
	[ 'KeyX', 'X' ], [ 'KeyQ', 'Q' ], [ 'KeyC', 'C' ], [ 'Digit4', '4' ],
];

/** Seconds as m:ss.s */
const clock = ( seconds ) => {

	const s = Math.max( 0, seconds ), m = Math.floor( s / 60 );
	return `${m}:${( s - m * 60 ).toFixed( 1 ).padStart( 4, '0' )}`;

};

const stateColor = ( state ) => STATE_COLORS.find( ( [ test ] ) => test.test( state ) )[ 1 ];

// Lets the page draw and handle events between slices of long work, also in a background tab (where animation frames
// stop), without setTimeout's 4 ms floor.
const channel = new MessageChannel(), waiting = [];
channel.port1.onmessage = () => waiting.shift()?.();
const nextTask = () => new Promise( ( resolve ) => {

	waiting.push( resolve );
	channel.port2.postMessage( 0 );

} );

class Bench {

	/**
	 * @param {QA} qa
	 */
	constructor( qa ) {

		this.qa = qa;
		this.game = qa.game;
		this.player = qa.player;
		this.engine = ENGINES[ 0 ];
		this.view = VIEWS[ 0 ];
		this.speed = 1;
		this.playing = false;
		// The page's time not yet played (s).
		this.carry = 0;
		this.sim = null;
		this.runs = {};
		this.run = null;
		this.comments = [];
		// A comment being written: `{ f0, f1, text, view, engine }`, or null.
		this.draft = null;
		this.selected = null;
		// The detail timeline's span (s), and whether the free camera has the view.
		this.detail = DETAIL;
		this.free = false;
		this.filter = 'all';
		this.engines = ENGINES;
		this.views = VIEWS;
		this.speeds = SPEEDS;
		this.display = reactive( {
			open: false,
			busy: false,
			/** The loading box: `{ text, progress }` (progress null for none), or null. */
			loading: null,
			engine: this.engine,
			view: this.view,
			speed: this.speed,
			playing: false,
			free: false,
			filter: this.filter,
			/** The stations by family, for the station list: `[ { family, stations: [ { index, name } ] } ]`. */
			families: [],
			station: 0,
			time: '',
			total: '',
			/** The station on show: `{ number, count, name, color, result, reason }`. */
			where: null,
			runner: '',
			/** The tally: `{ text, warn, title }`. */
			status: { text: '', warn: false, title: '' },
			keys: [],
			mouse: '',
			comments: [],
			count: '',
			/** The comment being written: `{ where, view, engine, engines }`, or null. */
			draft: null,
		} );
		this.build();

	}

	get isOpen() {

		return this.display.open;

	}

	// The timelines' canvases and the keys.
	build() {

		this.overview = document.createElement( 'canvas' );
		this.overview.className = 'overview';
		this.detailCanvas = document.createElement( 'canvas' );
		this.detailCanvas.className = 'detail';
		for ( const canvas of [ this.overview, this.detailCanvas ] ) canvas.addEventListener( 'pointerdown', ( event ) => this.pointer( event, canvas ) );
		this.detailCanvas.addEventListener( 'wheel', ( event ) => {

			event.preventDefault();
			this.detail = Math.min( DETAIL_RANGE[ 1 ], Math.max( DETAIL_RANGE[ 0 ], this.detail * Math.exp( event.deltaY * 0.002 ) ) );

		}, { passive: false } );
		this.detailCanvas.addEventListener( 'pointermove', ( event ) => this.hover( event ) );
		this.detailCanvas.addEventListener( 'pointerleave', () => this.hovered = null );
		addEventListener( 'keydown', ( event ) => this.key( event ) );

	}

	// ---- Opening and closing

	/**
	 * Opens the benchmark over the game.
	 * @param {object} [options]
	 * @param {string} [options.engine]
	 * @param {string} [options.view] 'third' or 'first'
	 * @param {number} [options.at] seconds into the run to show
	 * @param {string} [options.station] a station's id to show the start of
	 * @param {string} [options.comment] a comment's id to show the start of, on the engine and in the view it was made
	 *   on (unless they are given)
	 */
	async open( { engine = null, view = null, at = null, station = null, comment = null } = {} ) {

		if ( this.isOpen ) return;
		const qa = this.qa;
		qa.pause( 'bench' );
		ui.screen = 'bench';
		this.display.open = true;
		this.display.busy = true;
		// The page's random streams are the live game's: the benchmark's draws are its own, and are put back after.
		this.randomSaved = random.save();
		try {

			this.loading( 'Loading' );
			await this.loadComments();
			const target = comment ? this.comments.find( ( c ) => c.id === comment ) : null;
			engine ??= target?.made.engine ?? this.player.settings.engine;
			view ??= target?.made.view ?? this.view;
			const { def, placed } = benchCourse();
			this.placed = placed;
			this.fillStations();
			await qa.showCourse( hashString( JSON.stringify( def ) ), def );
			this.course = this.game.course;
			this.parts = new CourseParts( this.course );
			this.camera = new THREE.PerspectiveCamera( 62, 16 / 9, 0.05, 3000 );
			await this.useEngine( ENGINES.includes( engine ) ? engine : ENGINES[ 0 ] );
			this.useView( VIEWS.includes( view ) ? view : VIEWS[ 0 ] );
			this.fillComments();
			if ( target ) {

				this.selected = target.id;
				await this.goToComment( target.id );

			} else if ( station ) await this.goToStation( this.placed.findIndex( ( place ) => place.station.id === station ) );
			else if ( at !== null ) await this.goTo( Math.round( at / DT ) );
			else await this.goTo( 1 );

		} catch ( error ) {

			console.error( error );
			toast( `Benchmark failed to open · ${error.message}`, 'warn' );
			await this.close();
			return;

		} finally {

			this.display.loading = null;
			this.display.busy = false;

		}

		this.syncButtons();

	}

	async close() {

		if ( ! this.isOpen ) return;
		this.playing = false;
		this.setFree( false );
		this.display.open = false;
		this.endDraft();
		this.dropSim();
		this.runs = {};
		this.run = null;
		if ( this.randomSaved ) random.restore( this.randomSaved );
		await this.qa.backToMenu();

	}

	// Lets go of the simulation: its figure leaves the scene, its physics worlds are freed.
	dropSim() {

		if ( ! this.sim ) return;
		for ( const run of Object.values( this.runs ) ) run.end();
		this.sim.figure.root.removeFromParent();
		this.sim.dispose();
		this.sim = null;

	}

	/**
	 * A simulation of the benchmark course on an engine, with the Y Bot on show in place of the live one.
	 * @param {string} engine
	 */
	async useEngine( engine ) {

		if ( this.sim?.engine === engine ) return;
		this.dropSim();
		this.runs = {};
		this.run = null;
		this.engine = engine;
		const sim = new Simulation( {
			world: new World( fromCourse( this.course ) ), camera: this.camera, figure: new YBotFigure(), engine: backendOf( engine ),
			page: { storage: null, eventWindow: null, eventDocument: null, navigator: null },
		} );
		await sim.load( ( text ) => this.loading( text ) );
		this.sim = sim;
		this.qa.showFigure( sim.figure );

	}

	/**
	 * The run in a view on the simulation (made the first time).
	 * @param {string} view
	 */
	useView( view ) {

		this.view = view;
		this.display.status.title = '';
		const existing = this.runs[ view ];
		this.run = existing ? existing.attach() : ( this.runs[ view ] = new BenchRun( this.sim, this.placed, { view } ).start() );

	}

	// Another engine: a new simulation, at the same place in the same station.
	async switchEngine( engine ) {

		if ( engine === this.engine || this.busy ) return;
		const place = this.where();
		this.busy = true;
		this.display.busy = true;
		try {

			await this.useEngine( engine );
			this.useView( this.view );
			await this.goToPlace( place );

		} finally {

			this.busy = false;
			this.display.busy = false;
			this.display.loading = null;
			this.syncButtons();

		}

	}

	// The other view: its own run on the same simulation, at the same place in the same station.
	async switchView( view ) {

		if ( view === this.view || this.busy ) return;
		const place = this.where();
		this.busy = true;
		try {

			this.useView( view );
			await this.goToPlace( place );

		} finally {

			this.busy = false;
			this.display.loading = null;
			this.syncButtons();

		}

	}

	// Where the playhead is, as a station and the time into it, to find the same place on another run.
	where() {

		const run = this.run, f = Math.max( 0, run.f - 1 ), index = run.stationOf[ f ] ?? 0, start = run.stationStart( index ) ?? 0;
		return { index, offset: ( f - start ) * DT };

	}

	async goToPlace( { index, offset } ) {

		await this.workToStation( index );
		const start = this.run.stationStart( index ) ?? 0;
		await this.goTo( start + Math.round( offset / DT ) + 1 );

	}

	loading( text, fraction = null ) {

		this.display.loading = { text, progress: fraction === null ? null : Math.min( 1, fraction ) };

	}

	// ---- Time

	/**
	 * Works the run out until it covers frame f (or is complete), in slices, showing how far it has got.
	 * @param {number} f
	 */
	async workTo( f ) {

		const run = this.run;
		if ( run.frames >= f || run.complete ) return;
		const from = run.frames;
		while ( run.frames < f && ! run.complete ) {

			this.loading( `Running ${clock( run.frames * DT )}`, ( run.frames - from ) / Math.max( 1, f - from ) );
			run.extend( 40 );
			await nextTask();

		}

		this.display.loading = null;

	}

	// Works the run out until a station has started.
	async workToStation( index ) {

		const run = this.run;
		while ( run.stationStart( index ) === null && ! run.complete ) {

			this.loading( `Running to station ${index + 1}`, run.pilot.state.station / Math.max( 1, index ) );
			run.extend( 40 );
			await nextTask();

		}

		this.display.loading = null;

	}

	/**
	 * Shows frame f exactly (the state after f frames).
	 * @param {number} f
	 */
	async goTo( f ) {

		await this.workTo( f );
		this.run.seek( Math.max( 1, Math.min( f, this.run.frames ) ) );
		this.carry = 0;

	}

	async goToStation( index ) {

		if ( index < 0 ) return;
		await this.workToStation( index );
		await this.goTo( ( this.run.stationStart( index ) ?? 0 ) + 1 );

	}

	setSpeed( speed ) {

		this.speed = speed;
		this.syncButtons();

	}

	setFilter( filter ) {

		this.filter = filter;
		this.fillComments();
		this.syncButtons();

	}

	toggle() {

		if ( ! this.playing && this.run.complete && this.run.f >= this.run.frames ) this.run.seek( 1 );
		this.playing = ! this.playing;
		this.carry = 0;
		this.syncButtons();

	}

	pause() {

		this.playing = false;
		this.syncButtons();

	}

	/** @param {string} text the comment being written */
	setDraftText( text ) {

		if ( this.draft ) this.draft.text = text;

	}

	act( name ) {

		const run = this.run, f = run?.f ?? 0;
		switch ( name ) {

			case 'close': return this.close();
			case 'play': return this.toggle();
			case 'back': return this.goTo( f - 5 / DT );
			case 'on': return this.goTo( f + 5 / DT );
			case 'station-back': {

				const index = run.stationOf[ Math.max( 0, f - 1 ) ] ?? 0, start = run.stationStart( index ) ?? 0;
				// Within the first second of a station, back to the one before.
				return this.goToStation( f - start < 1 / DT ? Math.max( 0, index - 1 ) : index );

			}

			case 'station-on': return this.goToStation( Math.min( this.placed.length - 1, ( run.stationOf[ Math.max( 0, f - 1 ) ] ?? 0 ) + 1 ) );
			case 'free': return this.setFree( ! this.free );
			case 'comment': return this.startDraft();
			case 'from': return this.editDraft( { f0: Math.min( f, this.draft?.f1 ?? f ) } );
			case 'to': return this.editDraft( { f1: Math.max( f, this.draft?.f0 ?? f ) } );
			case 'cancel': return this.endDraft();
			case 'save': return this.saveDraft();

		}

	}

	key( event ) {

		if ( ! this.isOpen || this.busy || ui.screen !== 'bench' ) return;
		const typing = event.target.closest?.( 'input, textarea, select, [contenteditable]' );
		if ( event.key === 'Escape' ) {

			event.preventDefault();
			if ( typing ) return event.target.blur();
			if ( this.draft ) return this.endDraft();
			return this.close();

		}

		if ( typing ) return;
		const f = this.run.f, step = event.shiftKey ? 1 : 5;
		switch ( event.code ) {

			case 'Space': this.toggle(); break;
			case 'ArrowLeft': this.goTo( f - step / DT ); break;
			case 'ArrowRight': this.goTo( f + step / DT ); break;
			case 'Comma': this.pause(); this.goTo( f - 1 ); break;
			case 'Period': this.pause(); this.goTo( f + 1 ); break;
			case 'BracketLeft': this.act( 'station-back' ); break;
			case 'BracketRight': this.act( 'station-on' ); break;
			case 'KeyC': this.switchView( this.view === 'third' ? 'first' : 'third' ); break;
			case 'KeyN': this.startDraft(); break;
			case 'KeyI': this.act( 'from' ); break;
			case 'KeyO': this.act( 'to' ); break;
			case 'Home': this.goTo( 1 ); break;
			default: return;

		}

		event.preventDefault();

	}

	// ---- Each frame

	/**
	 * The page's frame while the benchmark is open: plays on, works the run out ahead, and shows it.
	 * @param {number} dt (s)
	 */
	update( dt ) {

		const run = this.run;
		if ( ! run || this.busy || this.display.busy ) return;

		if ( this.playing ) {

			this.carry += dt * this.speed;
			let frames = Math.min( MOST_FRAMES, Math.floor( this.carry / DT + 1e-9 ) );
			this.carry -= frames * DT;
			if ( frames === MOST_FRAMES ) this.carry = 0;
			while ( frames -- > 0 ) {

				if ( run.step() ) continue;
				this.playing = false;
				this.syncButtons();
				break;

			}

		}

		if ( ! run.complete ) run.extend( this.playing ? WORK_PLAYING : WORK_PAUSED );
		this.show( dt );
		this.draw();

	}

	// What the run shows now: the camera (copied, its field of view kept across the window's shape), the course's
	// moving parts, the readouts.
	show( dt ) {

		const sim = this.sim, camera = this.game.camera;
		if ( this.free ) {

			this.game.inspect.update( dt );

		} else {

			camera.position.copy( this.camera.position );
			camera.quaternion.copy( this.camera.quaternion );
			const across = 2 * Math.atan( Math.tan( THREE.MathUtils.degToRad( this.camera.fov ) / 2 ) * this.camera.aspect );
			const fov = THREE.MathUtils.radToDeg( 2 * Math.atan( Math.tan( across / 2 ) / camera.aspect ) );
			if ( Math.abs( camera.fov - fov ) > 1e-6 ) {

				camera.fov = fov;
				camera.updateProjectionMatrix();

			}

		}

		this.parts.draw( sim );
		this.readout();

	}

	readout() {

		const run = this.run, display = this.display, f = Math.max( 0, run.f - 1 ), index = run.stationOf[ f ] ?? 0, place = this.placed[ index ];
		const total = run.complete ? run.frames : this.estimate();
		display.time = clock( run.f * DT );
		display.total = `${run.complete ? '' : '~'}${clock( total * DT )}`;
		const record = run.log[ index ], runner = this.sim.runner;
		const where = { number: index + 1, count: this.placed.length, name: place.station.name, color: FAMILIES[ place.station.family ] ?? '#888', result: record?.result ?? '', reason: record?.reason ?? '' };
		if ( ! display.where || Object.keys( where ).some( ( key ) => display.where[ key ] !== where[ key ] ) ) display.where = where;
		display.runner = `${this.sim.ragdoll.active ? 'limp' : runner.state} · ${runner.speed.toFixed( 1 )} m/s`;
		display.station = index;
		const failed = run.complete && run.log.some( ( r ) => r.result !== 'pass' );
		display.status.text = run.complete ? `${run.log.filter( ( r ) => r.result === 'pass' ).length}/${run.log.length} Pass${run.mismatch ? ` · Mismatch F${run.mismatch.f}` : ''}` : `Running ${Math.round( 100 * run.pilot.state.station / this.placed.length )}%`;
		display.status.warn = Boolean( run.mismatch ) || failed;
		// The fingerprint tools/bench/run.mjs prints for the same code, engine and view.
		if ( run.complete && ! display.status.title ) display.status.title = `Fingerprint ${run.fingerprint()}`;
		this.drawKeys( f );

	}

	// The run's length, guessed from the stations so far until it is all worked out (frames).
	estimate() {

		const run = this.run, done = run.pilot.state.station;
		return done ? Math.max( run.frames, run.frames / done * this.placed.length ) : run.frames + 7 / DT * this.placed.length;

	}

	// The keys and mouse buttons the autopilot holds this frame, as a player would on a keyboard.
	drawKeys( f ) {

		const run = this.run;
		if ( f >= run.frames ) return;
		const frame = run.frameAt( f ), held = new Set( [ ...frame.keys, ...frame.buttons.map( ( b ) => `Mouse${b}` ) ] );
		const pressed = new Set( frame.edges.filter( ( [ , edge ] ) => edge === 'pressed' ).map( ( [ key ] ) => key ) );
		const [ mx, my ] = frame.mouse;
		const flick = Math.abs( mx ) > 1.5 || Math.abs( my ) > 1.5 ? ( Math.abs( mx ) > Math.abs( my ) ? ( mx > 0 ? '→' : '←' ) : ( my > 0 ? '↓' : '↑' ) ) : '';
		const keys = KEYS.map( ( [ code, label ] ) => ( { code, label, on: held.has( code ), hit: pressed.has( code ) } ) );
		const mouse = flick ? `Flick ${flick}` : mx ? `Turn ${mx > 0 ? '→' : '←'} ${Math.abs( mx ).toFixed( 2 )}` : '';
		const key = keys.map( ( k ) => `${+ k.on}${+ k.hit}` ).join( '' ) + mouse;
		if ( key === this.keysShown ) return;
		this.keysShown = key;
		this.display.keys = keys;
		this.display.mouse = mouse;

	}

	fillStations() {

		const families = [];
		this.placed.forEach( ( place, index ) => {

			if ( families.at( - 1 )?.family !== place.station.family ) families.push( { family: place.station.family, stations: [] } );
			families.at( - 1 ).stations.push( { index, name: place.station.name } );

		} );
		this.display.families = families;

	}

	syncButtons() {

		Object.assign( this.display, { engine: this.engine, view: this.view, speed: this.speed, filter: this.filter, playing: this.playing, free: this.free } );

	}

	// The free camera looks round the runner where it is; turned off, the run's camera has the view again.
	setFree( on ) {

		this.free = on;
		const inspect = this.game.inspect;
		if ( on ) {

			const at = this.sim.runner.position, behind = this.camera.position;
			inspect.frame( behind.clone(), at.clone() );

		}

		inspect.enable( on );
		this.syncButtons();

	}

	// ---- Timelines

	// The overview's frame at x, and x of a frame.
	overviewFrame( x ) {

		const total = this.run.complete ? this.run.frames : this.estimate();
		return Math.round( x / this.overview.clientWidth * total );

	}

	// The detail timeline's window: `detail` seconds, the playhead a third of the way in.
	detailWindow() {

		const span = this.detail / DT, f0 = Math.max( 0, this.run.f - span / 3 );
		return [ f0, f0 + span ];

	}

	pointer( event, canvas ) {

		if ( ! this.run || this.busy ) return;
		const rect = canvas.getBoundingClientRect();
		const frameAt = ( x ) => {

			if ( canvas === this.overview ) return this.overviewFrame( x );
			const [ f0, f1 ] = this.dragWindow;
			return Math.round( f0 + x / rect.width * ( f1 - f0 ) );

		};

		// A comment's bar on the detail timeline selects it.
		if ( canvas === this.detailCanvas ) {

			const hit = this.commentAt( event.clientX - rect.left, event.clientY - rect.top );
			if ( hit ) return this.goToComment( hit.id );

		}

		this.dragWindow = this.detailWindow();
		const wasPlaying = this.playing;
		this.pause();
		const move = ( moved ) => {

			const f = frameAt( moved.clientX - rect.left );
			if ( f <= this.run.frames ) this.run.seek( Math.max( 1, f ) );
			else this.goTo( f );

		};

		move( event );
		canvas.setPointerCapture( event.pointerId );
		const up = () => {

			canvas.removeEventListener( 'pointermove', move );
			canvas.removeEventListener( 'pointerup', up );
			this.playing = wasPlaying;
			this.syncButtons();

		};

		canvas.addEventListener( 'pointermove', move );
		canvas.addEventListener( 'pointerup', up );

	}

	hover( event ) {

		const rect = this.detailCanvas.getBoundingClientRect();
		this.hovered = this.commentAt( event.clientX - rect.left, event.clientY - rect.top )?.id ?? null;
		this.detailCanvas.title = this.hovered ? this.comments.find( ( c ) => c.id === this.hovered )?.text ?? '' : '';

	}

	draw() {

		if ( ! this.run ) return;
		this.drawOverview();
		this.drawDetail();

	}

	// Sizes a canvas to its box and the screen's pixels; returns its 2D context in CSS pixels.
	fit( canvas, height ) {

		const ratio = devicePixelRatio || 1, width = canvas.clientWidth;
		if ( canvas.width !== Math.round( width * ratio ) ) canvas.width = Math.round( width * ratio );
		if ( canvas.height !== Math.round( height * ratio ) ) canvas.height = Math.round( height * ratio );
		canvas.style.height = `${height}px`;
		const c = canvas.getContext( '2d' );
		c.setTransform( ratio, 0, 0, ratio, 0, 0 );
		c.clearRect( 0, 0, width, height );
		c.font = '10px ui-monospace, SF Mono, Menlo, monospace';
		c.textBaseline = 'middle';
		return { c, width };

	}

	// The whole run: stations by family (failed ones marked), comments, what is worked out, the playhead.
	drawOverview() {

		const run = this.run, { c, width } = this.fit( this.overview, OVERVIEW_HEIGHT );
		const total = run.complete ? run.frames : this.estimate(), x = ( f ) => f / total * width;
		c.fillStyle = 'rgba(255,255,255,0.04)';
		c.fillRect( 0, 0, width, OVERVIEW_HEIGHT );
		this.placed.forEach( ( place, index ) => {

			const start = run.stationStart( index );
			if ( start === null ) return;
			const end = run.log[ index ]?.end ?? run.frames;
			c.fillStyle = FAMILIES[ place.station.family ] ?? '#888';
			c.globalAlpha = 0.75;
			c.fillRect( x( start ), 4, Math.max( 1, x( end ) - x( start ) - 0.5 ), 12 );
			c.globalAlpha = 1;
			if ( run.log[ index ] && run.log[ index ].result !== 'pass' ) {

				c.fillStyle = '#ff5a4f';
				c.fillRect( x( start ), 0, Math.max( 2, x( end ) - x( start ) ), 3 );

			}

		} );

		for ( const comment of this.visibleComments() ) {

			const at = this.place( comment );
			if ( ! at ) continue;
			c.fillStyle = COMMENT_COLORS[ comment.view ] ?? '#fff';
			c.fillRect( x( at.f0 ), 19, Math.max( 2, x( at.f1 ) - x( at.f0 ) ), 4 );

		}

		// Not yet worked out.
		c.fillStyle = 'rgba(0,0,0,0.45)';
		c.fillRect( x( run.frames ), 0, width - x( run.frames ), OVERVIEW_HEIGHT );
		// The detail timeline's window.
		const [ d0, d1 ] = this.detailWindow();
		c.strokeStyle = 'rgba(255,255,255,0.35)';
		c.strokeRect( x( d0 ) + 0.5, 0.5, Math.max( 2, x( d1 ) - x( d0 ) ), OVERVIEW_HEIGHT - 1 );
		c.fillStyle = '#fff';
		c.fillRect( x( run.f ) - 1, 0, 2, OVERVIEW_HEIGHT );
		c.fillStyle = 'rgba(255,255,255,0.55)';
		for ( let minute = 1; minute * 60 / DT < total; minute ++ ) c.fillText( `${minute}m`, x( minute * 60 / DT ) + 2, 27 );

	}

	// Around the playhead: a ruler, the stations by name, the runner's states, the comments in rows, the playhead.
	drawDetail() {

		const run = this.run, [ f0, f1 ] = this.detailWindow();
		const rows = this.commentRows();
		const height = LANES.comments[ 0 ] + Math.max( 1, rows.length ) * COMMENT_ROW + 2;
		const { c, width } = this.fit( this.detailCanvas, height ), x = ( f ) => ( f - f0 ) / ( f1 - f0 ) * width;

		// The ruler: a tick every second (every 5 or 10 when zoomed out), labelled every few.
		const every = this.detail > 120 ? 10 : this.detail > 40 ? 5 : 1, label = every * ( this.detail > 20 ? 5 : 2 );
		c.fillStyle = 'rgba(255,255,255,0.5)';
		for ( let s = Math.ceil( f0 * DT / every ) * every; s / DT <= f1; s += every ) {

			c.fillRect( x( s / DT ), 0, 1, s % label === 0 ? 8 : 4 );
			if ( s % label === 0 ) c.fillText( clock( s ).replace( /\.0$/, '' ), x( s / DT ) + 3, 7 );

		}

		// The stations.
		const [ sy, sh ] = LANES.stations;
		this.placed.forEach( ( place, index ) => {

			const start = run.stationStart( index );
			if ( start === null || start > f1 ) return;
			const end = run.log[ index ]?.end ?? run.frames;
			if ( end < f0 ) return;
			const a = Math.max( 0, x( start ) ), b = Math.min( width, x( end ) );
			c.fillStyle = FAMILIES[ place.station.family ] ?? '#888';
			c.globalAlpha = 0.55;
			c.fillRect( a, sy, Math.max( 1, b - a - 1 ), sh );
			c.globalAlpha = 1;
			const record = run.log[ index ];
			if ( record && record.result !== 'pass' ) {

				c.strokeStyle = '#ff5a4f';
				c.strokeRect( a + 0.5, sy + 0.5, Math.max( 1, b - a - 2 ), sh - 1 );

			}

			c.save();
			c.beginPath();
			c.rect( a, sy, Math.max( 0, b - a - 4 ), sh );
			c.clip();
			c.fillStyle = '#fff';
			c.fillText( `${index + 1}. ${place.station.name}`, a + 4, sy + sh / 2 );
			c.restore();

		} );

		// The runner's states.
		const [ ty, th ] = LANES.states;
		let runStart = Math.max( 0, Math.floor( f0 ) ), runState = run.stateAt( runStart );
		const last = Math.min( run.frames, Math.ceil( f1 ) );
		for ( let f = runStart + 1; f <= last; f ++ ) {

			const state = f < last ? run.stateAt( f ) : null;
			if ( state === runState ) continue;
			c.fillStyle = stateColor( runState );
			c.fillRect( x( runStart ), ty, Math.max( 1, x( f ) - x( runStart ) ), th );
			runStart = f;
			runState = state;

		}

		// The comments, a row each where they overlap; the selected and hovered ones bright.
		this.commentBars = [];
		rows.forEach( ( row, r ) => {

			const y = LANES.comments[ 0 ] + r * COMMENT_ROW;
			for ( const { comment, at } of row ) {

				if ( at.f1 < f0 || at.f0 > f1 ) continue;
				const a = x( at.f0 ), b = Math.max( a + 3, x( at.f1 ) ), lit = comment.id === this.selected || comment.id === this.hovered;
				c.fillStyle = COMMENT_COLORS[ comment.view ] ?? '#fff';
				c.globalAlpha = comment.done ? 0.3 : lit ? 1 : 0.7;
				c.fillRect( a, y, b - a, COMMENT_ROW - 3 );
				c.globalAlpha = 1;
				if ( ! at.exact ) {

					c.setLineDash( [ 2, 2 ] );
					c.strokeStyle = '#fff';
					c.strokeRect( a + 0.5, y + 0.5, b - a - 1, COMMENT_ROW - 4 );
					c.setLineDash( [] );

				}

				c.save();
				c.beginPath();
				c.rect( a, y, b - a, COMMENT_ROW );
				c.clip();
				c.fillStyle = '#071216';
				c.fillText( comment.text.split( '\n' )[ 0 ], a + 3, y + ( COMMENT_ROW - 3 ) / 2 );
				c.restore();
				this.commentBars.push( { id: comment.id, a, b, y } );

			}

		} );

		// The draft's stretch.
		if ( this.draft ) {

			c.fillStyle = 'rgba(255,255,255,0.12)';
			c.fillRect( x( this.draft.f0 ), 0, Math.max( 2, x( this.draft.f1 ) - x( this.draft.f0 ) ), height );

		}

		// Not yet worked out, and the playhead.
		if ( run.frames < f1 ) {

			c.fillStyle = 'rgba(0,0,0,0.45)';
			c.fillRect( x( run.frames ), 0, width - x( run.frames ), height );

		}

		c.fillStyle = '#fff';
		c.fillRect( x( run.f ) - 1, 0, 2, height );

	}

	commentAt( x, y ) {

		return ( this.commentBars ?? [] ).find( ( bar ) => x >= bar.a && x <= bar.b && y >= bar.y && y <= bar.y + COMMENT_ROW ) ?? null;

	}

	// ---- For reviewing (the QA console's bench helpers)

	/**
	 * The stretch a comment covers on this run, or `from`…`to` seconds.
	 * @param {object} options `{ comment }` (an id) or `{ from, to }` (s)
	 * @returns {Promise<{f0: number, f1: number}>}
	 */
	async stretch( { comment = null, from = null, to = null } = {} ) {

		if ( comment ) {

			const found = this.comments.find( ( c ) => c.id === comment );
			if ( ! found ) throw new Error( `no comment ${comment}` );
			await this.workToStation( this.placed.findIndex( ( place ) => place.station.id === ( found.endStation ?? found.station ) ) );
			const at = this.place( found );
			await this.workTo( at.f1 + 1 );
			return { f0: at.f0, f1: at.f1 };

		}

		const f0 = Math.round( ( from ?? this.run.f * DT ) / DT ), f1 = Math.round( ( to ?? from + 2 ) / DT );
		await this.workTo( f1 + 1 );
		return { f0, f1 };

	}

	/**
	 * What the run did frame by frame over a stretch (BenchRun.rows).
	 * @param {number} f0
	 * @param {number} f1
	 * @param {number} [every]
	 * @returns {object[]}
	 */
	rows( f0, f1, every = 6 ) {

		return this.run.rows( f0, f1, every );

	}

	/**
	 * Stills of frames as one image, each labelled with its time, station and state: from the run's camera, or orbiting
	 * the runner (`orbit: { yaw, pitch, dist }`, degrees and m).
	 * @param {number[]} frames
	 * @param {object} [options]
	 * @returns {Promise<Blob>} a JPEG
	 */
	async sheet( frames, { cols = 4, w = 512, orbit = null } = {} ) {

		const run = this.run, back = run.f, shots = [], labels = [], camera = this.game.camera;
		const wasFree = this.free;
		this.setFree( false );
		try {

			for ( const f of frames ) {

				run.seek( Math.max( 1, Math.min( f, run.frames ) ) );
				this.show( 0 );
				if ( orbit ) {

					const hips = this.sim.runner.position, distance = orbit.dist ?? 3.5, yaw = ( orbit.yaw ?? 90 ) * Math.PI / 180, pitch = ( orbit.pitch ?? 10 ) * Math.PI / 180;
					camera.position.set( hips.x + Math.sin( yaw ) * Math.cos( pitch ) * distance, hips.y + Math.sin( pitch ) * distance, hips.z + Math.cos( yaw ) * Math.cos( pitch ) * distance );
					camera.lookAt( hips );

				}

				shots.push( await createImageBitmap( await this.qa.snap( w ) ) );
				const place = this.placed[ run.stationOf[ run.f - 1 ] ];
				labels.push( `${clock( run.f * DT )} · f${run.f} · ${place.station.id} · ${this.sim.ragdoll.active ? 'limp' : this.sim.runner.state}` );

			}

		} finally {

			run.seek( back );
			this.setFree( wasFree );

		}

		const h = shots[ 0 ].height, canvas = document.createElement( 'canvas' );
		canvas.width = w * Math.min( cols, shots.length );
		canvas.height = h * Math.ceil( shots.length / cols );
		const c = canvas.getContext( '2d' );
		c.font = '600 14px ui-monospace, Menlo, monospace';
		shots.forEach( ( bitmap, i ) => {

			const x = ( i % cols ) * w, y = Math.floor( i / cols ) * h;
			c.drawImage( bitmap, x, y );
			c.fillStyle = 'rgba(0,0,0,0.6)';
			c.fillRect( x, y, c.measureText( labels[ i ] ).width + 12, 22 );
			c.fillStyle = '#fff';
			c.fillText( labels[ i ], x + 6, y + 16 );

		} );
		return new Promise( ( resolve ) => canvas.toBlob( resolve, 'image/jpeg', 0.86 ) );

	}

	// ---- Comments

	// The comments from the QA store (listed once the stations are placed).
	async loadComments() {

		try {

			this.comments = ( await store.benchComments() ).comments ?? [];

		} catch ( error ) {

			this.comments = [];
			toast( `Comments failed to load · ${error.message}`, 'warn' );

		}

	}

	// The comments shown: all, or those about this view.
	visibleComments() {

		return this.comments.filter( ( comment ) => this.filter === 'all' || comment.view === 'both' || comment.view === this.view );

	}

	/**
	 * Where a comment falls on this run (comments.js).
	 * @param {object} comment
	 * @returns {{f0: number, f1: number, exact: boolean}|null}
	 */
	place( comment ) {

		return placeComment( comment, this.run, { engine: this.engine, view: this.view } );

	}

	// The comments placed on this run, in rows so that none in a row overlap.
	commentRows() {

		const placed = this.visibleComments().map( ( comment ) => ( { comment, at: this.place( comment ) } ) ).filter( ( p ) => p.at ).sort( ( a, b ) => a.at.f0 - b.at.f0 );
		const rows = [];
		for ( const item of placed ) {

			const row = rows.find( ( r ) => r[ r.length - 1 ].at.f1 < item.at.f0 );
			if ( row ) row.push( item );
			else rows.push( [ item ] );

		}

		return rows;

	}

	fillComments() {

		const comments = this.visibleComments();
		this.display.count = comments.length ? `${comments.length}${comments.length !== this.comments.length ? ` of ${this.comments.length}` : ''}` : '';
		this.display.comments = comments.map( ( comment ) => ( {
			id: comment.id,
			when: `${clock( comment.t0 )}–${clock( comment.t1 )}`,
			view: VIEW_NAMES[ comment.view ],
			engine: ENGINE_NAMES[ comment.engine ] ?? comment.engine,
			color: COMMENT_COLORS[ comment.view ],
			station: this.placed.find( ( place ) => place.station.id === comment.station )?.station.name ?? comment.stationName ?? comment.station,
			text: comment.text,
			done: Boolean( comment.done ),
			selected: comment.id === this.selected,
		} ) );

	}

	async goToComment( id ) {

		const comment = this.comments.find( ( c ) => c.id === id );
		if ( ! comment ) return;
		this.selected = id;
		this.fillComments();
		await this.workToStation( this.placed.findIndex( ( place ) => place.station.id === ( comment.endStation ?? comment.station ) ) );
		const at = this.place( comment );
		if ( at ) await this.goTo( at.f0 + 1 );

	}

	startDraft() {

		if ( ! this.run ) return;
		const f = this.run.f;
		this.playing = false;
		this.draft = { f0: Math.max( 1, f - Math.round( COMMENT_SPAN / DT ) ), f1: f, text: '', view: this.view, engine: this.engine };
		this.editDraft( {} );
		this.syncButtons();

	}

	editDraft( change ) {

		if ( ! this.draft ) return;
		Object.assign( this.draft, change );
		const { f0, f1, view, engine } = this.draft;
		const first = this.placed[ this.run.stationOf[ Math.max( 0, f0 - 1 ) ] ?? 0 ].station, last = this.placed[ this.run.stationOf[ Math.max( 0, f1 - 1 ) ] ?? 0 ].station;
		this.display.draft = {
			where: `${clock( f0 * DT )}–${clock( f1 * DT )} · ${first.name}${last !== first ? ` → ${last.name}` : ''}`,
			view, engine, engines: [ this.engine, 'both' ],
		};

	}

	endDraft() {

		this.draft = null;
		this.display.draft = null;
		document.activeElement?.blur?.();

	}

	// The draft saved: where it is on this run and in its station, the code it was made on, and a still of the moment.
	async saveDraft() {

		const draft = this.draft;
		if ( ! draft ) return;
		const text = draft.text.trim();
		if ( ! text ) return;
		const now = new Date(), pad = ( x ) => String( x ).padStart( 2, '0' );
		const id = `c${now.getFullYear()}${pad( now.getMonth() + 1 )}${pad( now.getDate() )}-${pad( now.getHours() )}${pad( now.getMinutes() )}${pad( now.getSeconds() )}`;
		const comment = makeComment( { id, text, view: draft.view, engine: draft.engine, run: this.run, made: { engine: this.engine, view: this.view }, f0: draft.f0, f1: draft.f1, now } );
		this.endDraft();
		try {

			comment.build = await store.build().catch( () => null );
			const still = await this.qa.snap( 960 );
			await store.putBenchFile( `${id}.jpg`, still );
			comment.still = `${id}.jpg`;
			await store.putBenchComment( comment );
			this.comments.push( comment );
			this.selected = id;
			this.fillComments();
			toast( 'Comment saved', 'good' );

		} catch ( error ) {

			console.error( error );
			toast( `Save failed · ${error.message}`, 'warn' );

		}

	}

	async editComment( id, change ) {

		const comment = this.comments.find( ( c ) => c.id === id );
		if ( ! comment || Object.entries( change ).every( ( [ key, value ] ) => comment[ key ] === value ) ) return;
		Object.assign( comment, change, { updated: new Date().toISOString() } );
		try {

			await store.putBenchComment( comment );

		} catch ( error ) {

			toast( `Save failed · ${error.message}`, 'warn' );

		}

		this.fillComments();

	}

	toggleDone( id ) {

		const comment = this.comments.find( ( c ) => c.id === id );
		if ( comment ) this.editComment( id, { done: ! comment.done } );

	}

	async removeComment( id ) {

		const comment = this.comments.find( ( c ) => c.id === id );
		if ( ! comment || ! confirm( `Delete "${comment.text.slice( 0, 60 )}"?` ) ) return;
		try {

			await store.removeBenchComment( id );
			this.comments = this.comments.filter( ( c ) => c.id !== id );
			this.fillComments();

		} catch ( error ) {

			toast( `Delete failed · ${error.message}`, 'warn' );

		}

	}

}

export { Bench, FAMILIES };
