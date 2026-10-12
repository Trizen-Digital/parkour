// Where a take puts the Y Bot's hands, feet and hips through it, in the runner's frame (m: x across, y up from the
// capsule's centre, z ahead), with the root bone held still as it is while a move carries the root. For reading a take
// against what it reaches for (the edge it holds, the top it steps onto) when keying its root.
//
//   node tools/moves/limbs.mjs <take> [every s] [capture]
//
// With `capture`, the take is a capture in assets/mocap/ instead (as cut from its start).

import '../headless/env.mjs';

const { Vector3 } = await import( 'three' );
const { Motion } = await import( '@trizendigital/parkour/motion/Motion.js' );
const { YBotFigure } = await import( '../../src/figure/YBotFigure.js' );
const { readCapture } = await import( './lib/clips.js' );
const THREE = await import( 'three' );

const [ name, everyText = '0.05', kind ] = process.argv.slice( 2 );
const every = Number( everyText );
const motion = await new Motion().load();
const figure = await new YBotFigure().load( motion.takes );
let take = name, length;

if ( kind === 'capture' ) {

	const capture = readCapture( name );
	const tracks = capture.tracks.map( ( t ) => new ( t.name.endsWith( '.quaternion' ) ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack )( t.name, new Float32Array( t.times ), new Float32Array( t.values ) ) );
	take = 'capture:' + name;
	figure.sampler.clips.set( take, new THREE.AnimationClip( take, capture.duration, tracks ) );
	length = capture.duration;

} else {

	length = motion.takes.takes.get( name ).length;

}

const bones = [ 'hips', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head' ].map( ( role ) => [ role, figure.model.getObjectByName( figure.roles[ role ] ) ] );
const at = new Vector3();
const show = ( v ) => [ v.x, v.y, v.z ].map( ( n ) => n.toFixed( 2 ).padStart( 6 ) ).join( '' );
console.log( `${take} ${length.toFixed( 3 )} s`.padEnd( 20 ), bones.map( ( [ role ] ) => role.padEnd( 18 ) ).join( '' ) );

for ( let t = 0; t <= length + 1e-6; t += every ) {

	figure.step( 1 / 120, { kind: 'clip', take, time: t, rootMotion: true }, new Vector3(), 0, {} );
	figure.root.updateMatrixWorld( true );
	console.log( t.toFixed( 3 ).padEnd( 20 ), bones.map( ( [ , bone ] ) => show( bone.getWorldPosition( at ) ) ).join( '' ) );

}
