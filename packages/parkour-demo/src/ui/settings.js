// The settings screen's tabs and rows, bound to the game. Each row reads its value from where the game keeps it and
// writes it back there. The menu holds the run while it is open, so every change lands between frames, and a QA
// capture records a change of the tuning or the player's preferences as a setting.
//
// A row is one of:
//   { kind: 'toggle', label, about, get, set, def }
//   { kind: 'choice', label, about, options: [ [ value, label ] ], get, set, def }
//   { kind: 'number', label, about, min, max, step, get, set, def, unit, shown?, unshown? } (shown/unshown: the
//     value as a person reads it, degrees for an angle, and back)
//   { kind: 'action', label, about, run, value? }
//   { kind: 'binding', label, tokens }
//   { kind: 'header', label }

import { TUNING_DEFAULTS, TUNING_GROUPS, TUNING_UNITS } from '@trizendigital/parkour/sim/tuning.js';
import { PREFERENCE_DEFAULTS } from '@trizendigital/parkour/input/Preferences.js';
import { VIEWS } from '../course/look.js';
import { ENGINES } from '../engines.js';
import { CONTROLS } from './controls.js';
import { OPTION_DEFAULTS, setOption, toast, ui } from './state.svelte.js';
import { RENDER_SCALE, TIERS, applyGraphics, detectTier, tierOf } from '../stage/quality.js';

// The table's units as a row writes them after the number.
const UNIT_TEXT = { angle: '°', 'angle/s': '°/s', look: '×', '×': '×', '/s': '/s', '': '' };

const VIEW_NAMES = { graybox: 'Graybox', off: 'Vision Off', classic: 'Vision', full: 'Vision Full' };

// The envelope's run-up speeds (m/s), as the metrics name them.
const ENVELOPE_SPEEDS = [ [ 0, 'Standing' ], [ 3, 'Run' ], [ 3.6, 'Sprint' ], [ 5, 'Free Run' ], [ 7.2, 'Top' ] ];

const titleCase = ( text ) => text.replace( /(^|\s)([a-z])/g, ( _, space, letter ) => space + letter.toUpperCase() );

// The tabs made for each game, once: a row's default is what it held the first time the settings opened, before any
// change made here.
const made = new WeakMap();

/**
 * @param {{game: Game, player: Player, qa: QA}} app
 * @returns {{id: string, name: string, rows: object[]}[]}
 */
function settingsTabs( app ) {

	if ( ! made.has( app.game ) ) made.set( app.game, makeTabs( app ) );
	return made.get( app.game );

}

function makeTabs( { game, player, qa } ) {

	const sim = () => player.sim, tools = game.tools, gi = game.post.gi;

	const preference = ( key, label, about, options = null ) => ( {
		kind: options ? 'choice' : 'toggle', label, about, options, def: PREFERENCE_DEFAULTS[ key ],
		get: () => sim()?.input.preferences.values[ key ] ?? PREFERENCE_DEFAULTS[ key ],
		set: ( value ) => sim()?.input.preferences.set( key, value ),
	} );

	const tuning = ( key, label = null, about = null ) => {

		const [ , name, def, min, max, step, unit ] = TUNING_GROUPS.flatMap( ( group ) => group.fields ).find( ( field ) => field[ 0 ] === key );
		const units = TUNING_UNITS[ unit ];
		return {
			kind: 'number', label: label ?? titleCase( name ), min, max, step, def,
			unit: UNIT_TEXT[ unit ] ?? ` ${unit}`, shown: units?.shown, unshown: units?.value,
			about: about ?? `Default ${format( units ? units.shown( def ) : def, units ? units.shown( step ) : step )}${UNIT_TEXT[ unit ] ?? ` ${unit}`}`,
			get: () => sim()?.tuning.values[ key ] ?? TUNING_DEFAULTS[ key ],
			set: ( value ) => sim()?.tuning.set( key, value ),
		};

	};

	const option = ( key, label, about, apply = () => {} ) => ( {
		kind: 'toggle', label, about, def: OPTION_DEFAULTS[ key ],
		get: () => ui.options[ key ],
		set: ( value ) => {

			setOption( key, value );
			apply( value );

		},
	} );

	const look = () => {

		Object.assign( game.params, { view: ui.options.view, sky: ui.options.sky, exposure: ui.options.exposure, ssgi: ui.options.ssgi, motionBlur: ui.options.motionBlur } );
		game.course?.setView( game.params.view );
		game.applyLook();

	};

	// The graphics (src/stage/quality.js): a tier's render scale and light, kept and set.
	const graphics = ( { renderScale, ssgi } ) => {

		setOption( 'renderScale', renderScale );
		setOption( 'ssgi', ssgi );
		applyGraphics( game, ui.options );

	};

	// The quality: a tier; Auto, which times the tiers again now; or Custom, the render scale and light as they are.
	const quality = ( id ) => {

		setOption( 'quality', id );
		if ( id === 'custom' ) return;
		if ( tierOf( id ) ) return graphics( tierOf( id ) );
		toast( 'Testing graphics' );
		detectTier( game ).then( ( tier ) => {

			setOption( 'detected', tier.id );
			graphics( tier );
			toast( `Graphics: ${tier.name}`, 'good' );

		} );

	};

	// The render scale or the light set by hand: the quality is then Custom.
	const custom = ( key ) => ( value ) => {

		setOption( key, value );
		setOption( 'quality', 'custom' );
		applyGraphics( game, ui.options );

	};

	// The course markers: the course tools' drawing of the route.
	const markers = ( on ) => {

		tools.params.route = on;
		tools.draw();

	};

	const lookNumber = ( key, label, about, min, max, step ) => ( {
		kind: 'number', label, about, min, max, step, unit: '', def: OPTION_DEFAULTS[ key ],
		get: () => ui.options[ key ],
		set: ( value ) => {

			setOption( key, value );
			look();

		},
	} );

	// A volume, 0 to 1, shown as a percentage; the mixer takes it at once.
	const volume = ( key, label, about ) => ( {
		kind: 'number', label, about, min: 0, max: 1, step: 0.05, unit: '%', def: OPTION_DEFAULTS[ key ],
		shown: ( value ) => value * 100, unshown: ( value ) => value / 100,
		get: () => ui.options[ key ],
		set: ( value ) => {

			setOption( key, value );
			game.mixer.setVolumes( ui.options );

		},
	} );

	// A number on an object the game keeps (the GI's uniforms, the free camera), its default what it starts with.
	const live = ( target, key, label, about, min, max, step, unit = '' ) => ( {
		kind: 'number', label, about, min, max, step, unit, def: target[ key ],
		get: () => target[ key ],
		set: ( value ) => target[ key ] = value,
	} );

	const toggle = ( target, key, label, about, apply = () => {} ) => ( {
		kind: 'toggle', label, about, def: target[ key ],
		get: () => target[ key ],
		set: ( value ) => {

			target[ key ] = value;
			apply( value );

		},
	} );

	const bindings = ( device ) => CONTROLS.flatMap( ( group ) => {

		const rows = group.rows.filter( ( row ) => row[ device ].length );
		return rows.length ? [ { kind: 'header', label: group.name }, ...rows.map( ( row ) => ( { kind: 'binding', label: row.label, tokens: row[ device ] } ) ) ] : [];

	} );

	return [
		{ id: 'game', name: 'Game', rows: [
			{
				kind: 'toggle', label: 'Easy Mode', about: 'A pilot times jumps and grabs. Always on with touch.', def: false,
				get: () => player.easy,
				set: ( on ) => player.setEasy( on ),
			},
			preference( 'cameraLag', 'Camera Lag', 'The camera trails the runner.' ),
			preference( 'headCamera', 'Head Camera', 'First person turns with the head.' ),
			preference( 'tricksInFirstPerson', 'Tricks in First Person', 'Tricks keep the first person view.' ),
		] },
		{ id: 'video', name: 'Video', rows: [
			{
				kind: 'choice', label: 'Quality', about: 'Auto finds the best that holds 60 frames a second.', def: OPTION_DEFAULTS.quality,
				get options() {

					return [ [ 'auto', ui.options.detected ? `Auto · ${tierOf( ui.options.detected ).name}` : 'Auto' ], ...TIERS.map( ( tier ) => [ tier.id, tier.name ] ), [ 'custom', 'Custom' ] ];

				},
				get: () => ui.options.quality,
				set: quality,
			},
			{
				kind: 'number', label: 'Render Scale', about: 'Pixels drawn for each screen pixel.', min: RENDER_SCALE.min, max: RENDER_SCALE.max, step: 0.05, unit: '%',
				def: OPTION_DEFAULTS.renderScale, shown: ( value ) => value * 100, unshown: ( value ) => value / 100,
				get: () => ui.options.renderScale,
				set: custom( 'renderScale' ),
			},
			{ ...option( 'ssgi', 'Global Illumination', 'Screen-space bounced light.' ), set: custom( 'ssgi' ) },
			{
				kind: 'choice', label: 'Course Look', about: 'How the course surfaces look.', def: OPTION_DEFAULTS.view,
				options: Object.keys( VIEWS ).map( ( view ) => [ view, VIEW_NAMES[ view ] ?? view ] ),
				get: () => ui.options.view,
				set: ( view ) => {

					setOption( 'view', view );
					look();

				},
			},
			lookNumber( 'exposure', 'Brightness', 'Exposure of the image.', 0.3, 1.5, 0.01 ),
			lookNumber( 'sky', 'Sky Light', 'Strength of the sky light.', 0.1, 1.5, 0.01 ),
			option( 'motionBlur', 'Motion Blur', 'Blur what moves across the view.', look ),
			live( gi.giIntensity, 'value', 'GI Strength', 'Strength of the bounced light.', 0, 10, 0.1 ),
			live( gi.aoIntensity, 'value', 'AO Strength', 'Strength of the ambient occlusion.', 0, 3, 0.05 ),
			live( gi.radius, 'value', 'GI Radius', 'How far light bounces.', 0.5, 12, 0.1, ' m' ),
		] },
		{ id: 'audio', name: 'Audio', rows: [
			volume( 'volume', 'Master Volume', 'Loudness of everything.' ),
			volume( 'effectsVolume', 'Effects', 'Steps, jumps, landings and grabs.' ),
			volume( 'windVolume', 'Wind', 'Rushing air at speed.' ),
			volume( 'ambientVolume', 'Ambience', 'The sound of the place around you.' ),
			option( 'muteUnfocused', 'Mute in Background', 'Silent when the tab is hidden.', () => game.mixer.setVolumes( ui.options ) ),
		] },
		{ id: 'hud', name: 'HUD', rows: [
			option( 'jumpMeter', 'Jump Meter', 'Show the jump charge.' ),
			option( 'fps', 'Frame Rate', 'Show frames per second.' ),
			option( 'debug', 'Debug Info', 'Show the runner state.' ),
			option( 'markers', 'Course Markers', 'Show the route\'s moves on the course.', markers ),
		] },
		{ id: 'controls', name: 'Controls', rows: [
			preference( 'invertMouseY', 'Invert Mouse', 'Invert vertical mouse look.' ),
			tuning( 'mouseSensitivity', 'Look Sensitivity', 'Mouse look speed.' ),
			preference( 'sprintToggle', 'Sprint', 'How the sprint key works.', [ [ false, 'Hold' ], [ true, 'Toggle' ] ] ),
			preference( 'slowMotionToggle', 'Slow Motion', 'How the slow motion button works.', [ [ false, 'Hold' ], [ true, 'Toggle' ] ] ),
			...bindings( 'keys' ),
		] },
		{ id: 'controller', name: 'Controller', rows: [
			preference( 'invertStickY', 'Invert Stick', 'Invert vertical stick look.' ),
			tuning( 'stickLookRate', 'Look Speed', 'Stick look speed.' ),
			...bindings( 'pad' ),
		] },
		{ id: 'tuning', name: 'Tuning', rows: TUNING_GROUPS.flatMap( ( group ) => [
			{ kind: 'header', label: titleCase( group.name ) },
			...group.fields.map( ( [ key ] ) => tuning( key ) ),
		] ) },
		{ id: 'course', name: 'Course', rows: [
			live( tools.params, 'seed', 'Seed', 'Seed of the generated course.', 1, 99999, 1 ),
			live( tools.params, 'length', 'Challenges', 'Challenges in the generated course.', 4, 40, 1 ),
			live( tools.params, 'difficulty', 'Difficulty', 'Difficulty of the generated course.', 0, 1, 0.05 ),
			{ kind: 'action', label: 'Generate', about: 'Build a course from the seed.', run: () => tools.regenerate(), value: () => tools.info.generated },
			{ kind: 'action', label: 'New Seed', about: 'Generate with the next seed.', run: () => tools.newSeed() },
			{ kind: 'action', label: 'Save Course', about: 'Download the course file.', run: () => tools.save() },
			{ kind: 'header', label: 'Validator' },
			{ kind: 'action', label: 'Validate', about: 'Check the course against the metrics.', run: () => tools.onCourse( game.course ), value: () => tools.info.text },
			{
				kind: 'toggle', label: 'Problem List', about: 'Show what the validator found.', def: false,
				get: () => tools.reportShown,
				set: ( on ) => tools.showReport( on ),
			},
			option( 'markers', 'Route', 'Draw the route.', markers ),
			toggle( tools.params, 'runs', 'Runs', 'Draw the run-ups.', () => tools.draw() ),
			toggle( tools.params, 'problems', 'Problems Only', 'Draw the problems alone.', () => tools.draw() ),
			toggle( tools.params, 'envelope', 'Reach Envelope', 'Show where the runner can reach.', () => tools.drawEnvelope( true ) ),
			{
				kind: 'choice', label: 'Envelope Speed', about: 'Run-up speed of the envelope.', def: tools.params.envelopeSpeed, options: ENVELOPE_SPEEDS,
				get: () => tools.params.envelopeSpeed,
				set: ( speed ) => {

					tools.params.envelopeSpeed = speed;
					tools.drawEnvelope( true );

				},
			},
			toggle( tools.params, 'preview', 'Vision Preview', 'Runner Vision from the free camera.' ),
		] },
		{ id: 'debug', name: 'Debug', rows: [
			{
				kind: 'choice', label: 'Physics', about: 'Physics engine of the run.', def: ENGINES[ 0 ],
				options: ENGINES.map( ( name ) => [ name, name === 'rapier' ? 'Rapier' : name ] ),
				get: () => player.settings.engine,
				set: ( name ) => player.setEngine( name ),
			},
			{
				kind: 'toggle', label: 'Free Camera', about: 'Fly the camera round the course.', def: false,
				get: () => game.params.freeCamera,
				set: ( on ) => game.setFreeCamera( on ),
			},
			live( game.inspect, 'speed', 'Fly Speed', 'Free camera speed.', 1, 40, 0.5, ' m/s' ),
			toggle( player.settings, 'capsule', 'Capsule', 'Show the collision capsule.' ),
			toggle( game.params, 'affordances', 'Affordances', 'Show what the runner can use.', () => game.showOverlay() ),
			toggle( game.params, 'volumes', 'Volumes', 'Show the catch volumes.', () => game.showOverlay() ),
			toggle( qa.settings, 'record', 'Replay Buffer', 'Record play for capture.', ( on ) => qa.recorder.setRecording( on ) ),
			{ ...live( qa.settings, 'keep', 'Capture Length', 'Seconds a capture holds.', 5, 60, 1, ' s' ), set: ( seconds ) => qa.setKeep( seconds ) },
			{ kind: 'action', label: 'Reload Course', about: 'Load the course file again.', run: () => game.reload() },
		] },
	];

}

/**
 * A number as a row shows it, to the step's decimals.
 * @param {number} value
 * @param {number} step
 * @returns {string}
 */
function format( value, step ) {

	const decimals = String( + step.toFixed( 6 ) ).split( '.' )[ 1 ]?.length ?? 0;
	return value.toFixed( decimals );

}

export { settingsTabs, format };
