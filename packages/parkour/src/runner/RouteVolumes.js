import { CAPSULE } from '../sim/tuning.js';

// Which pipe, zipline or ladder the runner can take hold of: the runner's capsule against the course's catch volumes
// (their own query world, built with the world). A volume the runner stays in finds where along its route the runner
// is every 50 ms, the first time 50 ms after the runner was found in it: each look holds the next back on the runner's
// clock, a hold per volume. Leaving a volume forgets it.

// How often a volume the runner is in looks again (s).
const DETECT_EVERY = 0.05;

class RouteVolumes {

	/**
	 * @param {Object} runner Reads its world, position, clock and capsule height.
	 */
	constructor( runner ) {

		this.runner = runner;

		// Each catch volume, in the world's order (pipes, then ziplines, then ladders), with the name of its hold on the
		// clock and whether the runner is in it.
		this.volumes = runner.world.catchVolumes.map( ( solid, index ) => ( { solid, route: solid.route, type: solid.kind, hold: `catchVolume${ index }`, inside: false, detection: null } ) );

		/** The volume of each kind that last found the runner: `{ route, type, detection }`, or null. */
		this.current = { pipe: null, zipline: null, ladder: null };

	}

	reset() {

		this.current.pipe = this.current.zipline = this.current.ladder = null;

		for ( const volume of this.volumes ) this.forget( volume );

	}

	poll() {

		if ( ! this.volumes.length ) return;

		const c = this.runner;
		const capsule = { kind: 'capsule', radius: CAPSULE.radius, halfHeight: c.capsule.halfHeight };
		const inside = new Set( c.world.catchWorld.overlap( capsule, c.position ) );

		for ( const volume of this.volumes ) {

			const { route, type } = volume;

			if ( ! inside.has( volume.solid ) ) {

				if ( volume.inside ) {

					this.current[ type ] = null;
					this.forget( volume );

				}

				continue;

			}

			// Found here: the first look waits as long as each look holds back the next.
			if ( ! volume.inside ) {

				volume.inside = true;
				c.clock.hold( volume.hold, DETECT_EVERY );

			}

			if ( c.clock.held( volume.hold ) ) continue;
			c.clock.hold( volume.hold, DETECT_EVERY );

			// The point on the route as far from its start as the runner is (ignoring height on a zipline).
			const offset = c.position.clone().sub( route.start );

			if ( type === 'zipline' ) offset.y = 0;
			volume.detection = route.start.clone().addScaledVector( route.end.clone().sub( route.start ).normalize(), offset.length() );
			this.current[ type ] = volume;

		}

	}

	forget( volume ) {

		volume.inside = false;
		volume.detection = null;
		this.runner.clock.cancel( volume.hold );

	}

}

export { RouteVolumes };
