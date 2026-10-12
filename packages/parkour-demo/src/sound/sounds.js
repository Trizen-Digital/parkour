// The game's sounds: each one's files in public/sounds/, how loud it plays before the settings' volumes, how many
// copies of it may play at once (the oldest stops for a new one) and the least time between two plays of it (s), so a
// cue fired twice in one frame, or by two takes crossing at once, plays once; and the room they all play in (REVERB).
// Data only: Mixer.js plays them and Sound.js says when.

const files = ( name, count ) => Array.from( { length: count }, ( _, i ) => `${name}_${i + 1}` );

const SOUNDS = Object.freeze( {
	// Feet on the ground and on a wall.
	step: { files: files( 'step', 4 ), level: 0.315, voices: 3, gap: 0.06 },
	// Feet and hands on a ladder's rungs or a pipe; hands along a ledge.
	rung: { files: files( 'rung', 5 ), level: 0.6, voices: 2, gap: 0.06 },
	jump: { files: [ 'jump' ], level: 0.8, voices: 1, gap: 0.1 },
	land: { files: [ 'land' ], level: 0.6, voices: 2, gap: 0.1 },
	// Rolls, cartwheels and ground tricks, and the scramble of climbing up and over.
	roll: { files: [ 'roll' ], level: 0.55, voices: 1, gap: 0.15 },
	// A quick slide whole, the start of a long one, a skid, a slide down a pole, pipe or ladder.
	slide: { files: [ 'slide' ], level: 0.8, voices: 1, gap: 0.2 },
	// Hands on a ledge, bar, rope, pole or zipline; a foot into a wall or a door.
	catch: { files: [ 'catch' ], level: 0.85, voices: 2, gap: 0.12 },
	// The body hitting a shut door it runs through (the shoulder barge).
	door: { files: [ 'hit_door' ], level: 0.8, voices: 1, gap: 0.3 },
	bail: { files: [ 'bail' ], level: 1, voices: 1, gap: 0.5 },
	// The air rushing past: one loop, faded by speed (Mixer.wind). Raised 8 dB over the file (10 ^ ( 8 / 20 )).
	wind: { files: [ 'wind' ], level: 2.51, loop: true },
	// The place around the runner: one loop, always playing, on its own volume.
	ambient: { files: [ 'ambient' ], level: 1, loop: true },
} );

// The room. Everything (the effects, the wind and the ambience, each after its volume) plays 100% dry, and the same
// mix feeds one convolution reverb through this impulse response, which comes back at `wet`: a share of that mix, 0 to
// 1, under the master volume. A sound turned down sends less, and nothing at 0.
// `normalize: true` lets the browser scale the impulse response to an even loudness (for env_ir, 20 dB down from the
// level it was rendered at), so re-rendering it louder or quieter leaves the mix alone; false plays it as rendered.
// Normalized, at a wet of 1 a hit's reverb carries about 6 dB more energy than the hit, and a steady sound's comes back
// about 7 dB under it; 0.12 (-18 dB) puts a hit's reverb about 12 dB under the hit.
// The file has four channels, taken as true stereo (L to L, L to R, R to L, R to R), as Web Audio's ConvolverNode
// reads four.
const REVERB = Object.freeze( { file: 'env_ir', wet: 0.12, normalize: true } );

export { SOUNDS, REVERB };
