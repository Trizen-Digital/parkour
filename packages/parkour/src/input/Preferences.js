// The player's preferences: how the controls and the camera behave for them, kept in the browser between visits. The
// demo's settings set them, between frames; several change how a run plays (the toggles, the look inversion), so the
// QA recorder puts a change on its tape as a setting, as it does a tuning change.

const PREFERENCE_DEFAULTS = Object.freeze( {
	invertMouseY: false,
	invertStickY: false,
	// In first person the camera turns with the runner's head instead of the aim.
	headCamera: false,
	// Tricks stay in first person (off: a trick in first person shows in third person, then comes back).
	tricksInFirstPerson: true,
	cameraLag: true,
	// Sprint latches on a press instead of while held.
	sprintToggle: false,
	// Slow motion latches on a press instead of while held.
	slowMotionToggle: true
} );

// What a settings screen calls each one, in the order it lists them.
const PREFERENCE_LABELS = Object.freeze( {
	invertMouseY: 'Invert mouse look',
	invertStickY: 'Invert stick look',
	headCamera: 'Head camera in first person',
	tricksInFirstPerson: 'Tricks in first person',
	cameraLag: 'Camera lag',
	sprintToggle: 'Sprint toggles',
	slowMotionToggle: 'Slow motion toggles'
} );

const STORAGE_KEY = 'parkour-preferences';

class Preferences {

	/** @param {Storage|null} [storage] where they are kept (none: they last as long as the page) */
	constructor( storage = globalThis.localStorage ) {

		this.storage = storage;

		this.values = { ...PREFERENCE_DEFAULTS };

		try {

			this.replace( JSON.parse( storage?.getItem( STORAGE_KEY ) || '{}' ), false );

		} catch {

			// A saved value that does not parse leaves the defaults.

		}

	}

	/** Takes the known preferences from `values` (others, and values of the wrong type, are ignored). */
	replace( values, save = true ) {

		for ( const [ key, fallback ] of Object.entries( PREFERENCE_DEFAULTS ) ) {

			if ( typeof values[ key ] === typeof fallback ) this.values[ key ] = values[ key ];

		}

		if ( save ) this.persist();

		return this.values;

	}

	/** Sets one preference and keeps it. */
	set( key, value ) {

		return this.replace( { [ key ]: value } );

	}

	persist() {

		try {

			this.storage?.setItem( STORAGE_KEY, JSON.stringify( this.values ) );

		} catch {

			// Storage can be full or refused (private browsing); the preferences still hold for this page.

		}

	}

	/** Every preference back to its default, kept. */
	reset() {

		this.values = { ...PREFERENCE_DEFAULTS };
		this.persist();

	}

}

export { PREFERENCE_DEFAULTS, PREFERENCE_LABELS, Preferences };
