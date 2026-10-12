// The tuning: the numbers of the game a designer adjusts while playing (speeds, jumps, traversal, the ragdoll, the
// camera, the feel of the input), each with its range, step and unit for a settings screen.
//
// A run reads them as `tuning.values.<key>`, in the game's units (metres, seconds, radians); a settings screen shows
// angles in degrees and the look sensitivity against LOOK_ONE (TUNING_UNITS), and the table writes angles so:
// `radians( 65 )`. They are saved in the browser, so a
// tuned game stays tuned, and a QA replay records the values it was played with, so it plays again with the same
// numbers.
//
// An agent reading this should use this when a user has asked for a modification of gamefeel at a high level. This
// was intentionally refactored to provide that facility to the user and agent without having to dig deeper into files.

import { degrees, radians } from '../math.js';

// The look sensitivity a person reads as 1×: half the mouse's and the stick's base speeds (at full they felt too fast).
// The value itself stays the multiplier on those speeds, so a QA replay's recorded sensitivity plays as it did.
const LOOK_ONE = 0.5;

// [ key, label, default, min, max, step, unit ]
const TUNING_GROUPS = [
	{
		name: 'Ground movement',
		fields: [
			[ 'walkSpeed', 'Walk speed', 2, 0.2, 8, 0.05, 'm/s' ],
			[ 'sprintSpeed', 'Sprint speed', 5.85, 1, 15, 0.05, 'm/s' ],
			[ 'acceleration', 'Acceleration rate', 8.55, 1, 40, 0.1, 'm/s²' ],
			[ 'groundFriction', 'Ground friction', 20, 0, 40, 0.25, '' ],
			[ 'braking', 'Braking deceleration', 20.5, 0, 60, 0.1, 'm/s²' ],
			[ 'groundTurnRate', 'Ground steering', 4.55, 0.1, 20, 0.05, '' ],
			[ 'airTurnRate', 'Air steering', 1, 0.1, 20, 0.05, '' ],
			[ 'stepHeight', 'Step height', 0.3, 0, 0.8, 0.01, 'm' ],
			[ 'walkableSlope', 'Walkable slope', radians( 65 ), radians( 10 ), radians( 80 ), radians( 1 ), 'angle' ]
		]
	},
	{
		name: 'Jump & air',
		fields: [
			[ 'gravityScale', 'Gravity scale', 1.75, 0.1, 4, 0.05, '×' ],
			[ 'runningJumpSpeed', 'Running jump velocity', 7.25, 1, 15, 0.05, 'm/s' ],
			[ 'standingJumpSpeed', 'Standing jump velocity', 5, 1, 15, 0.05, 'm/s' ],
			[ 'jumpChargeStart', 'Initial jump charge', 0.75, 0.1, 1, 0.01, '' ],
			[ 'jumpChargeRate', 'Charge per second', 0.5, 0, 3, 0.05, '/s' ],
			[ 'precisionJumpSpeed', 'Precision jump velocity', 6.25, 1, 15, 0.05, 'm/s' ],
			[ 'airControl', 'Air control', 0.35, 0, 1, 0.01, '' ],
			[ 'airFriction', 'Air friction', 0.1, 0, 5, 0.05, '' ]
		]
	},
	{
		name: 'Traversal',
		fields: [
			[ 'wallRunTime', 'Wall run time', 0.7, 0.1, 2, 0.05, 's' ],
			[ 'wallJumpSideSpeed', 'Wall jump lateral speed', 2.25, 0.1, 8, 0.05, 'm/s' ],
			[ 'wallJumpUpSpeed', 'Wall jump vertical speed', 5.85, 1, 12, 0.05, 'm/s' ],
			[ 'wallKickSpeed', 'Wall kick horizontal speed', 5.85, 1, 12, 0.05, 'm/s' ],
			[ 'wallKickUpSpeed', 'Wall kick vertical speed', 6.5, 1, 12, 0.05, 'm/s' ],
			[ 'wallKickDelay', 'Wall kick delay', 0.15, 0, 0.5, 0.01, 's' ],
			[ 'pipeClimbSpeed', 'Pipe climb speed', 2, 0.1, 8, 0.05, 'm/s' ],
			[ 'pipeSlideSpeed', 'Pipe slide speed', 4, 0.1, 12, 0.05, 'm/s' ],
			[ 'ziplineSpeed', 'Zipline speed', 8.5, 1, 20, 0.05, 'm/s' ],
			[ 'wallRunReach', 'Wall run probe', 0.35, 0.2, 1, 0.01, 'm' ],
			[ 'slideFriction', 'Slide friction', 0, 0, 5, 0.05, '' ],
			[ 'slideBraking', 'Slide braking', 8.5, 0, 25, 0.05, 'm/s²' ],
			[ 'rootMotionScale', 'Root motion distance', 1, 0.1, 2, 0.05, '×' ],
			[ 'slowMotionScale', 'Slow motion scale', 0.25, 0.01, 0.5, 0.01, '×' ],
			// How long slow motion takes to ease in and out (s, of real time).
			[ 'slowMotionEase', 'Slow motion ease', 0.15, 0, 1, 0.01, 's' ]
		]
	},
	{
		name: 'Ragdoll',
		fields: [
			[ 'ragdollMassScale', 'Body mass scale', 1, 0.25, 3, 0.05, '×' ],
			[ 'ragdollMotorScale', 'Angular motor stiffness', 1, 0, 3, 0.05, '×' ],
			[ 'ragdollLimitScale', 'Angular limit stiffness', 1, 0.1, 3, 0.05, '×' ]
		]
	},
	{
		name: 'Camera',
		fields: [
			[ 'fov', 'Third person FOV (horizontal)', radians( 115 ), radians( 60 ), radians( 150 ), radians( 1 ), 'angle' ],
			[ 'firstPersonFov', 'First person FOV (horizontal)', radians( 142 ), radians( 60 ), radians( 165 ), radians( 1 ), 'angle' ],
			[ 'cameraDistance', 'Camera distance', 3, 0.8, 6, 0.05, 'm' ],
			[ 'cameraForward', 'Camera forward offset', 1.2, 0, 2, 0.005, 'm' ],
			[ 'cameraHeight', 'Camera height above capsule', 0.66, 0.1, 1.5, 0.005, 'm' ],
			[ 'cameraShoulder', 'Shoulder offset', 0.5, - 1, 1, 0.005, 'm' ],
			[ 'cameraFollowRate', 'Position interpolation', 5.8, 1, 40, 0.05, '/s' ],
			[ 'cameraVerticalFollowRate', 'Vertical interpolation', 3.65, 1, 40, 0.05, '/s' ],
			[ 'cameraTurnRate', 'Rotation interpolation', 8.9, 1, 40, 0.05, '/s' ]
		]
	},
	{
		name: 'Input',
		fields: [
			[ 'trickMouseFlick', 'Mouse trick threshold', 1.5, 0.1, 10, 0.1, 'counts' ],
			[ 'trickStickFlick', 'Stick trick threshold', 0.2, 0, 1.8, 0.02, '' ],
			[ 'trickSideSector', 'Side trick sector', radians( 44 ), radians( 10 ), radians( 80 ), radians( 1 ), 'angle' ],
			[ 'mouseSensitivity', 'Look sensitivity', LOOK_ONE, 0.05, 4, 0.025, 'look' ],
			[ 'stickLookRate', 'Stick look rate', radians( 125 ), radians( 10 ), radians( 360 ), radians( 5 ), 'angle/s' ],
			[ 'lookDeadZone', 'Look dead zone', 0.2, 0, 0.49, 0.01, '' ],
			[ 'moveDeadZone', 'Movement dead zone', 0.2, 0, 0.5, 0.01, '' ]
		]
	}
];

/** How a unit shows to a person, where it is not shown as it is: `shown( value )` and back, `value( shown )`. */
const TUNING_UNITS = {
	angle: { label: '°', shown: degrees, value: radians },
	'angle/s': { label: '°/s', shown: degrees, value: radians },
	// A look sensitivity against LOOK_ONE: its default shows as 1×.
	look: { label: '×', shown: ( value ) => value / LOOK_ONE, value: ( shown ) => shown * LOOK_ONE },
};

/** Every tuning value as it starts, by key. */
const TUNING_DEFAULTS = Object.freeze( Object.fromEntries( TUNING_GROUPS.flatMap( ( group ) => group.fields.map( ( field ) => [ field[ 0 ], field[ 2 ] ] ) ) ) );

const UNIT_OF = Object.fromEntries( TUNING_GROUPS.flatMap( ( group ) => group.fields.map( ( field ) => [ field[ 0 ], field[ 6 ] ] ) ) );

/**
 * A tuning value as a person reads it: `showTuning( 'walkableSlope', radians( 65 ) )` is '65°'.
 * @param {string} key
 * @param {number} value
 * @returns {string}
 */
function showTuning( key, value ) {

	const unit = UNIT_OF[ key ] ?? '', units = TUNING_UNITS[ unit ];
	if ( ! units ) return `${value}${unit ? ` ${unit}` : ''}`;
	return `${+ units.shown( value ).toFixed( 6 )}${units.label}`;

}

// Fixed numbers of the run, beside the tuning that scales them.

/** The runner's capsule standing: its radius and its half height (m). */
const CAPSULE = Object.freeze( { radius: 0.185, halfHeight: 0.9 } );

/** Gravity before the tuning's gravity scale (m/s²). */
const GRAVITY = 9.8;

/** The fastest a fall gets (m/s, downward). */
const TERMINAL_FALL_SPEED = - 40;

// Where the tuning is saved in the browser.
const STORAGE_KEY = 'parkour-tuning';

// Defaults the table has had before, by key. The tuning once saved every value, tuned or not, so a saved value at a
// default since changed was never tuned: it takes the default as it is now.
const FORMER_DEFAULTS = { slowMotionScale: [ 0.05 ] };

/**
 * Checks tuning values against the table.
 * @param {Object<string, number>} values some or all of the keys
 * @returns {Object<string, number>} a full set: the defaults with the given values over them; keys the table does not
 *   have are dropped
 * @throws if a value is not a finite number inside its range
 */
function validateTuning( values ) {

	const result = { ...TUNING_DEFAULTS };

	for ( const group of TUNING_GROUPS ) {

		for ( const [ key, , , min, max ] of group.fields ) {

			if ( ! ( key in values ) ) continue;
			const value = values[ key ];
			if ( typeof value !== 'number' || ! Number.isFinite( value ) || value < min || value > max ) throw new Error( `Invalid tuning value: ${ key } (${ min }–${ max })` );
			result[ key ] = value;

		}

	}

	return result;

}

/** The tuning a simulation reads, saved in the browser's storage as it changes. */
class Tuning {

	/**
	 * @param {Storage|null} [storage] where the values are saved (null: nowhere, as in a replay)
	 */
	constructor( storage = globalThis.localStorage ) {

		this.storage = storage;
		this.values = { ...TUNING_DEFAULTS };

		// Saved values that no longer fit the table (a range changed since) leave the defaults.
		try {

			const saved = JSON.parse( storage?.getItem( STORAGE_KEY ) || '{}' );
			for ( const [ key, former ] of Object.entries( FORMER_DEFAULTS ) ) if ( former.includes( saved[ key ] ) ) delete saved[ key ];
			this.values = validateTuning( saved );

		} catch {}

	}

	/**
	 * Sets one value and saves the tuning.
	 * @param {string} key
	 * @param {number} value
	 * @throws if the value is out of its range
	 */
	set( key, value ) {

		this.values = validateTuning( { ...this.values, [ key ]: value } );
		this.save();

	}

	/** Every value back to its default, saved. */
	reset() {

		this.values = { ...TUNING_DEFAULTS };
		this.save();

	}

	// Saves the values tuned away from their defaults: the rest follow the defaults as the game changes them.
	save() {

		const tuned = Object.fromEntries( Object.entries( this.values ).filter( ( [ key, value ] ) => value !== TUNING_DEFAULTS[ key ] ) );

		try {

			this.storage?.setItem( STORAGE_KEY, JSON.stringify( tuned ) );

		} catch {}

	}

}

export { TUNING_GROUPS, TUNING_DEFAULTS, TUNING_UNITS, showTuning, CAPSULE, GRAVITY, TERMINAL_FALL_SPEED, validateTuning, Tuning };
