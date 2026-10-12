/**
 * What each route move asks of the runner and does to its speed: the approach speed it needs, the speed the runner
 * leaves it at, how long it takes, and the path a jump flies. The route plans with these, the validator checks
 * arrivals against them, and the generator keeps track of the runner's speed along what it builds.
 *
 * The moves are the course's own words for what a link does (`run`, `jump`, `drop`, `vault`, `wallclimb`, `climbUp`,
 * `shimmy`, `transfer`, `dropToHang`, `ledgeWalk`, `wallrun`, `corridor`, `pipe`, `ladder`, `swing`, `zipline`,
 * `beam`, `slide`, `slideUnder`, `crouch`, `door`, `springboard`, …); the numbers are the level metrics'.
 */
import * as THREE from 'three/webgpu';
import { metrics as M } from './metrics.js';
import { speedAfter, speedFor } from './reach.js';

// The fall a move ends in: its `fall`, or how far its landing is below its take-off.
const fallOf = ( l ) => l.params.fall ?? Math.max( 0, - ( l.params.rise ?? 0 ) );
// Landing a jump or a drop: rolled from the height a landing stops being run out of (keeping the speed), plain below.
const land = ( v, l ) => speedAfter( fallOf( l ) >= M.landing.run ? 'skillRoll' : 'landing', v );

/**
 * The speed (m/s) the runner leaves each move at, from the speed it arrives at and the link (its `params`).
 * Moves that end in a hang, on a pipe or standing still leave at 0.
 */
export const SPEED_AFTER = {
	run: ( v ) => v,
	jump: land,
	drop: land,
	vault: ( v ) => speedAfter( 'speedVault', v ),
	climb: () => 0,
	wallclimb: () => 0,
	shimmy: () => 0,
	climbUp: () => 0,
	transfer: () => 0,
	dropToHang: () => 0,
	ledgeWalk: () => 1,
	wallrun: ( v ) => v,
	corridor: ( v ) => v,
	pipe: () => 0,
	ladder: () => 0,
	swing: () => M.momentum.moves.swingRelease.set,
	// The drop off a zipline's end is landed like a roll from free-running speed.
	zipline: () => speedAfter( 'skillRoll', M.speed.freerun ),
	beam: () => M.balance.speed,
	slide: ( v ) => Math.max( v, M.speed.sprint ),
	slideUnder: ( v ) => speedAfter( 'slideExit', v ),
	crouch: () => 1.2,
	door: ( v ) => v >= M.door.barge.speed ? Math.min( M.door.barge.max, v + M.door.barge.add ) : 0,
	springboard: ( v ) => v,
	interact: () => 0,
	// Kicked off the wall back the way the runner came.
	wallclimbTurn: () => 2.5,
	pullUp: () => 0,
	breach: () => 0,
};

/**
 * The approach speed a move needs: `min` to make it at all, `comfortable` to make it from imperfect input.
 * @param {string} move
 * @param {Object} params The link's params (`gap` and `rise` for a jump).
 * @return {{ min: number, comfortable: number }} Infinity when no speed makes it.
 */
export function speedNeeded( move, params ) {

	switch ( move ) {

		case 'jump': {

			const s = speedFor( params.gap ?? 0, params.rise ?? 0 );
			return { min: s.max ?? Infinity, comfortable: s.comfortable ?? s.max ?? Infinity };

		}

		case 'vault': return { min: M.obstacle.run, comfortable: M.obstacle.run + 0.5 };
		case 'wallrun':
		case 'corridor': return { min: M.wall.run.speed.max, comfortable: M.wall.run.speed.comfortable };
		case 'wallclimb':
		case 'wallclimbTurn': return { min: M.wall.climb.runUp.comfortable.speed, comfortable: M.wall.climb.runUp.comfortable.speed };
		case 'swing': return { min: M.bar.speed, comfortable: M.bar.speed + 0.5 };
		case 'slideUnder': return { min: M.slide.speed, comfortable: M.slide.speed + 0.5 };
		case 'springboard': return { min: M.speed.sprint, comfortable: M.speed.freerun };
		default: return { min: 0, comfortable: 0 };

	}

}

/**
 * How long a link takes (s) at a speed: its length at the move's pace, or the time the move's animation takes.
 * @param {Object} link `move`, `params` and `length`.
 * @param {number} v The speed it is taken at (m/s).
 * @return {number}
 */
export function moveTime( link, v ) {

	const p = link.params, L = link.length;
	switch ( link.move ) {

		// A run counts at least a jog's pace; a move with no time of its own (below), at least a run's.
		case 'run': return L / Math.max( 1.5, v );
		case 'climb':
		case 'wallclimb': return 1.6 + ( p.height ?? 3 ) / 3;
		case 'climbUp': return 1.2;
		case 'transfer':
		case 'dropToHang': return 1.2;
		case 'ledgeWalk': return L / 1;
		case 'shimmy': return L / M.ledge.shimmy.speed;
		case 'pipe':
		case 'ladder': return ( p.height ?? L ) / M.climb.up + 0.8;
		case 'beam': return L / M.balance.speed;
		case 'crouch': return L / 1.2;
		case 'interact': return 1.5;
		case 'wallclimbTurn': return 2.5;
		case 'pullUp': return ( p.height ?? 5 ) / 2.5 + 4.5;
		case 'breach': return 3.5 + L / 3;
		case 'door': return v >= M.door.barge.speed ? L / v : M.door.kick + L / 2;
		default: return L / Math.max( 3, v );

	}

}

/**
 * The path of a jump from a to b at a horizontal speed (no slower than 2 m/s, at least a quarter second in the air),
 * under real gravity: a parabola in n segments.
 * @return {Array<THREE.Vector3>}
 */
export function jumpArc( a, b, v, n = 16, g = M.gravity ) {

	const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot( dx, dz ), T = Math.max( 0.25, d / Math.max( 2, v ) );
	const vy = ( b.y - a.y + g * T * T / 2 ) / T, out = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = T * i / n;
		out.push( new THREE.Vector3( a.x + dx * i / n, a.y + vy * t - g * t * t / 2, a.z + dz * i / n ) );

	}

	return out;

}
