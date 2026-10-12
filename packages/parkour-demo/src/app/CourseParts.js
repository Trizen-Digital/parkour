// The course's moving parts, drawn from the run each frame: door leaves swinging open and shut, valve wheels turning,
// buttons pushed in, and ropes hanging from their anchors, swung by the runner and swinging on after it lets go. The
// doors, valves and buttons are the run's own state (the runner's DoorsAndSwitches), which this only reads; how a rope
// sways once let go is drawn here alone, since nothing in the run reads it.

import * as THREE from 'three/webgpu';
import { STEP } from '@trizen/parkour/sim/Simulation.js';
import { aimRope } from '../course/mesh.js';

const UP = new THREE.Vector3( 0, 1, 0 );
const Z = new THREE.Vector3( 0, 0, 1 );

// An open door stands this far round from shut (rad): just short of square, clear of the wall beside its frame.
const DOOR_OPEN = THREE.MathUtils.degToRad( 88 );
// A valve's wheel goes round this many times while it is turned: whole turns, so it ends where it began.
const VALVE_TURNS = 2;
// A pressed button goes in this far (m) and stays in this long (s).
const BUTTON_TRAVEL = 0.025;
const BUTTON_HELD = 0.35;
// A rope let go of sways on as a pendulum of its own length, losing this much of its swing a second (1/s), from the
// swing the runner left it with.
const ROPE_DAMPING = 0.9;
// A frame counts as at most this long (s) for the rope's sway, so a stall does not throw it.
const LONGEST_FRAME = 0.05;
// The pull that hangs a rope straight (m/s²).
const GRAVITY = 9.81;

class CourseParts {

	/**
	 * @param {Course} course its objects' and ropes' meshes (buildMeshes) are moved
	 */
	constructor( course ) {

		this.course = course;
		this.objects = new Map( course.objects.filter( ( o ) => o.mesh ).map( ( o ) => [ o.prim.id, o ] ) );
		// Each rope: its line, where it points from the anchor (a unit vector) and how fast that turns.
		this.ropes = course.lines.filter( ( l ) => l.kind === 'rope' && l.mesh ).map( ( line ) => ( {
			line,
			length: line.a.distanceTo( line.b ),
			down: line.b.clone().sub( line.a ).normalize(),
			velocity: new THREE.Vector3()
		} ) );

	}

	/**
	 * @param {Simulation} sim the run on this course
	 */
	draw( sim ) {

		// At the time the runner is drawn, between its last two steps, so the leaves and wheels move with the body (in
		// slow motion a step lasts several frames).
		const runner = sim.runner, works = runner.doorsAndSwitches, time = runner.time - ( sim.paused ? 0 : STEP - sim.accumulator );

		for ( const state of works.doors ) {

			const o = this.objects.get( state.door.id );
			if ( ! o ) continue;
			o.mesh.quaternion.setFromAxisAngle( UP, o.yaw + state.side * DOOR_OPEN * works.openness( state, time ) );

		}

		for ( const state of works.switches ) {

			const o = this.objects.get( state.item.id );
			if ( ! o ) continue;

			if ( o.kind === 'valve' ) {

				// A valve never turned has no turn to be part way through (its times are −∞): it stands as built.
				const turned = Number.isFinite( state.from ) ? THREE.MathUtils.clamp( ( time - state.from ) / Math.max( state.to - state.from, 1e-6 ), 0, 1 ) : 0;
				o.mesh.quaternion.setFromUnitVectors( Z, o.n ).multiply( new THREE.Quaternion().setFromAxisAngle( Z, - turned * VALVE_TURNS * Math.PI * 2 ) );

			} else {

				const pushed = time - state.workedAt < BUTTON_HELD && time >= state.workedAt;
				o.mesh.position.copy( o.p ).addScaledVector( o.n, pushed ? - BUTTON_TRAVEL : 0 );

			}

		}

		this.drawRopes( sim );

	}

	// A rope the runner holds runs from its anchor through the hands and on along the body; one let go of sways back to
	// hanging straight.
	drawRopes( sim ) {

		const held = sim.runner.polesAndBars.attachment?.kind === 'rope' ? sim.runner.polesAndBars.attachment.rope : null;
		const dt = Math.min( sim.simDt, LONGEST_FRAME );

		for ( const rope of this.ropes ) {

			const anchor = rope.line.a;

			if ( held && held.id === rope.line.prim.id ) {

				const down = sim.position.clone().sub( anchor ).normalize();

				if ( dt > 0 ) rope.velocity.copy( down ).sub( rope.down ).divideScalar( dt );
				rope.down.copy( down );

			} else if ( dt > 0 ) {

				// A pendulum: the pull across the rope, less the damping, then kept unit and its turn across it.
				const pull = new THREE.Vector3( 0, - GRAVITY / rope.length, 0 );
				pull.addScaledVector( rope.down, - pull.dot( rope.down ) );
				rope.velocity.addScaledVector( pull, dt ).multiplyScalar( Math.max( 0, 1 - ROPE_DAMPING * dt ) );
				rope.down.addScaledVector( rope.velocity, dt ).normalize();
				rope.velocity.addScaledVector( rope.down, - rope.velocity.dot( rope.down ) );

			}

			aimRope( rope.line.mesh, anchor, anchor.clone().addScaledVector( rope.down, rope.length ) );

		}

	}

}

export { CourseParts };
