// The tutorial's lessons, in the order its course takes them (public/courses/tutorial.json, written by
// tools/courses/write-courses.mjs): one move each, taught where missing it costs nothing, then asked for where the way
// on needs it. src/tutorial/Tutorial.js follows the runner through them and the HUD shows the lesson's card.
//
// Plan places are [ x0, z0, x1, z1 ] (m) on the course; heights are the floor's top (m). Each lesson has:
//
//   id, n           stable name (the demo's options keep the lessons done by it) and its number (the finish has none)
//   chapter, name   what the card is headed
//   bay             the stretch of the course it covers: the runner on foot in it is at this lesson, and its flag (the
//                   course's spawn named by the lesson's id) is where a restart and a fall go back to
//   say, also       the card's words, with { a: action } for a binding (src/ui/controls.js's bindingOf)
//   touch           { say, also } in their place with the touch controls on, where the words name what they have not
//                   (they sprint by the stick, and play in Easy mode, whose pilot aims the precision jumps)
//   tasks           what to do, ticked in any order: `text`, and what the runner must do (below)
//   fails           what sends the runner back to the flag: places it may not stand in (into a pit, past a move
//                   missed); `unless` names the task that makes it fine
//
// A task or a fail is matched against the runner each frame:
//
//   state     the runner in that state (or one of them)
//   vault     the runner vaulting, that vault ('dash', 'speed' or 'kong')
//   at        ... with the runner over that place
//   stand     the runner on foot over that place, `y` the floor's height (within 0.4 m)
//   moved     ... the runner having moved this far (m) in that state since it began
//   charged   the jump's charge full while on foot
//   door      that door open; worked: that valve or button worked

const g = ( a ) => ( { a } );

const LESSONS = [
	{
		id: 'run', n: 1, chapter: 'Moving', name: 'Run and Look', bay: [ 12, 20, 27.5, 30 ],
		say: [ 'Run with ', g( 'move' ), ' and look around with ', g( 'look' ), '.' ],
		tasks: [
			{ text: 'Run', state: [ 'walking', 'sprinting' ] },
			{ text: 'Run past the three posts', stand: [ 26.5, 20, 27.5, 30 ], y: 0 },
		],
	},
	{
		id: 'jump', n: 2, chapter: 'Moving', name: 'Sprint and Jump', bay: [ 27.5, 20, 35, 30 ],
		say: [ 'Hold ', g( 'sprint' ), ' to sprint. Tap ', g( 'jump' ), ' at the edge to jump.' ],
		touch: { say: [ 'Push ', g( 'move' ), ' to its edge to sprint. Tap ', g( 'jump' ), ' at the edge to jump.' ] },
		tasks: [
			{ text: 'Sprint', state: 'sprinting' },
			{ text: 'Jump the 2.5 m gap', stand: [ 34.5, 20, 37, 30 ], y: 0 },
		],
		fails: [ { stand: [ 32, 20, 34.5, 30 ], y: - 2 } ],
	},
	{
		id: 'charge', n: 3, chapter: 'Moving', name: 'Charged Jump', bay: [ 35, 20, 55, 30 ], meter: true,
		say: [ 'Hold ', g( 'jump' ), ' as you run up: the meter fills. Let go at the edge.' ],
		tasks: [
			{ text: 'Fill the jump meter', charged: true },
			{ text: 'Clear the 4.2 m gap', stand: [ 54.7, 20, 57, 30 ], y: 0 },
		],
		fails: [ { stand: [ 50.5, 20, 54.7, 30 ], y: - 2 } ],
	},
	{
		// Over the fence by any jump: a tap hops onto it and off, Jump held springs off its top, an early jump clears it.
		// Counted on the floor past it, up to the next fence (a spring off the top lands well past this bay).
		id: 'vault', n: 4, chapter: 'Obstacles', name: 'Vault', bay: [ 55, 20, 62, 30 ],
		say: [ 'Run at the fence and press ', g( 'jump' ), ' to get over it.' ],
		tasks: [
			{ text: 'Get over the 0.9 m fence', stand: [ 59.2, 20, 66.4, 30 ], y: 0 },
		],
	},
	{
		id: 'trickvault', n: 5, chapter: 'Obstacles', name: 'Speed and Kong Vaults', bay: [ 62, 20, 77.5, 30 ],
		say: [ 'Hold ', g( 'grab' ), ' and press ', g( 'flip' ), ' as you reach a fence to speed vault it, or ', g( 'wheel' ), ' to kong vault it.' ],
		also: [ 'Holding ', g( 'grab' ), ' is the fast way up a low wall too: you hop straight onto it, with no hang.' ],
		tasks: [
			{ text: 'Speed vault a fence', vault: 'speed' },
			{ text: 'Kong vault a fence', vault: 'kong' },
		],
	},
	{
		// The bay runs a metre past the wall's far edge, over the next bay's start (the first bay listed wins): the runner
		// is still on foot on the top a little past the edge, and would be at the next lesson before the drop is counted.
		id: 'climb', n: 6, chapter: 'Obstacles', name: 'Up and Over', bay: [ 77.5, 20, 89, 30 ],
		say: [ 'Run at the wall holding ', g( 'grab' ), ': you hop up onto it.' ],
		tasks: [
			{ text: 'Get onto the 1.7 m wall', stand: [ 83.5, 20, 88, 30 ], y: 1.7 },
			{ text: 'Drop down the far side', stand: [ 88, 20, 96, 30 ], y: 0 },
		],
	},
	{
		id: 'wallclimb', n: 7, chapter: 'Obstacles', name: 'Wallclimb and Shimmy', bay: [ 88, 20, 96, 30 ],
		say: [ 'Run at the tall wall, jump and hold ', g( 'grab' ), ': you run up it and hang. Shimmy with ', g( 'shimmy' ), ' past the railing, then hold ', g( 'forward' ), ' and press ', g( 'jump' ), ' to climb up.' ],
		also: [ 'Press ', g( 'dive' ), ' to let go and drop.' ],
		tasks: [
			{ text: 'Run up the 3.1 m wall', state: [ 'catchingLedge', 'hanging' ] },
			{ text: 'Shimmy along the edge', state: 'hanging', moved: 1 },
			{ text: 'Climb up', stand: [ 88, 10, 96, 20 ], y: 3.1 },
		],
	},
	{
		id: 'wallrun', n: 8, chapter: 'Walls and Beams', name: 'Wall Run', bay: [ 66, 10, 96, 20 ],
		say: [ 'Jump beside the wall and hold ', g( 'grab' ), ' to run along it. ', g( 'jump' ), ' jumps off.' ],
		tasks: [
			{ text: 'Wall run', state: 'wallRunning' },
			{ text: 'Cross the 3.5 m trench', stand: [ 66, 10, 70.5, 20 ], y: 3.1 },
		],
		fails: [ { stand: [ 70.5, 10, 74, 20 ], y: 0 } ],
	},
	{
		id: 'balance', n: 9, chapter: 'Walls and Beams', name: 'Balance', bay: [ 52, 10, 66, 20 ],
		say: [ 'Let go of ', g( 'sprint' ), ' and walk onto the beam with ', g( 'forward' ), '. Keep it steady.' ],
		touch: { say: [ 'Ease ', g( 'move' ), ' back from its edge and walk onto the beam. Keep it steady.' ] },
		tasks: [
			{ text: 'Walk the 6 m beam', stand: [ 52, 10, 56, 20 ], y: 3.1 },
		],
		fails: [ { stand: [ 56, 10, 62, 20 ], y: 0 } ],
	},
	{
		id: 'stride', n: 10, chapter: 'Walls and Beams', name: 'Stride', bay: [ 32, 10, 52, 20 ],
		say: [ 'Hold ', g( 'grab' ), ' and walk to the edge: you stride to the next girder. Keep holding to stride on.' ],
		tasks: [
			{ text: 'Stride', state: 'striding' },
			{ text: 'Stride all four girders', stand: [ 32, 10, 36, 20 ], y: 3.1 },
		],
		fails: [ { stand: [ 36, 10, 48, 20 ], y: 0 } ],
	},
	{
		id: 'roll', n: 11, chapter: 'Walls and Beams', name: 'Drop and Roll', bay: [ 12, 10, 32, 20 ],
		say: [ 'Step off the end and hold ', g( 'tuck' ), ' as you land to roll.' ],
		tasks: [
			{ text: 'Drop 6.1 m', stand: [ 0, 14, 12, 30 ], y: - 3 },
			{ text: 'Roll on landing', state: 'rolling', at: [ 0, 10, 12, 30 ] },
		],
	},
	{
		id: 'pipes', n: 12, chapter: 'Apparatus', name: 'Pipes and Ladders', bay: [ 0, 14, 12, 30 ],
		say: [ 'Hold ', g( 'grab' ), ' at the pipe. ', g( 'forward' ), ' climbs and ', g( 'back' ), ' slides down. The ladder works the same way.' ],
		tasks: [
			{ text: 'Climb the drainpipe', state: 'onPipe' },
			{ text: 'Climb the ladder', state: 'onLadder' },
		],
	},
	{
		id: 'slide', n: 13, chapter: 'Apparatus', name: 'Slide', bay: [ 0, 0, 22, 10 ],
		say: [ 'Sprint and press ', g( 'slide' ), ' to slide under the bar.' ],
		tasks: [
			{ text: 'Slide under the 1.3 m bar', state: 'sliding', at: [ 16, 0, 20, 10 ] },
		],
	},
	{
		id: 'swing', n: 14, chapter: 'Apparatus', name: 'Swing', bay: [ 22, 0, 38, 10 ],
		say: [ 'Jump at the bar and hold ', g( 'grab' ), ': it swings you across. Let go to fly off.' ],
		tasks: [
			{ text: 'Swing on the bar', state: 'onBar' },
			{ text: 'Land past the 5 m gap', stand: [ 33, 0, 40, 10 ], y: 6.2 },
		],
		fails: [ { stand: [ 28, 0, 33, 10 ], y: 3.1 } ],
	},
	{
		id: 'precision', n: 15, chapter: 'Apparatus', name: 'Precision', bay: [ 38, 0, 56, 10 ],
		say: [ 'At the edge, hold ', g( 'precision' ), ' to crouch and aim, then ', g( 'jump' ), '. Hold ', g( 'precision' ), ' into the landing to stick it.' ],
		touch: { say: [ 'Walk to the edge and tap ', g( 'jump' ), ': from a walk, Easy mode crouches, aims and sticks the landing.' ] },
		tasks: [
			{ text: 'Aim', state: 'aiming' },
			{ text: 'Cross on the three posts', stand: [ 54, 0, 56, 10 ], y: 6.2 },
		],
		fails: [ { stand: [ 40, 0, 54, 10 ], y: 3.1 } ],
	},
	{
		id: 'zipline', n: 16, chapter: 'Apparatus', name: 'Zipline', bay: [ 56, 0, 66, 10 ],
		say: [ 'Jump at the cable holding ', g( 'grab' ), '. Let go to drop off.' ],
		tasks: [
			{ text: 'Ride the zipline', state: 'onZipline' },
			{ text: 'Land on the plaza', stand: [ 66, 0, 108, 10 ], y: 0 },
		],
		fails: [ { stand: [ 66, 0, 108, 10 ], y: 0, unless: 0 } ],
	},
	{
		id: 'doors', n: 17, chapter: 'Apparatus', name: 'Doors', bay: [ 66, 0, 108, 10 ],
		say: [ 'Run into a door to barge it open. At a valve or a button, press ', g( 'interact' ), '.' ],
		tasks: [
			{ text: 'Open the door', door: 'plaza_door' },
			{ text: 'Go through', stand: [ 108, 0, 124, 30 ], y: 0 },
		],
	},
	{
		id: 'finish', n: 0, chapter: 'Finish', name: 'Into the Foundry', bay: [ 108, 0, 124, 30 ], finish: true,
		say: [ 'Try the tricks in the air: ', g( 'flip' ), ' ', g( 'wheel' ), ' ', g( 'dive' ), ' ', g( 'backflip' ), '. Then ', g( 'interact' ), ' at the valve opens the gate.' ],
		tasks: [
			{ text: 'Open the gate to the Foundry', worked: 'gate_valve' },
		],
	},
];

/**
 * The first lesson not done (the finish once they all are).
 * @param {string[]} done the ids of the lessons done
 * @returns {object}
 */
function nextLesson( done ) {

	return LESSONS.find( ( lesson ) => lesson.n && ! done.includes( lesson.id ) ) ?? LESSONS.at( - 1 );

}

export { LESSONS, nextLesson };
