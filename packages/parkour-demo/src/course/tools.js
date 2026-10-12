/**
 * The course tools on the settings' Course tab (src/ui/settings.js): generate a course from a seed (rerolling what the
 * validator fails), validate the loaded course and list what it finds, draw the route with its problems, show the
 * reach envelope round the runner or a double-clicked point, and preview Runner Vision from the free camera.
 */
import * as THREE from 'three/webgpu';
import { metrics as M } from './metrics.js';
import { Course } from './Course.js';
import { generate } from './generate.js';
import { buildEnvelope, buildRouteOverlay } from './overlay.js';
import { describe, validate } from './validate.js';

const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _v = new THREE.Vector3();

export class CourseTools {

	/**
	 * @param {Game} game The game shell: its stage, camera, inspect camera, params, course, player and `loadCourse`.
	 */
	constructor( game ) {

		this.game = game;
		this.params = {
			seed: 1, length: 14, difficulty: 0.4,
			route: true, runs: false, problems: false,
			envelope: false, envelopeSpeed: M.speed.freerun,
			preview: false,
		};
		this.info = { text: '-', generated: '-' };
		// The last course generated (the QA recorder tells a generated course by it).
		this.last = null;
		this.report = null;
		this.pick = null;
		this.overlay = null;
		this.envelope = null;
		this.envelopeAt = new THREE.Vector3( Infinity, 0, 0 );
		// Whether the validator's list is shown, and who shows it: told its text, or null to hide it.
		this.reportShown = false;
		this.onReport = () => {};

		game.stage.renderer.domElement.addEventListener( 'dblclick', ( e ) => this.onPick( e ) );

	}

	// The next seed in a fixed sequence, so a session's courses can be found again; then a course from it.
	newSeed() {

		this.params.seed = 1 + ( Math.imul( this.params.seed, 0x9E3779B1 ) >>> 0 ) % 99999;
		return this.regenerate();

	}

	/**
	 * A course definition for a name the tools make: `generated` builds one from the current settings.
	 * @return {Object|null}
	 */
	resolve( name ) {

		if ( name !== 'generated' ) return null;
		return this.build();

	}

	// Generates with the validator in the loop: a challenge with a violation is rerolled.
	build() {

		const { seed, length, difficulty } = this.params;
		const check = ( def ) => {

			const c = new Course( def, { metrics: this.game.metrics } );
			const report = validate( c );
			c.dispose();
			return [ ...new Set( report.violations.map( ( v ) => v.link.params.challenge ).filter( ( i ) => i !== undefined ) ) ];

		};

		const t0 = performance.now();
		const { def, failed, tries } = generate( { seed, length, difficulty, check } );
		this.info.generated = `Seed ${seed} · ${failed.length ? `${failed.length} failing` : 'Valid'} · ${tries} ${tries > 1 ? 'tries' : 'try'} · ${( performance.now() - t0 ).toFixed( 0 )} ms`;
		this.last = def;
		return def;

	}

	async regenerate() {

		await this.game.loadCourse( this.build() );
		this.game.params.course = 'generated';
		this.game.frameSpawn();

	}

	// Downloads the last generated course (or the loaded one) as a course file.
	save() {

		const def = this.last ?? this.game.course?.def;
		if ( ! def ) return;
		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( new Blob( [ JSON.stringify( def, null, '\t' ) ], { type: 'application/json' } ) );
		a.download = `${def.name ?? 'course'}.json`;
		a.click();
		setTimeout( () => URL.revokeObjectURL( a.href ), 1000 );

	}

	/** Validates a course just loaded and redraws the overlays for it. */
	onCourse( course ) {

		if ( ! course ) return;
		const t0 = performance.now();
		const report = validate( course );
		const ms = performance.now() - t0;
		// The tallies; the Problem List has the rest.
		const expected = report.expected.length ? ` ${report.expected.length} ○` : '';
		this.info.text = `${report.violations.length} ✗ ${report.warnings.length} △${expected} · ${ms.toFixed( 0 )} ms`;
		this.report = report;
		this.pick = null;
		this.draw();
		this.drawEnvelope( true );
		if ( this.reportShown ) this.showReport( true );

	}

	draw() {

		const course = this.game.course;
		if ( this.overlay ) {

			this.overlay.removeFromParent();
			this.overlay.geometry.dispose();
			this.overlay = null;

		}

		if ( ! course || ! this.params.route ) return;
		this.overlay = buildRouteOverlay( course, { runs: this.params.runs, problems: this.params.problems } );
		course.group.add( this.overlay );

	}

	// The envelope at the double-clicked point, or on the ground under the runner (redrawn once it has moved 25 cm).
	drawEnvelope( force = false ) {

		const course = this.game.course;
		let at = this.pick;
		if ( ! at ) {

			const pos = this.game.player?.sim?.runner.position;
			if ( pos ) {

				const g = course?.groundAt( pos.x, pos.z, pos.y + 0.5, pos.y - 3 );
				at = g ? _v.set( pos.x, g.y, pos.z ) : null;

			}

		}

		if ( ! this.params.envelope || ! course || ! at ) {

			if ( this.envelope ) {

				this.envelope.removeFromParent();
				this.envelope.geometry.dispose();
				this.envelope = null;

			}

			return;

		}

		if ( ! force && this.envelope && at.distanceTo( this.envelopeAt ) < 0.25 ) return;
		this.envelopeAt.copy( at );
		if ( this.envelope ) {

			this.envelope.removeFromParent();
			this.envelope.geometry.dispose();

		}

		this.envelope = buildEnvelope( course, at.clone(), this.params.envelopeSpeed );
		course.group.add( this.envelope );

	}

	// A double click on a top picks the point to draw the envelope round.
	onPick( e ) {

		const course = this.game.course;
		if ( ! course ) return;
		const el = this.game.stage.renderer.domElement, r = el.getBoundingClientRect();
		_ndc.set( ( ( e.clientX - r.left ) / r.width ) * 2 - 1, - ( ( e.clientY - r.top ) / r.height ) * 2 + 1 );
		_ray.setFromCamera( _ndc, this.game.camera );
		const hit = course.raycast( _ray.ray.origin, _ray.ray.direction, 1000 );
		if ( ! hit || hit.normal.y < 0.5 ) return;
		this.pick = hit.point.clone();
		this.params.envelope = true;
		this.drawEnvelope( true );

	}

	update( dt ) {

		const course = this.game.course;
		if ( ! course ) return;
		if ( this.params.envelope && ! this.pick ) this.drawEnvelope();
		if ( this.params.preview && this.game.params.freeCamera ) {

			// Runner Vision for a runner standing under the free camera's target, heading where the camera looks.
			const cam = this.game.camera, t = this.game.inspect.controls.target;
			const g = course.groundAt( t.x, t.z, t.y + 1, t.y - 30 );
			const dir = _v.set( 0, 0, - 1 ).applyQuaternion( cam.quaternion ).setY( 0 ).normalize().multiplyScalar( 4 );
			if ( g ) course.vision( new THREE.Vector3( t.x, g.y, t.z ), dir, dt );

		}

	}

	/** Shows the validator's list over the game, or hides it. */
	showReport( on ) {

		this.reportShown = on;
		this.onReport( on ? ( this.report ? describe( this.report ) : 'No report' ) : null );

	}

}
