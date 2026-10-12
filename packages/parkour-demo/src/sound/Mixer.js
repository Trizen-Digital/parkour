// The sound's Web Audio: one context, the decoded files, the voices playing, the wind and ambience loops and the room's
// reverb. It knows nothing of the runner: Sound.js says what plays and how loud.
//
//   voices ──── effects volume ──┐
//   wind loop ─ wind volume ─────┼─ mix ─┬──────────────────────────── master volume ── gate ── out
//   ambience ── ambience volume ─┘       ├─ reverb ──────── wet ──────┤
//                                        └─ slowed reverb ─ slow wet ─┘
//
// The mix plays dry at full and feeds the reverb (sounds.js, REVERB: the impulse response and how much comes back);
// the gate silences everything while the run is held (a menu, the pause) or the tab is hidden. Slow motion lowers the
// pitch of everything (setRate): the voices, the wind, the ambience, and the room itself, whose impulse response,
// stretched as if it too were played slower, takes over from the room's own as the run slows.
//
// Without Web Audio (node, the headless tools) it loads nothing and every call does nothing.

import { REVERB, SOUNDS } from './sounds.js';

// Each play moves the pitch up or down by as much as this share, so a repeated sound never plays the same twice.
const PITCH_SPREAD = 0.03;

// Time constants (s) for the gains to glide on: the gate (silent in about 50 ms), a volume setting, the wind's level
// (Sound has smoothed it already: this only takes the steps out of a frame's change) and a pitch.
const GATE_GLIDE = 0.015;
const VOLUME_GLIDE = 0.03;
const WIND_GLIDE = 0.03;
const RATE_GLIDE = 0.05;
// Slow motion's pitch is set every frame as the run eases in and out of it: this only takes the steps out of a frame's
// change, so the pitch falls and rises with the run.
const SLOW_GLIDE = 0.015;

// The wind is silent below this level; silent for WIND_STOP_AFTER (s), its loop stops, to start again from its
// beginning when the wind next rises.
const SILENT = 0.002;
const WIND_STOP_AFTER = 0.5;

class Mixer {

	/**
	 * @param {object} [table] the sounds (sounds.js)
	 * @param {object} [reverb] the room (sounds.js)
	 */
	constructor( table = SOUNDS, reverb = REVERB ) {

		this.table = table;
		this.reverb = reverb;
		const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
		this.context = Context ? new Context() : null;

		// Each sound's decoded files, the order they play in, the file last played, when it last played and its voices
		// playing: made by load().
		this.sounds = new Map();
		// The pitch every voice and the wind play at (slow motion lowers it).
		this.rate = 1;
		// Held by the game (a menu, the pause); the tab hidden, and whether that silences it.
		this.held = false;
		this.hidden = false;
		this.muteHidden = true;
		// The shuffles' own counter.
		this.seed = 1;
		this.windSource = null;
		this.windQuietSince = null;
		this.ambientSource = null;
		// The room's impulse response; the reverb of it stretched to slow motion's slowest rate (made for that rate),
		// whether the mix feeds it, and the timer that stops feeding it once its tail has died away at full speed.
		this.impulse = null;
		this.slowConvolver = null;
		this.slowRate = null;
		this.slowFed = false;
		this.slowStop = null;

		if ( ! this.context ) return;

		const context = this.context;
		this.gate = context.createGain();
		this.master = context.createGain();
		this.mix = context.createGain();
		this.effects = context.createGain();
		this.windBus = context.createGain();
		this.windLevel = context.createGain();
		this.windLevel.gain.value = 0;
		this.ambientBus = context.createGain();
		this.effects.connect( this.mix );
		this.windLevel.connect( this.windBus ).connect( this.mix );
		this.ambientBus.connect( this.mix );
		this.mix.connect( this.master );
		this.master.connect( this.gate ).connect( context.destination );

		// The reverb: the whole mix in, `wet` of it back into the master beside the dry.
		this.convolver = context.createConvolver();
		this.convolver.normalize = reverb.normalize;
		this.wet = context.createGain();
		this.wet.gain.value = reverb.wet;
		this.mix.connect( this.convolver ).connect( this.wet ).connect( this.master );
		this.slowWet = context.createGain();
		this.slowWet.gain.value = 0;
		this.slowWet.connect( this.master );

	}

	/**
	 * Fetches and decodes every sound's files and the reverb's impulse response, all at once, then starts the ambience.
	 * A file that does not load is left out (with a warning), and the game plays on without it.
	 * @param {string} base where the files are (`…/sounds/`)
	 * @returns {Promise<Mixer>}
	 */
	async load( base ) {

		if ( ! this.context ) return this;

		const [ impulse ] = await Promise.all( [
			this.decode( `${base}${this.reverb.file}.opus` ),
			...Object.entries( this.table ).map( async ( [ id, sound ] ) => {

				const buffers = await Promise.all( sound.files.map( ( file ) => this.decode( `${base}${file}.opus` ) ) );
				this.sounds.set( id, { ...sound, buffers: buffers.filter( Boolean ), order: [], played: - 1, last: - Infinity, playing: [] } );

			} ),
		] );

		if ( impulse ) this.convolver.buffer = this.impulse = impulse;
		this.startAmbient();
		return this;

	}

	// The ambience loops from the start for as long as the page is open (a page not yet let play starts it then).
	startAmbient() {

		const sound = this.sounds.get( 'ambient' ), context = this.context;
		if ( ! sound?.buffers.length ) return;

		const source = context.createBufferSource(), level = context.createGain();
		source.buffer = sound.buffers[ 0 ];
		source.loop = true;
		source.playbackRate.value = this.rate;
		level.gain.value = sound.level;
		source.connect( level ).connect( this.ambientBus );
		source.start();
		this.ambientSource = source;

	}

	async decode( url ) {

		try {

			const response = await fetch( url );
			if ( ! response.ok ) throw new Error( `${response.status} ${response.statusText}` );
			return await this.context.decodeAudioData( await response.arrayBuffer() );

		} catch ( error ) {

			console.warn( `Sound: ${url} did not load (${error.message ?? error})` );
			return null;

		}

	}

	/** Lets the sound start: browsers keep a page silent until the player clicks or presses a key in it. */
	unlock() {

		if ( this.context?.state === 'suspended' ) this.context.resume().catch( () => {} );

	}

	// Silent: held, or hidden and muted when hidden. Nothing new plays.
	get gated() {

		return this.held || ( this.hidden && this.muteHidden );

	}

	/**
	 * Plays one of a sound's files.
	 * @param {string} id a sound in the table
	 * @param {number} [level] how loud, times the sound's own level
	 */
	play( id, level = 1 ) {

		const sound = this.sounds.get( id ), context = this.context;
		if ( ! sound?.buffers.length || context.state !== 'running' || this.gated ) return;

		const now = context.currentTime;
		if ( now - sound.last < sound.gap ) return;
		sound.last = now;

		const pitch = 1 + ( this.random() * 2 - 1 ) * PITCH_SPREAD;
		const source = context.createBufferSource(), gain = context.createGain();
		source.buffer = sound.buffers[ this.nextFile( sound ) ];
		source.playbackRate.value = pitch * this.rate;
		gain.gain.value = sound.level * level;
		source.connect( gain ).connect( this.effects );

		const voice = { source, pitch };
		source.onended = () => {

			const i = sound.playing.indexOf( voice );
			if ( i >= 0 ) sound.playing.splice( i, 1 );
			gain.disconnect();

		};
		sound.playing.push( voice );
		if ( sound.playing.length > sound.voices ) sound.playing.shift().source.stop();
		source.start( now );

	}

	// The next file in a shuffled order, dealt again once every file has played, never the one that just played.
	nextFile( sound ) {

		if ( ! sound.order.length ) {

			const order = sound.buffers.map( ( _, i ) => i );
			for ( let i = order.length - 1; i > 0; i -- ) {

				const j = Math.floor( this.random() * ( i + 1 ) );
				[ order[ i ], order[ j ] ] = [ order[ j ], order[ i ] ];

			}

			if ( order.length > 1 && order[ 0 ] === sound.played ) [ order[ 0 ], order[ 1 ] ] = [ order[ 1 ], order[ 0 ] ];
			sound.order = order;

		}

		sound.played = sound.order.shift();
		return sound.played;

	}

	// 0 to 1 from the mixer's own counter (a linear congruential generator): never the run's seeded streams, which a
	// draw from here would change.
	random() {

		this.seed = ( Math.imul( this.seed, 1664525 ) + 1013904223 ) >>> 0;
		return this.seed / 4294967296;

	}

	/**
	 * The wind's level and pitch for this frame. Rising from silence starts its loop from the beginning; silent for a
	 * while, the loop stops.
	 * @param {number} level 0 to 1
	 * @param {number} [rate] its pitch, before slow motion's
	 */
	wind( level, rate = 1 ) {

		const sound = this.sounds.get( 'wind' ), context = this.context;
		if ( ! sound?.buffers.length ) return;

		const now = context.currentTime;
		if ( level > SILENT && ! this.windSource ) {

			const source = context.createBufferSource();
			source.buffer = sound.buffers[ 0 ];
			source.loop = true;
			source.connect( this.windLevel );
			this.windLevel.gain.cancelScheduledValues( now );
			this.windLevel.gain.setValueAtTime( 0, now );
			source.start( now );
			this.windSource = source;

		}

		if ( ! this.windSource ) return;

		this.windLevel.gain.setTargetAtTime( level * sound.level, now, WIND_GLIDE );
		this.windSource.playbackRate.setTargetAtTime( rate * this.rate, now, RATE_GLIDE );

		if ( level > SILENT ) this.windQuietSince = null;
		else if ( this.windQuietSince === null ) this.windQuietSince = now;
		else if ( now - this.windQuietSince > WIND_STOP_AFTER ) this.stopWind();

	}

	stopWind() {

		this.windSource?.stop();
		this.windSource = null;
		this.windQuietSince = null;

	}

	/** Every voice and the wind stopped at once, the wind's level back to nothing (a respawn, another run). */
	stopAll() {

		if ( ! this.context ) return;

		for ( const sound of this.sounds.values() ) for ( const voice of sound.playing.splice( 0 ) ) voice.source.stop();
		this.stopWind();
		const now = this.context.currentTime;
		this.windLevel.gain.cancelScheduledValues( now );
		this.windLevel.gain.setValueAtTime( 0, now );

	}

	/**
	 * Slow motion's pitch, for every voice playing and every one to come, the wind, the ambience and the room.
	 * @param {number} rate 1 at full speed
	 * @param {number} [slowest] the rate slow motion eases down to: the room's reverb is the slowed one's there
	 */
	setRate( rate, slowest = rate ) {

		if ( ! this.context ) return;
		if ( slowest !== this.slowRate ) this.slowRoom( slowest );
		if ( rate === this.rate ) return;

		this.rate = rate;
		const now = this.context.currentTime;
		for ( const sound of this.sounds.values() ) for ( const voice of sound.playing ) voice.source.playbackRate.setTargetAtTime( voice.pitch * rate, now, SLOW_GLIDE );
		this.ambientSource?.playbackRate.setTargetAtTime( rate, now, SLOW_GLIDE );

		// The room's own reverb gives way to the slowed one's as the rate falls to the slowest.
		const share = this.slowConvolver ? Math.min( 1, Math.max( 0, ( 1 - rate ) / ( 1 - this.slowRate ) ) ) : 0;
		this.wet.gain.setTargetAtTime( this.reverb.wet * ( 1 - share ), now, SLOW_GLIDE );
		this.slowWet.gain.setTargetAtTime( this.reverb.wet * share, now, SLOW_GLIDE );

		// The slowed room listens only around slow motion: fed as the run slows, and let go once back at full speed
		// for as long as its tail lasts.
		clearTimeout( this.slowStop );
		if ( share > 0 && ! this.slowFed ) {

			this.mix.connect( this.slowConvolver );
			this.slowFed = true;

		} else if ( share === 0 && this.slowFed ) {

			this.slowStop = setTimeout( () => {

				this.mix.disconnect( this.slowConvolver );
				this.slowFed = false;

			}, this.slowConvolver.buffer.duration * 1000 );

		}

	}

	// The reverb of the room slowed to `rate`: its impulse response stretched as if played at that rate (longer, and
	// lower), made once for the rate.
	slowRoom( rate ) {

		if ( ! this.impulse || ! ( rate > 0 && rate < 1 ) ) return;

		clearTimeout( this.slowStop );
		if ( this.slowFed ) this.mix.disconnect( this.slowConvolver );
		this.slowConvolver?.disconnect();
		this.slowFed = false;

		const convolver = this.context.createConvolver();
		convolver.normalize = this.reverb.normalize;
		convolver.buffer = stretch( this.impulse, rate, this.context );
		convolver.connect( this.slowWet );
		this.slowConvolver = convolver;
		this.slowRate = rate;

	}

	/** Held while the game holds the run (a menu, the pause): everything fades out, and back in after. */
	hold( on ) {

		if ( on === this.held ) return;
		this.held = on;
		this.updateGate();

	}

	/** The tab hidden or shown: silent while hidden when the settings say so. */
	setHidden( hidden ) {

		this.hidden = hidden;
		this.updateGate();

	}

	/**
	 * The settings' volumes (ui.options).
	 * @param {{ volume: number, effectsVolume: number, windVolume: number, ambientVolume: number, muteUnfocused: boolean }} options
	 */
	setVolumes( { volume, effectsVolume, windVolume, ambientVolume, muteUnfocused } ) {

		this.muteHidden = muteUnfocused;
		if ( ! this.context ) return;

		// A slider's share squared: how loud it sounds follows that more evenly than the gain itself.
		const now = this.context.currentTime;
		this.master.gain.setTargetAtTime( volume * volume, now, VOLUME_GLIDE );
		this.effects.gain.setTargetAtTime( effectsVolume * effectsVolume, now, VOLUME_GLIDE );
		this.windBus.gain.setTargetAtTime( windVolume * windVolume, now, VOLUME_GLIDE );
		this.ambientBus.gain.setTargetAtTime( ambientVolume * ambientVolume, now, VOLUME_GLIDE );
		this.updateGate();

	}

	updateGate() {

		if ( this.context ) this.gate.gain.setTargetAtTime( this.gated ? 0 : 1, this.context.currentTime, GATE_GLIDE );

	}

}

// A buffer as it sounds played at `rate`: longer by 1 / rate, each sample read between the original's two around it.
function stretch( buffer, rate, context ) {

	const length = Math.ceil( buffer.length / rate );
	const stretched = context.createBuffer( buffer.numberOfChannels, length, buffer.sampleRate );

	for ( let channel = 0; channel < buffer.numberOfChannels; channel ++ ) {

		const from = buffer.getChannelData( channel ), to = stretched.getChannelData( channel );
		for ( let i = 0; i < length; i ++ ) {

			const at = i * rate, k = Math.floor( at ), f = at - k;
			to[ i ] = ( from[ k ] ?? 0 ) * ( 1 - f ) + ( from[ k + 1 ] ?? 0 ) * f;

		}

	}

	return stretched;

}

export { Mixer };
