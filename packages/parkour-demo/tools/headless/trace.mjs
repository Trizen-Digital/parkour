// The trace of a headless run: one row per simulation step and one per rendered frame, every value exactly as the
// simulation holds it. Two runs are the same when their traces are equal bit for bit (compare.mjs).
//
//   steps:  frame, x, y, z, vx, vy, vz, yaw, mode, state, move, moveTime, stunt, stuntTime, markers
//   frames: steps, camX, camY, camZ, camQx, camQy, camQz, camQw, fov, viewYaw, viewPitch, events
//
// `mode` is the movement mode (`ragdoll` while the ragdoll has the body), `move` the move playing and `moveTime` its
// time, `markers` the markers fired in the step (`type:name|…`), `events` the frame's events (`type:name|…`).

import { movementMode } from '@trizendigital/parkour/runner/states.js';
import { eventName, movePlaying } from '@trizendigital/parkour/replay/trace.js';

const STEP_COLUMNS = [ 'frame', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'mode', 'state', 'move', 'moveTime', 'stunt', 'stuntTime', 'markers' ];
const FRAME_COLUMNS = [ 'steps', 'camX', 'camY', 'camZ', 'camQx', 'camQy', 'camQz', 'camQw', 'fov', 'viewYaw', 'viewPitch', 'events' ];

class Trace {

	/**
	 * @param {Simulation} sim
	 */
	constructor( sim ) {

		this.sim = sim;
		this.steps = [];
		this.frames = [];
		this.frameIndex = 0;

	}

	/** A step's row (the simulation's onStep). */
	step() {

		const sim = this.sim, runner = sim.runner, moving = movePlaying( sim );
		this.steps.push( [
			this.frameIndex,
			runner.position.x, runner.position.y, runner.position.z,
			runner.velocity.x, runner.velocity.y, runner.velocity.z,
			runner.yaw,
			sim.ragdoll.active ? 'ragdoll' : movementMode( runner ),
			runner.state,
			moving?.move?.name ?? '',
			moving?.time ?? 0,
			runner.stunt?.name ?? '',
			runner.stunt?.time ?? 0,
			( sim.motion.markers || [] ).map( ( marker ) => marker.type + ':' + marker.name ).join( '|' ),
		] );

	}

	/** A frame's row, after the frame. */
	frame() {

		const sim = this.sim, camera = sim.camera, view = sim.view;
		this.frames.push( [
			sim.steps,
			camera.position.x, camera.position.y, camera.position.z,
			camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w,
			camera.fov,
			view.yaw, view.pitch,
			sim.frameEvents.map( eventName ).join( '|' ),
		] );
		this.frameIndex ++;

	}

	toJSON() {

		return { columns: { steps: STEP_COLUMNS, frames: FRAME_COLUMNS }, steps: this.steps, frames: this.frames };

	}

}

export { Trace, eventName, STEP_COLUMNS, FRAME_COLUMNS };
