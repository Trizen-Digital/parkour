// @trizendigital/parkour-box3d: the box3d physics engine for @trizendigital/parkour, as a backend a Simulation is given
// (`new Simulation( { world, engine: box3d } )`). Its name is what runs and replays record. The backend itself
// (box3d.js) is only loaded when a run asks for it: box3d's WebAssembly is large, and a page that runs on another
// engine never fetches it.

const box3d = Object.freeze( {
	name: 'box3d',
	load: async () => ( await import( './box3d.js' ) ).load(),
} );

export default box3d;
export { box3d };
