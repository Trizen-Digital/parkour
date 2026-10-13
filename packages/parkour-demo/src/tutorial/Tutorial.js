// The tutorial in play: on the tutorial's course it follows the runner through the lessons (src/tutorial/lessons.js),
// ticks their tasks off as the runner does them, puts the lesson's card on the HUD (ui.lesson, src/ui/Hud.svelte), and
// keeps the checkpoint: the flag of the lesson the runner is at, where a restart or a fall goes back to.
//
// It never touches the runner. It reads the run after each frame, and what it changes it changes between frames
// through the player: a respawn at the flag (into a pit, a bail), which the QA recorder notes on its tape with the
// place it was made at. Which flag is the checkpoint changes no run (only a respawn to it does), so a replay made in the
// tutorial runs again exactly without the tutorial.

import { spawnIndex } from '../world/fromCourse.js';
import { LESSONS, nextLesson } from './lessons.js';
import { setOption, toast, ui } from '../ui/state.svelte.js';
import { TUTORIAL, playSandbox } from '../app/modes.js';

// Into a pit, the runner goes back to the flag after this long (s); after a bail, once the ragdoll has had this long.
const FAIL_DELAY = 0.6;
const BAIL_DELAY = 2;

// After this many goes back to the flag in one lesson, the card offers Easy mode.
const STUCK = 3;

// The runner stands on a floor within this much of its height (m).
const ON_FLOOR = 0.4;

// The capsule's centre stands this far above the floor (as at a spawn).
const STANDING_HEIGHT = 0.9215;

// Once the gate's valve is worked, the Foundry loads after this long (s): the gate is seen to open first.
const GATE_DELAY = 1.5;

// The runner on foot: what moves it from one lesson's bay to the next.
const ON_FOOT = new Set( [ 'standing', 'walking', 'sprinting' ] );

const inside = ( [ x0, z0, x1, z1 ], p ) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

class Tutorial {

	/**
	 * @param {Player} player
	 */
	constructor( player ) {

		this.player = player;
		/** Whether the player's course is the tutorial's. */
		this.active = false;
		this.course = null;
		// The lesson the runner is at (an index into LESSONS), its tasks ticked, and how often it has gone back to its flag.
		this.lesson = 0;
		this.ticks = [];
		this.fails = 0;
		// Where the runner was when it went into the state a `moved` task watches, by task.
		this.from = new Map();
		// Seconds until the runner goes back to the flag (a fail seen), and until the Foundry loads (the gate opened).
		this.failIn = null;
		this.gateIn = null;

	}

	/**
	 * The course the player runs on: on the tutorial's, the runner starts at the flag of the first lesson not done.
	 * @param {Course} course
	 */
	attach( course ) {

		this.course = course;
		this.active = course?.def?.name === TUTORIAL;
		this.failIn = this.gateIn = null;
		if ( ! this.active ) {

			this.player.checkpoint = 0;
			ui.lesson = null;
			return;

		}

		this.enter( LESSONS.indexOf( nextLesson( ui.options.lessonsDone ) ) );

	}

	// The runner is at a lesson: its flag is the checkpoint, its card goes up.
	enter( index ) {

		const lesson = LESSONS[ index ];
		this.lesson = index;
		this.fails = 0;
		this.from.clear();
		this.ticks = lesson.tasks.map( () => ui.options.lessonsDone.includes( lesson.id ) );
		this.player.checkpoint = spawnIndex( this.course, lesson.id );
		this.show();

	}

	/** The run starts again at the flag (the restart key, a fall off the course): the lesson starts again. */
	restarting() {

		if ( ! this.active ) return;
		const lesson = LESSONS[ this.lesson ];
		this.failIn = null;
		this.fails ++;
		this.from.clear();
		if ( ! ui.options.lessonsDone.includes( lesson.id ) ) this.ticks.fill( false );
		this.show();

	}

	/**
	 * After each frame of play: the tasks the runner has done, a fail, the lesson it is at now.
	 * @param {number} dt
	 */
	frame( dt ) {

		if ( ! this.active || this.player.course !== this.course ) return;

		if ( this.gateIn !== null ) {

			this.gateIn -= dt;
			if ( this.gateIn <= 0 ) {

				this.gateIn = null;
				const { game, qa } = this.player;
				playSandbox( { game, qa }, 'foundry' );

			}

			return;

		}

		if ( this.failIn !== null ) {

			this.failIn -= dt;
			if ( this.failIn <= 0 ) this.player.restart();
			return;

		}

		const sim = this.player.sim, runner = sim.runner, lesson = LESSONS[ this.lesson ];

		lesson.tasks.forEach( ( task, i ) => {

			if ( ! this.ticks[ i ] && this.matches( task, runner, i ) ) this.tick( i );

		} );

		if ( sim.ragdoll?.active ) {

			this.failIn = BAIL_DELAY;
			return;

		}

		if ( lesson.fails?.some( ( fail ) => ( fail.unless === undefined || ! this.ticks[ fail.unless ] ) && this.matches( fail, runner ) ) ) {

			this.failIn = FAIL_DELAY;
			return;

		}

		// On foot in another lesson's bay, the runner is at that lesson.
		if ( runner.grounded && ON_FOOT.has( runner.state ) ) {

			const here = LESSONS.findIndex( ( l ) => inside( l.bay, runner.position ) );
			if ( here >= 0 && here !== this.lesson ) this.enter( here );

		}

	}

	tick( i ) {

		const lesson = LESSONS[ this.lesson ];
		this.ticks[ i ] = true;
		if ( this.ticks.every( Boolean ) && ! ui.options.lessonsDone.includes( lesson.id ) ) {

			setOption( 'lessonsDone', [ ...ui.options.lessonsDone, lesson.id ] );
			if ( lesson.finish ) {

				toast( 'Tutorial complete: into the Foundry', 'good' );
				this.gateIn = GATE_DELAY;

			} else toast( `Lesson ${lesson.n} complete: ${lesson.name}`, 'good' );

		}

		this.show();

	}

	/**
	 * Whether the runner does what a task or a fail asks (lessons.js lists the fields).
	 * @param {object} what
	 * @param {Runner} runner
	 * @param {number} [i] the task's index (a `moved` task keeps where its state began)
	 * @returns {boolean}
	 */
	matches( what, runner, i = - 1 ) {

		const p = runner.position, feet = p.y - STANDING_HEIGHT;
		if ( what.state ) {

			const states = [ what.state ].flat();
			if ( ! states.includes( runner.state ) ) {

				this.from.delete( i );
				return false;

			}

			if ( what.at && ! inside( what.at, p ) ) return false;
			if ( what.moved ) {

				if ( ! this.from.has( i ) ) this.from.set( i, p.clone() );
				return this.from.get( i ).distanceTo( p ) >= what.moved;

			}

			return true;

		}

		if ( what.vault ) return runner.vaulting && runner.ledges.placement.variant === what.vault && ( ! what.at || inside( what.at, p ) );
		if ( what.stand ) return runner.grounded && ON_FOOT.has( runner.state ) && inside( what.stand, p ) && Math.abs( feet - what.y ) <= ON_FLOOR;
		if ( what.charged ) return runner.grounded && runner.jumpCharge >= 1;
		if ( what.door ) return runner.doorsAndSwitches.doors.some( ( state ) => state.door.id === what.door && state.open );
		if ( what.worked ) return runner.doorsAndSwitches.switches.some( ( state ) => state.item.id === what.worked && state.workedAt > - Infinity );
		return false;

	}

	// The lesson's card on the HUD.
	show() {

		const lesson = LESSONS[ this.lesson ], ticked = this.ticks.filter( Boolean ).length;
		ui.lesson = {
			n: lesson.n,
			chapter: lesson.chapter,
			name: lesson.name,
			say: lesson.say,
			also: lesson.also ?? null,
			touch: lesson.touch ?? null,
			meter: Boolean( lesson.meter ),
			tasks: lesson.tasks.map( ( task, i ) => ( { text: task.text, done: this.ticks[ i ] } ) ),
			state: ticked === lesson.tasks.length ? 'done' : this.fails >= STUCK ? 'stuck' : ticked ? 'doing' : 'new',
		};

	}

}

export { Tutorial };
