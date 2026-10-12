// Holds the Y Bot in one pose in the running game, to look at from any camera (shot.js to capture it). In the game's
// console: `await import( '/tools/sheet/pose.js' )`, then `__pose( { take, time } )`, or `__pose( { recipe } )` for
// any pose recipe. `at` is the runner's centre (by default standing on the floor at the origin, as the figure stands
// below it), `yaw` its heading; `props: [ 'ledge' ]` adds the wall a hang holds.
import { BODY_DROP } from '@trizendigital/parkour/figure/Figure.js';

window.__pose = function ( { take, time = 0, recipe = { kind: 'clip', take, time }, at = [ 0, - BODY_DROP, 0 ], yaw = 0, props = [] } ) {

	const THREE = window.game.THREE;
	const player = window.game.player, figure = player.sim.figure;
	player.frame = () => {};
	figure.step( 1 / 120, recipe, new THREE.Vector3().fromArray( at ), yaw );
	figure.root.updateMatrixWorld( true );

	window.__props?.removeFromParent();
	const group = window.__props = new THREE.Group();
	group.position.copy( figure.root.position );
	group.rotation.copy( figure.root.rotation );
	const material = new THREE.MeshStandardNodeMaterial( { color: 0x8a6f4d, roughness: 0.8 } );
	if ( props.includes( 'ledge' ) ) {

		// A wall whose top edge is 0.9 m above the runner's centre and 0.185 m in front of it, where hands hang.
		const wall = new THREE.Mesh( new THREE.BoxGeometry( 2, 3, 0.6 ), material );
		wall.position.set( 0, 0.9 - 1.5, 0.185 + 0.3 );
		group.add( wall );

	}

	window.game.root.add( group );
	return { recipe };

};
