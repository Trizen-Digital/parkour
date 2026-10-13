// The graphics quality: tiers from the best down, each a render scale (pixels drawn per CSS pixel) and whether the
// bounced light (SSGI) is on, and the detector that finds the best tier this machine holds 60 frames a second at. The
// game runs it while the loading screen is up when the quality is Auto, and keeps what it found
// (src/ui/state.svelte.js); the settings' Video tab can pick a tier, or set the render scale and the light itself
// (Custom). Rendering only: nothing here touches a run.

/** The render scale's range: at most 1 pixel per CSS pixel, whatever the screen's own density. */
const RENDER_SCALE = { min: 0.5, max: 1 };

/** The tiers, best first. */
const TIERS = [
	{ id: 'ultra', name: 'Ultra', renderScale: 1, ssgi: true },
	{ id: 'high', name: 'High', renderScale: 1, ssgi: true },
	{ id: 'medium', name: 'Medium', renderScale: 1, ssgi: true },
	{ id: 'low', name: 'Low', renderScale: 0.75, ssgi: false },
	{ id: 'lowest', name: 'Lowest', renderScale: 0.75, ssgi: false },
];

// A tier holds if its frames come at least this often (fps): 60 with room for a missed vsync now and then.
const TARGET_FPS = 57;

// Frames drawn at a tier before timing it (its shaders compile, its targets are made), then frames timed.
const WARM_UP = 12;
const TIMED = 40;

/**
 * @param {string} id
 * @returns {object|null} the tier by its id
 */
function tierOf( id ) {

	return TIERS.find( ( tier ) => tier.id === id ) ?? null;

}

/**
 * Sets the render scale and the bounced light.
 * @param {Game} game
 * @param {{renderScale: number, ssgi: boolean}} graphics
 */
function applyGraphics( game, { renderScale, ssgi } ) {

	const renderer = game.stage.renderer;
	renderer.setPixelRatio( Math.min( RENDER_SCALE.max, Math.max( RENDER_SCALE.min, renderScale ) ) );
	renderer.setSize( innerWidth, innerHeight );
	game.params.ssgi = ssgi;
	game.applyLook();

}

/**
 * Finds the best tier that holds TARGET_FPS, timing the frames the page draws at each one in turn.
 * @param {Game} game
 * @param {(text: string) => void} [progress]
 * @returns {Promise<object>} the tier, already set
 */
async function detectTier( game, progress = () => {} ) {

	const stage = game.stage;
	for ( const tier of TIERS ) {

		progress( `Testing graphics: ${tier.name}` );
		applyGraphics( game, tier );
		let fps = 0;
		for ( let timed = false; ! timed; ) {

			// A page hidden while it is timed draws no frames for a while: that tier is timed again.
			let hidden = false;
			const hide = () => hidden ||= document.hidden;
			document.addEventListener( 'visibilitychange', hide );
			await stage.frames( WARM_UP );
			const started = performance.now();
			await stage.frames( TIMED );
			fps = TIMED / ( ( performance.now() - started ) / 1000 );
			document.removeEventListener( 'visibilitychange', hide );
			timed = ! hidden;

		}

		if ( fps >= TARGET_FPS ) return tier;

	}

	return TIERS.at( - 1 );

}

export { RENDER_SCALE, TIERS, tierOf, applyGraphics, detectTier };
