<!-- The Game Mode screen: the tutorial, the sandbox on a course, or the benchmark (src/app/modes.js). It opens over the
	game on the first load and from the pause menu. Beside the rows, what the selected one is: a plan of its course, or
	the benchmark's stations by family. -->
<script>
	import { getContext, onMount } from 'svelte';
	import Screen from './Screen.svelte';
	import Row from './Row.svelte';
	import Loading from './Loading.svelte';
	import { takeMoves } from './nav.js';
	import { planOf } from './plan.js';
	import { setOption, ui } from './state.svelte.js';
	import { TUTORIAL, courseName, openBenchmark, playSandbox, playTutorial, sandboxCourses } from '../app/modes.js';
	import { LESSONS, nextLesson } from '../tutorial/lessons.js';
	import { STATIONS } from '../bench/stations.js';
	import { FAMILIES } from '../bench/Bench.js';
	import { store } from '../qa/store.js';

	const BASE = import.meta.env.BASE_URL;

	const app = getContext( 'app' );
	const { game, qa } = app;

	const courses = sandboxCourses( game );
	let course = $state( courses.includes( ui.options.sandbox ) ? ui.options.sandbox : courses[ 0 ] );
	let loading = $state( null );

	// The lessons in the count (the finish is not one), and how far the player has got.
	const lessons = LESSONS.filter( ( lesson ) => lesson.n );
	const done = $derived( lessons.filter( ( lesson ) => ui.options.lessonsDone.includes( lesson.id ) ).length );
	const next = $derived( nextLesson( ui.options.lessonsDone ) );

	const rows = [
		{
			id: 'tutorial', kind: 'action', label: 'Tutorial',
			value: () => done === lessons.length ? 'Done' : `Lesson ${next.n} / ${lessons.length}`,
			run: () => go( 'Tutorial', () => playTutorial( app ) ),
		},
		{
			id: 'sandbox', kind: 'choice', label: 'Sandbox',
			options: courses.map( ( name ) => [ name, courseName( name ) ] ),
			get: () => course,
			set: ( name ) => course = name,
			run: () => go( courseName( course ), () => playSandbox( app, course ) ),
		},
		{
			id: 'bench', kind: 'action', label: 'Benchmark',
			value: () => `${STATIONS.length} stations`,
			run: () => openBenchmark( app ),
		},
	];

	// The tutorial's row when it is on, else the sandbox's; the tutorial's on the first load.
	let selected = $state( ! ui.options.mode || game.params.course === TUTORIAL ? 0 : 1 );
	const row = $derived( rows[ selected ] );

	async function go( text, run ) {

		if ( loading ) return;
		loading = `Loading ${text}`;
		try {

			await run();

		} finally {

			loading = null;

		}

	}

	// Back to the pause menu that opened the screen, or on into the game behind it (the sandbox, as it is).
	function back() {

		if ( ui.modeBack === 'pause' ) return ui.screen = 'pause';
		if ( ! ui.options.mode ) setOption( 'mode', 'sandbox' );
		qa.resume();

	}

	// The plans of the courses looked at, by name (fetched once).
	const plans = new Map();
	let plan = $state( null );
	// The course file's description, its first sentence.
	let blurb = $state( '' );
	const shown = $derived( row.id === 'tutorial' ? TUTORIAL : row.id === 'sandbox' ? course : null );

	$effect( () => {

		const name = shown;
		plan = null;
		blurb = '';
		if ( ! name || name === 'generated' ) return;
		const ready = plans.get( name ) ?? fetch( `${BASE}courses/${name}.json` ).then( ( response ) => response.json() ).then( ( def ) => ( { ...planOf( def ), about: firstSentence( def.about ) } ) ).catch( () => null );
		plans.set( name, ready );
		ready.then( ( found ) => {

			if ( shown !== name || ! found ) return;
			plan = found;
			blurb = found.about;

		} );

	} );

	const firstSentence = ( text ) => ( text ?? '' ).split( /(?<=\.)\s/ )[ 0 ];

	// The benchmark's open comments (the QA store has them).
	let comments = $state( null );
	store.benchComments().then( ( file ) => comments = ( file.comments ?? [] ).filter( ( c ) => ! c.done ).length ).catch( () => {} );

	// The stations by family, in the run's order, for the benchmark's still.
	const families = STATIONS.reduce( ( list, station ) => {

		const last = list.at( - 1 );
		if ( last?.family === station.family ) last.count ++;
		else list.push( { family: station.family, count: 1 } );
		return list;

	}, [] );

	onMount( () => takeMoves( ( move ) => {

		if ( loading ) return true;
		if ( move === 'up' || move === 'down' ) selected = ( selected + ( move === 'up' ? - 1 : 1 ) + rows.length ) % rows.length;
		else if ( move === 'left' || move === 'right' ) {

			if ( row.id === 'sandbox' ) {

				const i = courses.indexOf( course ) + ( move === 'left' ? - 1 : 1 );
				if ( i >= 0 && i < courses.length ) course = courses[ i ];

			}

		} else if ( move === 'select' ) row.run();
		else if ( move === 'back' ) back();
		else if ( move === 'start' ) qa.resume();
		else return false;
		return true;

	} ) );
</script>

<Screen
	title="Game Mode"
	side="panel"
	prompts={[
		{ key: 'Enter', pad: 'pad:south', label: row.id === 'bench' ? 'Open' : 'Play', run: () => row.run() },
		...( row.id === 'sandbox' ? [ { key: [ 'ArrowLeft', 'ArrowRight' ], pad: 'pad:left', label: 'Course', run: () => course = courses[ ( courses.indexOf( course ) + 1 ) % courses.length ] } ] : [] ),
		{ key: 'Escape', pad: 'pad:east', label: ui.modeBack === 'pause' ? 'Back' : 'Close', run: back },
	]}
>
	{#each rows as r, i ( r.id )}
		<Row row={r} selected={i === selected} version={course} onhover={() => selected = i} />
	{/each}

	{#snippet about()}
		<div class="detail">
			<div class="still">
				{#if row.id === 'bench'}
					<svg viewBox="0 0 {STATIONS.length} 60" preserveAspectRatio="none">
						{#each families as f, i ( i )}
							{@const x = families.slice( 0, i ).reduce( ( sum, g ) => sum + g.count, 0 )}
							<rect x={x + 0.15} y="24" width={f.count - 0.3} height="12" fill={FAMILIES[ f.family ]} />
						{/each}
					</svg>
				{:else if plan}
					<svg viewBox={plan.viewBox} preserveAspectRatio="xMidYMid meet">
						{#each plan.shapes as s, i ( i )}
							{#if s.kind === 'polygon'}
								<polygon points={s.points} fill={s.fill} />
							{:else if s.kind === 'circle'}
								<circle cx={s.x} cy={s.y} r={s.r} fill={s.fill} />
							{:else if s.kind === 'line'}
								<polyline points={s.points} stroke={s.stroke} stroke-width={s.width} stroke-linecap="round" fill="none" />
							{:else if s.kind === 'spawn'}
								<circle cx={s.x} cy={s.y} r={s.r} fill="var(--accent)" stroke="#0b0d10" stroke-width="0.4" />
							{/if}
						{/each}
					</svg>
				{:else if shown === 'generated'}
					<span class="label">Generated from a seed</span>
				{/if}
			</div>

			{#if row.id === 'tutorial'}
				<h2>Tutorial</h2>
				<p>Learn every control in {lessons.length} short lessons on one path, from the first run to the zipline. Each lesson shows its keys and ticks off as you go.</p>
				<div class="progress"><div style:width="{done / lessons.length * 100}%"></div></div>
				<dl>
					<dt>Done</dt><dd>{done} of {lessons.length}</dd>
					<dt>Next</dt><dd>{done === lessons.length ? 'Into the Foundry' : next.name}</dd>
					<dt>Checkpoints</dt><dd>Every lesson</dd>
				</dl>
			{:else if row.id === 'sandbox'}
				<h2>{courseName( course )}</h2>
				<p>{course === 'generated' ? 'Built from the seed in Settings.' : blurb}</p>
				<dl>
					{#if course === 'generated'}
						<dt>Seed</dt><dd>{game.tools.params.seed}</dd>
					{:else if plan}
						<dt>Size</dt><dd>{plan.size}</dd>
						<dt>Highest</dt><dd>{plan.highest}</dd>
					{/if}
					<dt>Course</dt><dd>{course}</dd>
				</dl>
			{:else}
				<h2>Benchmark</h2>
				<p>The autopilot runs every station, one move each, on either engine and in either view. Pause where a move looks wrong and leave a comment: it keeps the moment, the engine and the view, so the fix can find it again.</p>
				<dl>
					<dt>Stations</dt><dd>{STATIONS.length} in {new Set( STATIONS.map( ( s ) => s.family ) ).size} families</dd>
					{#if comments !== null}<dt>Comments</dt><dd>{comments} open</dd>{/if}
					<dt>Engines</dt><dd>box3d · Rapier</dd>
					<dt>Views</dt><dd>Third · First</dd>
				</dl>
			{/if}
		</div>
	{/snippet}
</Screen>

{#if loading}<Loading text={loading} />{/if}

<style>
	.detail {
		background: var(--panel);
		padding: 1em;
		max-width: 30em;
	}

	.still {
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		background: rgba(255, 255, 255, 0.05);
		margin-bottom: 0.9em;
		overflow: hidden;
	}

	.still svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.label {
		font-size: 0.78em;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h2 {
		margin: 0 0 0.4em;
		font-size: 1.35em;
		font-weight: 700;
		line-height: 1.2;
	}

	p {
		margin: 0 0 0.9em;
		color: var(--muted);
		font-weight: 500;
	}

	.progress {
		margin: 0.2em 0 0.9em;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.35em 1.2em;
		margin: 0;
		font-size: 0.92em;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		text-align: right;
	}
</style>
