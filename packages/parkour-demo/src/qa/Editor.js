// The QA editor: a capture or a saved replay on a timeline, to scrub, play, trim, annotate and save.
//
// src/ui/Editor.svelte shows it from `view`: the title, the category, the notes pinned to frames, the details and the
// check (whether a saved replay still comes out the same), the transport and the timeline. The timeline is drawn here,
// on `canvas`: a ruler, the runner's states and moves as runs, its speed with the joint "pops" marked, the presses
// (held keys as bars, taps as letters), the events between frames, the window kept on save (bright; its ends drag),
// the notes and the playhead. Scrubbing shows the looks kept of each frame (visual.js), so nothing runs again. A saved
// replay's edits are saved as they are made.

import * as THREE from 'three/webgpu';
import { TUNING_DEFAULTS, showTuning } from '@trizen/parkour/sim/tuning.js';
import { store } from './store.js';
import { shareReplay } from './share.js';
import { PRESSES, decodeInput, engineOf, findPops, pressesOf, runAt, timesOf } from '@trizen/parkour/replay/tape.js';
import { reactive, toast, ui } from '../ui/state.svelte.js';

const SPEEDS = [ 0.1, 0.25, 0.5, 1 ];

// The timeline's lanes: [ top, height ] (px).
const LANES = { ruler: [ 0, 16 ], states: [ 18, 16 ], moves: [ 36, 16 ], motion: [ 54, 22 ], input: [ 78, 18 ] };
const HEIGHT = 98;

// The speed lane is full at 8 m/s.
const TOP_SPEED = 800;

// A state's colour on the timeline, by kind: on the ground, sliding, in the air, bailing, on a ledge, on a wall, on a
// bar, pole, pipe or zipline.
const STATE_COLORS = [
	[ /^(standing|walking|sprinting|striding)$/, '#4b5868' ], [ /^(sliding|aiming)$/, '#7a6a3a' ],
	[ /^(falling|rising|precisionJump)$/, '#6f5aa8' ], [ /^(bailing|limp)$/, '#a8524a' ],
	[ /^(catchingLedge|hanging|leapingToLedge|vaulting|climbing|topping)/, '#2f6f7d' ], [ /^wall/, '#2f7d64' ], [ /^on/, '#9a7334' ], [ /./, '#5a6779' ],
];

// The presses held long enough to show as bars.
const BAR_COLORS = { jump: 'rgba(79,179,200,0.45)', grab: 'rgba(99,210,151,0.45)', sprint: 'rgba(240,180,90,0.35)' };
const PRESS = Object.fromEntries( PRESSES.map( ( press ) => [ press.name, press ] ) );

// Patches to a saved replay wait this long (ms) for more edits.
const PATCH_DELAY = 500;

const seconds = ( s ) => ( s < 0 ? '-' : '' ) + Math.abs( s ).toFixed( 2 ).padStart( 5, '0' );

class Editor {

	/**
	 * @param {QA} qa
	 */
	constructor( qa ) {

		this.qa = qa;
		/** What is open: `{ rec, visuals, rig, trace, kind: 'capture'|'saved', divergedAt, saved? }`, or null. */
		this.session = null;
		/** The playhead's frame. */
		this.frame = 0;
		this.playing = false;
		this.speed = 1;
		this.orbit = false;
		this.clock = 0;
		this.speeds = SPEEDS;
		this.view = reactive( {
			/** null (closed), 'loading' or 'edit'. */
			mode: null,
			loadingText: '',
			progress: 0,
			kind: 'capture',
			title: '',
			description: '',
			category: null,
			categories: [],
			notes: [],
			details: [],
			check: null,
			saved: '',
			playing: false,
			speed: 1,
			orbit: false,
			path: false,
			time: '',
			total: '',
			frame: '',
			readout: '',
			noteAt: '',
		} );

		this.canvas = document.createElement( 'canvas' );
		this.canvas.className = 'timeline';
		this.canvas.height = HEIGHT;
		this.context = this.canvas.getContext( '2d' );
		this.canvas.addEventListener( 'pointerdown', ( event ) => this.pointer( event ) );
		addEventListener( 'keydown', ( event ) => this.key( event ) );
		addEventListener( 'resize', () => this.draw() );

	}

	/**
	 * Shows the loading box while a replay runs.
	 * @param {string} [text]
	 */
	loading( text = 'Loading' ) {

		ui.screen = 'editor';
		this.view.mode = 'loading';
		this.status( text );
		this.progress( 0 );

	}

	/** @param {number} fraction 0…1 */
	progress( fraction ) {

		this.view.progress = Math.min( 1, fraction );

	}

	/** @param {string} text */
	status( text ) {

		this.view.loadingText = text;

	}

	/**
	 * Opens a capture (on its last frame) or a saved replay (on its window's start).
	 * @param {object} session see `session`
	 */
	open( session ) {

		this.session = session;
		const rec = session.rec, view = this.view;
		rec.window ??= { ...rec.range };
		this.times = timesOf( rec.input.dt );
		this.presses = pressesOf( decodeInput( rec.input ) );
		this.pops = new Set( findPops( session.trace.acc, rec.range.from, rec.range.to ) );
		this.playing = false;
		Object.assign( view, { kind: session.kind, title: rec.title ?? '', description: rec.description ?? '', category: rec.category ?? null, saved: '', playing: false } );
		this.frame = session.kind === 'capture' ? rec.range.to : rec.window.from;
		this.fillMeta();
		this.qa.loadCategories().then( ( list ) => view.categories = list.map( ( { id, name, color } ) => ( { id, name, color } ) ) );
		this.fillNotes();
		this.setSpeed( this.speed );
		this.setOrbit( false );
		this.showPath( false );
		this.show( this.frame );
		this.draw();
		ui.screen = 'editor';
		view.mode = 'edit';

	}

	close() {

		clearTimeout( this.patchTimer );
		this.flush();
		this.playing = false;
		this.setOrbit( false );
		this.showPath( false );
		this.view.mode = null;
		this.session = null;

	}

	// The recording's course, lane, device, frame rate, Easy or Manual, physics engine, tuning off its defaults and
	// commit; and the check.
	fillMeta() {

		const { rec, kind, divergedAt } = this.session;
		const course = rec.course, setup = rec.setup ?? {}, settings = rec.settings ?? {};
		const tuned = Object.entries( settings.tuning ?? {} ).filter( ( [ key, value ] ) => key in TUNING_DEFAULTS && value !== TUNING_DEFAULTS[ key ] );
		this.view.details = [
			[ 'Course', course.name + ( course.generated ? ` · Seed ${course.generated.seed}` : '' ) ],
			course.lane !== null && course.lane !== undefined ? [ 'Lane', String( course.lane + 1 ) ] : null,
			[ 'Device', setup.device ?? '' ],
			setup.fps ? [ 'Frame Rate', `${setup.fps} FPS` ] : null,
			[ 'Mode', setup.easy ? 'Easy' : 'Manual' ],
			[ 'Physics', engineOf( settings ) ],
			tuned.length ? [ 'Tuning', tuned.map( ( [ key, value ] ) => `${key} ${showTuning( key, value )}` ).join( ', ' ) ] : null,
			rec.build?.commit ? [ 'Commit', `${rec.build.commit}${rec.build.dirty ? '+' : ''}` ] : null,
		].filter( Boolean );

		if ( kind === 'capture' ) this.view.check = null;
		else if ( divergedAt === null ) this.view.check = { ok: true, text: 'Exact' };
		else {

			// Off when it was saved too: the run is not deterministic. Off only now: the code or the course changed.
			const bug = rec.verified && ! rec.verified.ok;
			this.view.check = { ok: false, text: `Differs at ${seconds( this.time( divergedAt ) )} s`, cause: bug ? 'Not deterministic' : 'Code changed' };

		}

	}

	/** @param {string|null} id a category's id, or null for none */
	pickCategory( id ) {

		this.view.category = id;
		this.edit( { category: id } );

	}

	fillNotes() {

		const rec = this.session.rec;
		rec.notes.sort( ( a, b ) => a.f - b.f );
		this.view.notes = rec.notes.map( ( note ) => ( { id: note.id, f: note.f, text: note.text, time: seconds( this.time( note.f ) ), out: note.f < rec.window.from || note.f > rec.window.to } ) );

	}

	/**
	 * @param {string} id
	 * @param {string} text
	 */
	editNote( id, text ) {

		const rec = this.session?.rec, note = rec?.notes.find( ( n ) => n.id === id );
		if ( ! note || note.text === text ) return;
		note.text = text;
		this.edit( { notes: rec.notes } );

	}

	/** @param {string} id */
	removeNote( id ) {

		const rec = this.session.rec;
		rec.notes = rec.notes.filter( ( n ) => n.id !== id );
		this.edit( { notes: rec.notes } );
		this.fillNotes();
		this.draw();

	}

	/**
	 * A note at the playhead; on a saved replay its still is taken at once.
	 * @param {string} text
	 */
	async addNote( text ) {

		text = text.trim();
		if ( ! text ) return;
		const session = this.session, rec = session.rec, f = this.frame;
		const note = { id: `n${Date.now().toString( 36 )}`, f, t: + this.time( f ).toFixed( 3 ), text };
		rec.notes.push( note );
		this.fillNotes();
		this.draw();
		if ( session.kind === 'saved' ) {

			try {

				this.show( f );
				await store.putFile( `${rec.id}.${note.id}.jpg`, await this.qa.snap( 960 ) );
				note.still = `${rec.id}.${note.id}.jpg`;

			} catch ( error ) {

				toast( error.message, 'warn' );

			}

			this.edit( { notes: rec.notes } );

		}

	}

	/**
	 * An edit to the recording; on a saved replay it is saved after a pause in the typing.
	 * @param {object} fields
	 */
	edit( fields ) {

		const session = this.session;
		if ( ! session ) return;
		Object.assign( session.rec, fields );
		if ( session.kind !== 'saved' ) return;
		if ( this.patchRec !== session.rec ) this.flush();
		this.patchRec = session.rec;
		this.patch = { ...this.patch, ...fields };
		this.view.saved = 'Saving';
		clearTimeout( this.patchTimer );
		this.patchTimer = setTimeout( () => this.flush(), PATCH_DELAY );

	}

	async flush() {

		const fields = this.patch, rec = this.patchRec;
		this.patch = null;
		if ( ! fields || ! rec ) return;
		try {

			await store.patch( rec.id, { ...fields, updated: new Date().toISOString() } );
			if ( this.session?.rec === rec ) this.view.saved = 'Saved';

		} catch ( error ) {

			toast( error.message, 'warn' );

		}

	}

	// Shares the saved replay: its .qa.zip downloads and a GitHub issue opens, filled in from it.
	async share() {

		const rec = this.session?.rec;
		if ( ! rec ) return;
		try {

			const { fileName, opened } = await shareReplay( rec.id );
			toast( opened ? `Attach ${fileName} to the new issue` : `Pop-up blocked · attach ${fileName} to a new issue`, opened ? 'good' : 'warn' );

		} catch ( error ) {

			toast( error.message, 'warn' );

		}

	}

	// Whether closing would lose something: a capture with notes, a title, a description or a category.
	hasWork() {

		const rec = this.session?.rec;
		return !! rec && ! this.session.saved && ( rec.notes.length > 0 || !! rec.title?.trim() || !! rec.description?.trim() || !! rec.category );

	}

	// Saves a capture, then runs it again to check it replays exactly.
	async save() {

		const session = this.session;
		if ( session?.kind !== 'capture' || this.saving ) return;
		this.saving = true;
		this.setPlaying( false );
		this.setOrbit( false );
		try {

			this.loading( 'Saving' );
			if ( ! await this.qa.save( session ) ) return this.view.mode = 'edit';
			this.status( 'Checking' );
			const verified = await this.qa.verify( session );
			toast( verified.ok ? 'Saved' : `Saved · Differs at ${verified.at} s`, verified.ok ? 'good' : 'warn' );
			this.close();
			this.qa.backToPlay();

		} catch ( error ) {

			console.error( error );
			toast( `Save failed · ${error.message}`, 'warn' );
			this.view.mode = 'edit';

		} finally {

			this.saving = false;

		}

	}

	discard() {

		if ( this.hasWork() && ! confirm( 'Discard this capture?' ) ) return;
		this.close();
		this.qa.backToPlay();

	}

	// Closing a saved replay goes back to the library; closing a capture drops it.
	leave() {

		if ( this.session?.kind === 'capture' ) return this.discard();
		this.qa.openGallery();

	}

	async takeOver() {

		const session = this.session, f = this.frame;
		if ( session.kind === 'capture' && this.hasWork() && ! confirm( 'Play on without saving?' ) ) return;
		const rec = session.rec;
		this.close();
		this.loading();
		try {

			await this.qa.takeOver( rec, f );

		} catch ( error ) {

			console.error( error );
			toast( `Play from here failed · ${error.message}`, 'warn' );
			this.view.mode = null;
			this.qa.backToPlay();

		}

	}

	// A frame's time from the start of the recording's range (s).
	time( f ) {

		return this.times[ f ] - this.times[ this.session.rec.range.from ];

	}

	seek( f ) {

		const range = this.session.rec.range;
		this.frame = Math.max( range.from, Math.min( range.to, f ) );
		this.clock = this.times[ this.frame ];
		this.show( this.frame );
		this.draw();

	}

	/**
	 * Shows a frame's look. In orbit the camera stays the orbit's, and follows the hips from frame to frame.
	 * @param {number} f
	 */
	show( f ) {

		const session = this.session, look = session?.visuals.get( f );
		if ( ! look ) return;
		const rig = session.rig, camera = this.qa.game.camera;
		if ( this.orbit ) {

			rig.apply( look, { camera: null } );
			const hips = this.hips().getWorldPosition( _hips );
			if ( this.followed ) {

				const moved = _moved.subVectors( hips, this.followed ), controls = this.qa.game.inspect.controls;
				controls.object.position.add( moved );
				controls.target.add( moved );

			}

			this.followed = ( this.followed ?? new THREE.Vector3() ).copy( hips );

		} else rig.apply( look, { camera } );
		this.readout( f );

	}

	hips() {

		const figure = this.session.rig.figure;
		return ( figure.roles?.hips && figure.root.getObjectByName( figure.roles.hips ) ) || figure.root;

	}

	readout( f ) {

		const session = this.session, trace = session.trace, rec = session.rec, view = this.view;
		const move = runAt( trace.moves, f ), kept = rec.window;
		view.time = seconds( this.time( f ) );
		view.total = seconds( this.time( rec.range.to + 1 ) );
		view.frame = String( f - rec.range.from );
		view.noteAt = seconds( this.time( f ) );
		view.readout = [
			runAt( trace.states, f ),
			move ? `${move} ${( trace.tau[ f ] / 1000 ).toFixed( 2 )}` : null,
			`${( trace.v[ f ] / 100 ).toFixed( 2 )} m/s`,
			this.pops.has( f ) || this.pops.has( f - 1 ) ? 'POP' : null,
			runAt( trace.easys ?? [], f ) ? 'EASY' : null,
			f < kept.from || f > kept.to ? 'CUT' : null,
		].filter( Boolean ).join( ' · ' );

	}

	toggle() {

		this.setPlaying( ! this.playing );

	}

	setPlaying( on ) {

		const session = this.session;
		if ( ! session ) return;
		const kept = session.rec.window;
		this.playing = on;
		if ( on && ( this.frame >= kept.to || this.frame < kept.from ) ) this.seek( kept.from );
		this.clock = this.times[ this.frame ];
		this.view.playing = on;

	}

	setSpeed( speed ) {

		this.speed = speed;
		this.view.speed = speed;

	}

	/**
	 * Plays on at the chosen speed, looping the window (each frame), moves the orbit, and draws the timeline when it
	 * changed.
	 * @param {number} dt
	 */
	update( dt ) {

		const session = this.session;
		if ( ! session ) return;
		if ( this.playing ) {

			const kept = session.rec.window;
			this.clock += dt * this.speed;
			let f = this.frame;
			while ( f < kept.to && this.times[ f + 1 ] <= this.clock ) f ++;
			if ( f >= kept.to && this.clock >= this.times[ kept.to + 1 ] ) {

				f = kept.from;
				this.clock = this.times[ f ];

			}

			if ( f !== this.frame ) {

				this.frame = f;
				this.show( f );
				this.draw();

			}

		}

		if ( this.orbit ) this.qa.game.inspect.update( dt );
		if ( this.dirty || this.canvas.width !== Math.round( this.canvas.clientWidth * ( devicePixelRatio || 1 ) ) ) this.paint();

	}

	setOrbit( on ) {

		const game = this.qa.game;
		this.orbit = on;
		this.view.orbit = on;
		this.followed = null;
		if ( on ) {

			const hips = this.hips().getWorldPosition( new THREE.Vector3() );
			game.inspect.frame( game.camera.position.clone(), hips );
			game.inspect.enable( true );
			this.followed = hips;

		} else {

			game.inspect.enable( Boolean( game.params.freeCamera ) && ! this.qa.open );
			if ( this.session ) this.show( this.frame );

		}

	}

	// The root's path over the range drawn in the course: as run now, and (amber) as recorded where they differ.
	showPath( on ) {

		const root = this.qa.game.root;
		if ( this.path ) {

			for ( const line of this.path ) {

				root.remove( line );
				line.geometry.dispose();
				line.material.dispose();

			}

			this.path = null;

		}

		this.view.path = on;
		if ( ! on || ! this.session ) return;
		const session = this.session, range = session.rec.range;
		const line = ( trace, color ) => {

			const points = [];
			for ( let f = range.from; f <= range.to; f ++ ) points.push( trace.x[ f ] / 1000, trace.y[ f ] / 1000 + 0.05, trace.z[ f ] / 1000 );
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( points, 3 ) );
			const path = new THREE.Line( geometry, new THREE.LineBasicMaterial( { color, depthTest: false, transparent: true, opacity: 0.9 } ) );
			path.renderOrder = 10;
			root.add( path );
			return path;

		};

		this.path = [ line( session.trace, 0x4fb3c8 ) ];
		if ( session.divergedAt !== null && session.kind === 'saved' ) this.path.push( line( session.rec.trace, 0xf0b45a ) );

	}

	key( event ) {

		if ( ui.screen !== 'editor' || this.view.mode !== 'edit' || ! this.session ) return;
		const typing = event.target.closest?.( 'input, textarea, select, [contenteditable]' );
		if ( event.key === 'Escape' ) {

			if ( typing ) return event.target.blur();
			// The run's input listens on the window after this: the key that closes the editor is not its first press
			// once play waits for one.
			event.preventDefault();
			event.stopImmediatePropagation();
			return this.leave();

		}

		if ( ( event.metaKey || event.ctrlKey ) && event.key === 's' ) {

			event.preventDefault();
			return this.session.kind === 'capture' ? this.save() : this.flush();

		}

		if ( typing ) return;
		const kept = this.session.rec.window, step = event.shiftKey ? 10 : 1;
		switch ( event.code ) {

			case 'Space': this.toggle(); break;
			case 'ArrowLeft': this.setPlaying( false ); this.seek( this.frame - step ); break;
			case 'ArrowRight': this.setPlaying( false ); this.seek( this.frame + step ); break;
			case 'Home': this.seek( kept.from ); break;
			case 'End': this.seek( kept.to ); break;
			case 'KeyI': this.trim( 'from', this.frame ); break;
			case 'KeyO': this.trim( 'to', this.frame ); break;
			case 'KeyN': document.querySelector( '.note-add' )?.focus(); break;
			default: return;

		}

		event.preventDefault();

	}

	// Moves one end of the window kept on save (at least a frame long).
	trim( end, f ) {

		const rec = this.session.rec, range = rec.range, kept = rec.window;
		if ( end === 'from' ) kept.from = Math.max( range.from, Math.min( f, kept.to - 1 ) );
		else kept.to = Math.min( range.to, Math.max( f, kept.from + 1 ) );
		kept.t0 = + this.times[ kept.from ].toFixed( 4 );
		kept.t1 = + this.times[ kept.to + 1 ].toFixed( 4 );
		this.edit( { window: { ...kept } } );
		this.fillNotes();
		this.readout( this.frame );
		this.draw();

	}

	// A frame's x on the timeline (px).
	x( f ) {

		const range = this.session.rec.range, t = this.times, width = this.canvas.clientWidth;
		return ( ( t[ f ] - t[ range.from ] ) / ( t[ range.to + 1 ] - t[ range.from ] ) ) * width;

	}

	frameAtX( x ) {

		const range = this.session.rec.range, t = this.times, width = this.canvas.clientWidth;
		const time = t[ range.from ] + ( Math.max( 0, Math.min( width, x ) ) / width ) * ( t[ range.to + 1 ] - t[ range.from ] );
		let lo = range.from, hi = range.to;
		while ( lo < hi ) {

			const mid = ( lo + hi + 1 ) >> 1;
			if ( t[ mid ] <= time ) lo = mid;
			else hi = mid - 1;

		}

		return lo;

	}

	// A press on the timeline: on a window end it drags the end, on a note's marker it goes there, else it scrubs.
	pointer( event ) {

		if ( ! this.session ) return;
		const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
		const kept = this.session.rec.window;
		const near = ( f ) => Math.abs( this.x( f ) - x ) < 7;
		let mode = 'scrub';
		if ( near( kept.to + 1 ) || near( kept.to ) ) mode = 'to';
		else if ( near( kept.from ) ) mode = 'from';
		else if ( y < LANES.ruler[ 1 ] ) {

			const note = this.session.rec.notes.find( ( n ) => Math.abs( this.x( n.f ) - x ) < 6 );
			if ( note ) return this.seek( note.f );

		}

		this.setPlaying( false );
		const move = ( moved ) => {

			const f = this.frameAtX( moved.clientX - rect.left );
			if ( mode !== 'scrub' ) this.trim( mode, f );
			this.seek( f );

		};

		move( event );
		this.canvas.setPointerCapture( event.pointerId );
		const up = () => {

			this.canvas.removeEventListener( 'pointermove', move );
			this.canvas.removeEventListener( 'pointerup', up );

		};

		this.canvas.addEventListener( 'pointermove', move );
		this.canvas.addEventListener( 'pointerup', up );

	}

	/** The timeline is drawn again on the next frame. */
	draw() {

		this.dirty = true;

	}

	paint() {

		this.dirty = false;
		const session = this.session;
		if ( ! session ) return;
		const canvas = this.canvas, pixelRatio = devicePixelRatio || 1, width = canvas.clientWidth, height = HEIGHT;
		if ( ! width ) return;
		if ( canvas.width !== Math.round( width * pixelRatio ) ) canvas.width = Math.round( width * pixelRatio );
		canvas.height = Math.round( height * pixelRatio );
		canvas.style.height = `${height}px`;
		const c = this.context, rec = session.rec, trace = session.trace, range = rec.range, kept = rec.window;
		c.setTransform( pixelRatio, 0, 0, pixelRatio, 0, 0 );
		c.clearRect( 0, 0, width, height );
		c.font = '10px ui-monospace, SF Mono, Menlo, monospace';
		c.textBaseline = 'middle';
		const X = ( f ) => this.x( f );

		// The ruler: half-second ticks, seconds labelled.
		const total = this.times[ range.to + 1 ] - this.times[ range.from ];
		c.fillStyle = 'rgba(255,255,255,0.04)';
		c.fillRect( 0, 0, width, LANES.ruler[ 1 ] );
		for ( let k = 0; k <= total * 2; k ++ ) {

			const x = ( k / 2 / total ) * width, whole = k % 2 === 0;
			c.fillStyle = whole ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)';
			c.fillRect( Math.round( x ), whole ? 8 : 11, 1, whole ? 8 : 5 );
			if ( whole && x < width - 14 ) {

				c.fillStyle = 'rgba(231,235,240,0.55)';
				c.fillText( `${k / 2}s`, x + 3, 6 );

			}

		}

		// States and moves: one block per run of the same value, labelled where it fits.
		const runs = ( list, lane, color, label ) => {

			const [ top, laneHeight ] = LANES[ lane ];
			for ( let i = 0; i < list.length; i ++ ) {

				const [ f0, value ] = list[ i ], f1 = Math.min( list[ i + 1 ]?.[ 0 ] ?? range.to + 1, range.to + 1 );
				if ( f1 <= range.from || f0 > range.to || ! value ) continue;
				const a = X( Math.max( f0, range.from ) ), b = X( f1 );
				c.fillStyle = color( value );
				c.fillRect( a, top, Math.max( 1, b - a - 1 ), laneHeight );
				const text = label( value );
				if ( b - a > c.measureText( text ).width + 8 ) {

					c.fillStyle = 'rgba(231,235,240,0.85)';
					c.fillText( text, a + 4, top + laneHeight / 2 + 0.5 );

				}

			}

		};

		runs( trace.states, 'states', ( state ) => STATE_COLORS.find( ( [ pattern ] ) => pattern.test( state ) )[ 1 ], ( state ) => state );
		runs( trace.moves, 'moves', () => '#2a7f90', ( move ) => move );

		// The speed, and a red marker over each pop.
		const [ motionTop, motionHeight ] = LANES.motion;
		c.fillStyle = 'rgba(255,255,255,0.03)';
		c.fillRect( 0, motionTop, width, motionHeight );
		c.beginPath();
		for ( let f = range.from; f <= range.to; f ++ ) {

			const y = motionTop + motionHeight - Math.min( 1, trace.v[ f ] / TOP_SPEED ) * ( motionHeight - 2 ) - 1;
			if ( f === range.from ) c.moveTo( X( f ), y );
			else c.lineTo( X( f ), y );

		}

		c.strokeStyle = 'rgba(127,211,227,0.8)';
		c.lineWidth = 1.25;
		c.stroke();
		c.fillStyle = '#ff5a4f';
		for ( const f of this.pops ) {

			const x = X( f );
			c.beginPath();
			c.moveTo( x - 4, motionTop );
			c.lineTo( x + 4, motionTop );
			c.lineTo( x, motionTop + 7 );
			c.fill();

		}

		// The input: Easy mode's spans, the held presses as bars, the taps as letters, the events between frames.
		const [ inputTop, inputHeight ] = LANES.input;
		for ( let i = 0; i < ( trace.easys ?? [] ).length; i ++ ) {

			const [ f0, on ] = trace.easys[ i ], f1 = Math.min( trace.easys[ i + 1 ]?.[ 0 ] ?? range.to + 1, range.to + 1 );
			if ( ! on || f1 <= range.from || f0 > range.to ) continue;
			c.fillStyle = 'rgba(99,210,151,0.10)';
			c.fillRect( X( Math.max( f0, range.from ) ), inputTop, X( f1 ) - X( Math.max( f0, range.from ) ), inputHeight );

		}

		const held = this.presses.held;
		for ( let f = range.from; f <= range.to; f ++ ) {

			const x = X( f ), x1 = X( f + 1 );
			Object.keys( BAR_COLORS ).forEach( ( name, k ) => {

				if ( ! held[ f ]?.has( name ) ) return;
				c.fillStyle = BAR_COLORS[ name ];
				c.fillRect( x, inputTop + inputHeight - 3 - 3 * k, x1 - x + 0.5, 3 );

			} );

		}

		for ( const [ f, name ] of this.presses.presses ) {

			if ( f < range.from || f > range.to || ! PRESS[ name ]?.letter ) continue;
			c.fillStyle = PRESS[ name ].color;
			c.fillText( PRESS[ name ].letter, X( f ) - 3, inputTop + 5 );

		}

		for ( const event of rec.events ?? [] ) {

			if ( event.f < range.from || event.f > range.to ) continue;
			c.fillStyle = event.respawn ? '#e7ebf0' : event.clear ? '#8b95a3' : '#f0b45a';
			c.fillText( event.respawn ? '⟲' : event.clear ? '∅' : '•', X( event.f ) - 3, inputTop + 5 );

		}

		// Where the run comes out differently.
		if ( session.divergedAt !== null && session.divergedAt <= range.to ) {

			const x = X( Math.max( session.divergedAt, range.from ) );
			c.fillStyle = 'rgba(240,180,90,0.9)';
			c.fillRect( x, LANES.states[ 0 ], 2, height - LANES.states[ 0 ] );

		}

		// Outside the window darkened; its ends as handles.
		c.fillStyle = 'rgba(10,12,16,0.62)';
		const windowStart = X( kept.from ), windowEnd = X( kept.to + 1 );
		c.fillRect( 0, LANES.ruler[ 1 ], windowStart, height );
		c.fillRect( windowEnd, LANES.ruler[ 1 ], width - windowEnd, height );
		c.fillStyle = '#e7ebf0';
		for ( const x of [ windowStart, windowEnd ] ) {

			c.fillRect( x - 1.5, LANES.ruler[ 1 ], 3, height - LANES.ruler[ 1 ] );
			c.fillRect( x - 4, height / 2 + 4, 8, 14 );

		}

		for ( const note of rec.notes ) {

			const x = X( note.f );
			c.fillStyle = '#f47c34';
			c.beginPath();
			c.moveTo( x - 5, 1 );
			c.lineTo( x + 5, 1 );
			c.lineTo( x, 10 );
			c.fill();

		}

		const playhead = X( this.frame );
		c.fillStyle = '#ffffff';
		c.fillRect( playhead - 0.75, 0, 1.5, height );

	}

}

const _hips = new THREE.Vector3(), _moved = new THREE.Vector3();

export { Editor };
