// @trizendigital/parkour-rapier: the Rapier physics engine for @trizendigital/parkour, as a backend a Simulation is given
// (`new Simulation( { world, engine: rapier } )`). Its name is what runs and replays record. The backend itself
// (rapier.js) is only loaded when a run asks for it: Rapier's WebAssembly is large, and a page that runs on another
// engine never fetches it.

const rapier = Object.freeze( {
	name: 'rapier',
	load: async () => ( await import( './rapier.js' ) ).load(),
} );

export default rapier;
export { rapier };
