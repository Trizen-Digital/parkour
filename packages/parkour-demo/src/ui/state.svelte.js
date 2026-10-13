// The UI's shared state: one reactive object the Svelte components read (src/ui/App.svelte) and the game writes like
// any object. The game, the QA tools and the benchmark keep their own logic; what they show goes through here, or
// through a view of their own made with `reactive()`.

// The demo's own options (the HUD, the look, the sound's volumes), kept in the browser between visits. None changes a
// run, so none goes on a QA tape.
const STORAGE_KEY = 'parkour-demo-options';

// The options' version, kept with them: options saved by an older one take the defaults that have changed since
// (version 2: the course look's default became Vision Full).
const VERSION = 2;
const CHANGED = { 2: [ 'view' ] };

const OPTION_DEFAULTS = Object.freeze( {
	jumpMeter: true,
	fps: false,
	debug: false,
	// The route's markers drawn on the course (the course tools' overlay).
	markers: false,
	view: 'full',
	sky: 0.45,
	exposure: 1,
	// The graphics (src/stage/quality.js): the quality, 'auto' (the best tier that holds 60 frames a second, found at
	// each load and kept in `detected`), a tier's id, or 'custom'; and what it sets, the render scale (pixels per CSS
	// pixel) and the bounced light.
	quality: 'auto',
	detected: '',
	renderScale: 1,
	ssgi: true,
	motionBlur: false,
	// The sound's volumes, 0 to 1, and whether a hidden tab is silent.
	volume: 0.8,
	effectsVolume: 1,
	windVolume: 0.7,
	ambientVolume: 1,
	muteUnfocused: true,
	// The game mode last chosen (src/ui/GameMode.svelte): 'tutorial' or 'sandbox', '' before the first choice (the
	// first load opens the menu); the Sandbox's course; the tutorial's lessons done, by id (src/tutorial/lessons.js).
	mode: '',
	sandbox: 'foundry',
	lessonsDone: [],
} );

function loadOptions() {

	try {

		const saved = JSON.parse( localStorage.getItem( STORAGE_KEY ) || '{}' );
		for ( let version = ( saved.version ?? 1 ) + 1; version <= VERSION; version ++ ) for ( const key of CHANGED[ version ] ?? [] ) delete saved[ key ];
		const kept = ( key, value ) => Array.isArray( value ) ? Array.isArray( saved[ key ] ) : typeof saved[ key ] === typeof value;
		return Object.fromEntries( Object.entries( OPTION_DEFAULTS ).map( ( [ key, value ] ) => [ key, kept( key, value ) ? saved[ key ] : value ] ) );

	} catch {

		return { ...OPTION_DEFAULTS };

	}

}

const ui = $state( {
	/** What covers the game: null in play, else 'pause', 'settings', 'mode', 'replays', 'editor' or 'bench'. */
	screen: null,
	/** Where the Game Mode screen goes back to: 'pause' when the pause menu opened it, null (play) over the game. */
	modeBack: null,
	/** The settings tab on show, and the pause menu's item. */
	tab: 'game',
	menuItem: 0,
	/**
	 * The device in use (src/ui/nav.js follows it): 'keyboard' (and the mouse), 'pad' or 'touch', whose controls then
	 * show (src/ui/TouchControls.svelte) and which the prompts and the lessons name. A phone or a tablet (no hover, a
	 * coarse pointer) starts on touch.
	 */
	device: globalThis.matchMedia?.( '(hover: none) and (pointer: coarse)' ).matches ? 'touch' : 'keyboard',
	/** The game's HUD, written each frame by the player: `use` is the touch controls' Use button's word, or '' to hide it. */
	hud: { hidden: false, captured: false, charge: 0, full: false, easy: false, slow: false, slowHeld: false, use: '', fps: '', debug: '' },
	/** The tutorial's lesson card (src/tutorial/Tutorial.js), or null off the tutorial's course. */
	lesson: null,
	/** The banner while play waits for a press, or ''. */
	armed: '',
	toasts: [],
	/** The demo's version and commit, for the menus' footer. */
	build: '',
	/** The course validator's list, or null when it is not shown. */
	report: null,
	options: loadOptions(),
} );

/**
 * Sets one of the demo's options and keeps it.
 * @param {string} key
 * @param {*} value
 */
function setOption( key, value ) {

	ui.options[ key ] = value;
	try {

		localStorage.setItem( STORAGE_KEY, JSON.stringify( { ...ui.options, version: VERSION } ) );

	} catch {}

}

let toastId = 0;

/**
 * A message at the top of the screen for a few seconds.
 * @param {string} text
 * @param {string} [kind] '', 'good' or 'warn' (stays longer)
 */
function toast( text, kind = '' ) {

	const id = ++ toastId;
	ui.toasts = [ ...ui.toasts.slice( - 2 ), { id, text, kind } ];
	setTimeout( () => ui.toasts = ui.toasts.filter( ( t ) => t.id !== id ), kind === 'warn' ? 6000 : 3000 );

}

/**
 * A reactive copy of an object, for a controller's own view state (the editor's, the benchmark's).
 * @template T
 * @param {T} object
 * @returns {T}
 */
function reactive( object ) {

	const state = $state( object );
	return state;

}

/**
 * A plain copy of reactive state, to save or hand to code outside the UI.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function snapshot( value ) {

	return $state.snapshot( value );

}

export { ui, OPTION_DEFAULTS, setOption, toast, reactive, snapshot };
