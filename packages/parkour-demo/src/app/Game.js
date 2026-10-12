// The game page: the course on the stage, the sky and its light, the sound's mixer, and a free camera to look round a
// course with. A Player (the playable simulation) attaches to it; the course tools work on the course it shows. The
// settings screen (src/ui/settings.js) sets its params and calls back in (applyLook, showOverlay, setFreeCamera,
// loadCourse).

import * as THREE from 'three/webgpu';
import { densityFogFactor, fog, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGIPipeline } from '../stage/post.js';
import { loadSky } from '../stage/sky.js';
import { Course } from '../course/Course.js';
import { CourseTools } from '../course/tools.js';
import { colors, metrics } from '../course/metrics.js';
import { Mixer } from '../sound/Mixer.js';
import { ui } from '../ui/state.svelte.js';
import { startingCourse } from './modes.js';

const BASE = import.meta.env.BASE_URL;
const SKY = `${BASE}env/sky.hdr`;
const SOUNDS = `${BASE}sounds/`;

// The sky's turn about the vertical, which sets where its sun stands over the courses.
const SKY_YAW = THREE.MathUtils.degToRad( 156 );

// How thick the haze is (per metre): far geometry fades into the horizon's colour.
const HAZE = 0.0015;

// The free camera: orbit with the mouse (left turns, right pans, wheel zooms), fly with WASD or the arrows, Q and E
// down and up, Shift three times as fast.
class InspectCamera {

	constructor( camera, element ) {

		this.camera = camera;
		this.controls = new OrbitControls( camera, element );
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.enabled = false;
		/** Flying speed (m/s). */
		this.speed = 8;
		this.keys = new Set();
		this.enabled = false;

		addEventListener( 'keydown', ( event ) => {

			if ( this.enabled && ! event.target.closest?.( 'input, textarea, select' ) ) this.keys.add( event.code );

		} );
		addEventListener( 'keyup', ( event ) => this.keys.delete( event.code ) );
		addEventListener( 'blur', () => this.keys.clear() );

	}

	enable( on ) {

		this.enabled = on;
		this.controls.enabled = on;
		if ( ! on ) this.keys.clear();

	}

	/** Puts the camera at eye, looking at target (the orbit's centre). */
	frame( eye, target ) {

		this.camera.position.copy( eye );
		this.controls.target.copy( target );
		this.controls.update();

	}

	update( dt ) {

		const held = ( ...codes ) => codes.some( ( code ) => this.keys.has( code ) );
		const ahead = held( 'KeyW', 'ArrowUp' ) - held( 'KeyS', 'ArrowDown' );
		const right = held( 'KeyD', 'ArrowRight' ) - held( 'KeyA', 'ArrowLeft' );
		const up = held( 'KeyE' ) - held( 'KeyQ' );

		if ( ahead || right || up ) {

			// Flying stays level: ahead is where the camera looks, flattened.
			const forward = _forward.subVectors( this.controls.target, this.camera.position ).setY( 0 );
			if ( forward.lengthSq() < 1e-8 ) forward.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion ).setY( 0 );
			forward.normalize();
			const move = _move.set( 0, 0, 0 ).addScaledVector( forward, ahead ).addScaledVector( _right.set( - forward.z, 0, forward.x ), right );
			move.y += up;
			move.normalize().multiplyScalar( this.speed * ( held( 'ShiftLeft', 'ShiftRight' ) ? 3 : 1 ) * dt );
			this.camera.position.add( move );
			this.controls.target.add( move );

		}

		this.controls.update( dt );

	}

}

const _forward = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3();

class Game {

	/**
	 * @param {Stage} stage
	 */
	constructor( stage ) {

		this.stage = stage;
		/** The course rules (what a run can clear), for building courses and the tools. */
		this.metrics = metrics;
		/** Everything the game draws: the course and the player. */
		this.root = new THREE.Group();
		this.root.name = 'game';
		this.course = null;
		this.player = null;
		this.courses = [ 'foundry' ];
		this.ready = false;
		/** Told what is loading while the game starts. */
		this.progress = () => {};

		// The sound's Web Audio (src/sound/), at the settings' volumes. A page stays silent until the player clicks,
		// touches or presses a key in it (a touch counts as it lifts, not as it lands).
		this.mixer = new Mixer();
		this.mixer.setVolumes( ui.options );
		for ( const type of [ 'pointerdown', 'pointerup', 'touchend', 'keydown' ] ) addEventListener( type, () => this.mixer.unlock(), { capture: true } );
		document.addEventListener( 'visibilitychange', () => this.mixer.setHidden( document.hidden ) );

		this.camera = new THREE.PerspectiveCamera( 60, innerWidth / innerHeight, 0.05, 3000 );
		stage.onResize.push( () => {

			this.camera.aspect = innerWidth / innerHeight;
			this.camera.updateProjectionMatrix();

		} );
		this.inspect = new InspectCamera( this.camera, stage.renderer.domElement );

		// The look starts as the player last left it (src/ui/state.svelte.js keeps it).
		const { view, sky, exposure, ssgi, motionBlur } = ui.options;
		this.params = {
			course: 'foundry',
			view,
			affordances: false,
			volumes: false,
			freeCamera: true,
			sky,
			exposure,
			ssgi,
			motionBlur,
		};
		this.tools = new CourseTools( this );
		this.tools.params.route = ui.options.markers;
		this.tools.onReport = ( text ) => ui.report = text;

		if ( import.meta.hot ) import.meta.hot.on( 'game:course', ( change ) => this.onCourseFile( change ) );

	}

	/**
	 * Loads the sky and the course (`?course=name`, else the one the last game mode played: src/app/modes.js), and
	 * makes the player.
	 * @param {(game: Game) => Promise<Player>} [createPlayer]
	 */
	async start( createPlayer = null ) {

		this.progress( 'Loading the sky and the sounds…' );
		const [ sky, list ] = await Promise.all( [
			loadSky( SKY, { groundAlbedo: new THREE.Color( colors.surfaces.top.graybox ).toArray() } ),
			this.listCourses(),
			this.mixer.load( SOUNDS ),
		] );
		this.sky = sky;
		this.courses = list;
		this.params.course = startingCourse( list, new URLSearchParams( location.search ) );
		if ( ! list.includes( this.params.course ) ) this.params.course = list[ 0 ];

		this.post = createGIPipeline( this.stage.renderer, this.stage.scene, this.camera );
		this.progress( 'Building the course…' );
		await this.loadCourse( this.params.course );
		this.frameSpawn();
		this.applyLook();
		this.stage.scene.add( this.root );
		this.inspect.enable( this.params.freeCamera );
		if ( createPlayer ) this.setPlayer( await createPlayer( this ) );
		this.ready = true;

	}

	// The stage lit by the sky: the sun is the sky's own (its direction, colour and strength measured from the HDR), the
	// haze takes the horizon's colour, and one intensity scales sky, environment and sun together.
	applyLook() {

		const sky = this.sky, intensity = this.params.sky;
		this.horizon ??= uniform( new THREE.Color() );
		this.horizon.value.copy( sky.horizon ).multiplyScalar( intensity );
		this.look ??= {
			background: sky.backdrop,
			environment: sky.texture,
			yaw: SKY_YAW,
			hemi: 0,
			sunColor: sky.sunColor,
			sunDirection: sky.sunDirection.clone().applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), SKY_YAW ),
			fogNode: fog( this.horizon, densityFogFactor( HAZE ) ),
			toneMapping: THREE.ACESFilmicToneMapping,
		};
		this.look.backgroundIntensity = this.look.environmentIntensity = intensity;
		this.look.sunIntensity = intensity * sky.sunIrradiance;
		this.look.exposure = this.params.exposure;
		// Through the post-processing when it has something to do; straight to the screen otherwise.
		this.post.use( { ssgi: this.params.ssgi, motionBlur: this.params.motionBlur } );
		this.look.pipeline = this.params.ssgi || this.params.motionBlur ? this.post.pipeline : null;
		this.look.camera = this.camera;
		this.stage.setLook( this.look );

	}

	frame( dt ) {

		if ( ! this.ready ) return;
		this.player?.frame( dt );
		this.tools.update( dt );
		if ( ( this.params.freeCamera || ! this.player ) && ! this.player?.qa?.open ) this.inspect.update( dt );

	}

	setPlayer( player ) {

		this.player = player;
		if ( ! player ) return this.setFreeCamera( true );
		player.setCourse( this.course );
		this.setFreeCamera( false );

	}

	setFreeCamera( on ) {

		this.params.freeCamera = on;
		if ( on ) {

			// The orbit centres 5 m ahead of where the camera looks now, so taking it over does not jump.
			const ahead = new THREE.Vector3( 0, 0, - 5 ).applyQuaternion( this.camera.quaternion ).add( this.camera.position );
			this.inspect.frame( this.camera.position, ahead );

		}

		this.inspect.enable( on );

	}

	// The authored courses (the dev server lists them), and a generated one.
	async listCourses() {

		try {

			const response = await fetch( `${BASE}courses/index.json`, { cache: 'no-store' } );
			if ( response.ok ) {

				const list = await response.json();
				if ( Array.isArray( list ) && list.length ) return [ ...list, 'generated' ];

			}

		} catch {}

		return [ 'foundry', 'test_basic', 'tutorial', 'generated' ];

	}

	/**
	 * Builds and shows a course, and gives it to the player.
	 * @param {string|object} nameOrDefinition an authored course's name, 'generated', or a course definition
	 * @returns {Promise<Course>}
	 */
	async loadCourse( nameOrDefinition = this.params.course ) {

		let definition = nameOrDefinition;
		if ( typeof nameOrDefinition === 'string' ) {

			definition = this.tools.resolve( nameOrDefinition );
			if ( ! definition ) {

				const response = await fetch( `${BASE}courses/${nameOrDefinition}.json`, { cache: 'no-store' } );
				if ( ! response.ok ) throw new Error( `course ${nameOrDefinition}: HTTP ${response.status}` );
				definition = await response.json();

			}

			this.params.course = nameOrDefinition;

		}

		const started = performance.now();
		const course = new Course( definition, { metrics: this.metrics } );
		course.buildMs = performance.now() - started;
		this.course?.dispose();
		this.course = course;
		this.root.add( course.group );
		course.setView( this.params.view );
		this.showOverlay();
		this.tools.onCourse( course );
		await this.player?.setCourse( course );
		return course;

	}

	async reload() {

		try {

			await this.loadCourse( this.params.course );

		} catch ( error ) {

			console.error( `${this.params.course} failed to load; keeping the last good one`, error );

		}

	}

	showOverlay() {

		this.course?.showOverlay( { affordances: this.params.affordances, volumes: this.params.volumes } );

	}

	// The free camera behind and above the spawn, looking down the course.
	frameSpawn() {

		const spawn = this.course.spawn, forward = new THREE.Vector3( Math.sin( spawn.yaw ), 0, Math.cos( spawn.yaw ) );
		this.inspect.frame(
			spawn.position.clone().addScaledVector( forward, - 9 ).setY( spawn.position.y + 6 ),
			spawn.position.clone().addScaledVector( forward, 12 ).setY( spawn.position.y + 1 ),
		);

	}

	// A course file changed on the dev server: the list follows added and removed files, and the course on show
	// reloads when its own file changes.
	async onCourseFile( { name, type } ) {

		if ( type !== 'update' ) this.courses = await this.listCourses();

		if ( name !== this.params.course || type === 'delete' || ! this.ready ) return;
		await this.reload();

	}

}

export { Game };
