<!-- The benchmark (src/bench/Bench.js) over its run: the engine, view and station along the top, the comments on the
	right, the keys the autopilot holds, the transport and the two timelines along the bottom. -->
<script>
	import { getContext } from 'svelte';
	import Loading from './Loading.svelte';
	import Prompts from './Prompts.svelte';
	import { place } from './place.js';

	const { qa } = getContext( 'app' );
	const bench = qa.bench, display = bench.display;

	const ENGINE_NAMES = { box3d: 'box3d', rapier: 'Rapier', both: 'Both' };
	const VIEW_NAMES = { third: 'Third', first: 'First', both: 'Both' };
	let draftText = $state( '' );

	function focus( node ) {

		draftText = '';
		node.focus();

	}
</script>

{#if display.open}
	<div class="bench" class:busy={display.busy}>
		<header class="top">
			<h1>Benchmark</h1>
			<div class="seg">
				{#each bench.engines as engine ( engine )}<button type="button" class:on={display.engine === engine} onclick={() => bench.switchEngine( engine )}>{ENGINE_NAMES[ engine ]}</button>{/each}
			</div>
			<div class="seg">
				{#each bench.views as view ( view )}<button type="button" class:on={display.view === view} onclick={() => bench.switchView( view )}>{VIEW_NAMES[ view ]}</button>{/each}
			</div>
			{#if display.families.length}
				<select class="stations" value={display.station} onchange={( e ) => bench.goToStation( Number( e.target.value ) )} title="Station">
					{#each display.families as group ( group.family )}
						<optgroup label={group.family}>
							{#each group.stations as station ( station.index )}<option value={station.index}>{station.index + 1}. {station.name}</option>{/each}
						</optgroup>
					{/each}
				</select>
			{/if}
			<span class="status mono" class:warn={display.status.warn} title={display.status.title}>{display.status.text}</span>
			<span class="spacer"></span>
			<button type="button" class="btn" class:on={display.free} onclick={() => bench.setFree( ! display.free )}>Free Camera</button>
			<button type="button" class="btn" onclick={() => bench.close()}>Back</button>
		</header>

		<aside class="side">
			<header>
				<h2 class="label">Comments <span>{display.count}</span></h2>
				<div class="seg small">
					<button type="button" class:on={display.filter === 'all'} onclick={() => bench.setFilter( 'all' )}>All</button>
					<button type="button" class:on={display.filter === 'view'} onclick={() => bench.setFilter( 'view' )}>This View</button>
				</div>
			</header>

			{#if display.draft}
				<div class="draft">
					<div class="where mono">{display.draft.where}</div>
					<div class="pair">
						<button type="button" class="btn" onclick={() => bench.act( 'from' )}>Set Start</button>
						<button type="button" class="btn" onclick={() => bench.act( 'to' )}>Set End</button>
					</div>
					<div class="pair">
						<span class="label">View</span>
						<div class="seg small">
							{#each [ 'third', 'first', 'both' ] as view ( view )}<button type="button" class:on={display.draft.view === view} onclick={() => bench.editDraft( { view } )}>{VIEW_NAMES[ view ]}</button>{/each}
						</div>
					</div>
					<div class="pair">
						<span class="label">Engine</span>
						<div class="seg small">
							{#each display.draft.engines as engine ( engine )}<button type="button" class:on={display.draft.engine === engine} onclick={() => bench.editDraft( { engine } )}>{ENGINE_NAMES[ engine ]}</button>{/each}
						</div>
					</div>
					<textarea
						class="field"
						rows="3"
						placeholder="Comment"
						bind:value={draftText}
						use:focus
						oninput={() => bench.setDraftText( draftText )}
						onkeydown={( e ) => {

							if ( e.key === 'Enter' && ! e.shiftKey ) {

								e.preventDefault();
								bench.saveDraft();

							}

						}}
					></textarea>
					<div class="pair end">
						<button type="button" class="btn" onclick={() => bench.endDraft()}>Cancel</button>
						<button type="button" class="btn primary" onclick={() => bench.saveDraft()}>Save</button>
					</div>
				</div>
			{/if}

			<ol class="comments">
				{#each display.comments as comment ( comment.id )}
					<li class:on={comment.selected} class:done={comment.done} style:--view={comment.color}>
						<button type="button" class="go" onclick={() => bench.goToComment( comment.id )}>
							<span class="mono">{comment.when}</span>
							<span class="badge">{comment.view}</span>
							<span class="badge">{comment.engine}</span>
						</button>
						<button type="button" class="tool" onclick={() => bench.toggleDone( comment.id )} title={comment.done ? 'Reopen' : 'Done'}>{comment.done ? '↺' : '✓'}</button>
						<button type="button" class="tool" onclick={() => bench.removeComment( comment.id )} title="Delete">✕</button>
						<div class="station">{comment.station}</div>
						<div class="text" contenteditable="plaintext-only" spellcheck="true" role="textbox" tabindex="0" onblur={( e ) => bench.editComment( comment.id, { text: e.currentTarget.textContent.trim() } )}>{comment.text}</div>
					</li>
				{/each}
			</ol>
			{#if ! display.comments.length && ! display.draft}<p class="empty">No comments</p>{/if}
		</aside>

		<div class="keys">
			{#each display.keys as key ( key.code )}<kbd class:on={key.on} class:hit={key.hit}>{key.label}</kbd>{/each}
			{#if display.mouse}<span class="mouse">{display.mouse}</span>{/if}
		</div>

		<section class="bar">
			<div class="controls">
				<button type="button" class="btn icon" onclick={() => bench.act( 'station-back' )} title="Previous station ([)">⏮</button>
				<button type="button" class="btn icon" onclick={() => bench.act( 'back' )} title="Back 5 s (←)">«</button>
				<button type="button" class="btn icon" onclick={() => bench.toggle()} title="Play (Space)">
					{#if display.playing}<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" /></svg>{:else}<svg viewBox="0 0 12 12"><path d="M2.5 1 L11 6 L2.5 11 Z" /></svg>{/if}
				</button>
				<button type="button" class="btn icon" onclick={() => bench.act( 'on' )} title="On 5 s (→)">»</button>
				<button type="button" class="btn icon" onclick={() => bench.act( 'station-on' )} title="Next station (])">⏭</button>
				<div class="seg">
					{#each bench.speeds as speed ( speed )}<button type="button" class:on={display.speed === speed} onclick={() => bench.setSpeed( speed )}>{speed}×</button>{/each}
				</div>
				<span class="time mono">{display.time} <span>/ {display.total}</span></span>
				{#if display.where}
					<span class="where">
						<span class="mono">{display.where.number}/{display.where.count}</span>
						<b style:--family={display.where.color}>{display.where.name}</b>
						{#if display.where.result}<i class:fail={display.where.result !== 'pass'} title={display.where.reason}>{display.where.result}</i>{/if}
						<span class="mono runner">{display.runner}</span>
					</span>
				{/if}
				<span class="spacer"></span>
				<button type="button" class="btn primary" onclick={() => bench.startDraft()}>Comment</button>
			</div>
			<div class="canvas" use:place={bench.overview}></div>
			<div class="canvas" use:place={bench.detailCanvas}></div>
			<Prompts prompts={[
				{ key: 'Space', label: 'Play', run: () => bench.toggle() },
				{ key: [ 'ArrowLeft', 'ArrowRight' ], label: '5 s' },
				{ key: [ 'Comma', 'Period' ], label: 'Frame' },
				{ key: [ 'BracketLeft', 'BracketRight' ], label: 'Station' },
				{ key: 'KeyC', label: 'View' },
				{ key: 'KeyN', label: 'Comment', run: () => bench.startDraft() },
				{ key: 'Escape', label: 'Back', run: () => bench.close() },
			]} />
		</section>
	</div>
{/if}

{#if display.loading}<Loading text={display.loading.text} progress={display.loading.progress} />{/if}

<style>
	.bench {
		position: fixed;
		inset: 0;
		font-size: clamp(12px, 0.8vw, 15px);
		pointer-events: none;
	}

	.bench > * {
		pointer-events: auto;
	}

	.bench.busy > * {
		pointer-events: none;
		opacity: 0.6;
	}

	.top {
		position: absolute;
		left: 1.6em;
		right: 1.6em;
		top: 1.4em;
		display: flex;
		align-items: center;
		gap: 0.7em;
		padding: 0.6em 0.8em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	h1 {
		margin: 0 0.6em 0 0.2em;
		font-size: 1.45em;
		font-weight: 700;
	}

	.stations {
		max-width: 22em;
		height: 2.1em;
		border: 0;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.08);
		color: var(--text);
		font: 600 1em/1 var(--font);
		padding: 0 0.6em;
		outline: none;
	}

	.status {
		margin-left: 0.4em;
		color: var(--muted);
	}

	.status.warn {
		color: var(--warn);
	}

	.spacer {
		flex: 1;
	}

	.side {
		position: absolute;
		right: 1.6em;
		top: 5.6em;
		bottom: 1.4em;
		width: 23em;
		display: flex;
		flex-direction: column;
		gap: 0.7em;
		padding: 1em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		overflow-y: auto;
	}

	.side header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
	}

	h2 span {
		color: var(--faint);
		margin-left: 0.3em;
	}

	.seg.small button {
		padding: 0.35em 0.6em;
		font-size: 0.92em;
	}

	.draft {
		display: flex;
		flex-direction: column;
		gap: 0.55em;
		padding: 0.8em;
		background: rgba(255, 255, 255, 0.05);
		box-shadow: inset 2px 0 0 var(--accent);
	}

	.where {
		color: var(--muted);
		font-size: 0.92em;
	}

	.pair {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5em;
	}

	.pair.end {
		justify-content: flex-end;
	}

	.comments {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4em;
	}

	.comments li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: 0.2em 0.4em;
		padding: 0.55em 0.6em 0.6em 0.75em;
		background: rgba(255, 255, 255, 0.05);
		box-shadow: inset 3px 0 0 var(--view);
	}

	.comments li.on {
		background: rgba(244, 124, 52, 0.16);
	}

	.comments li.done {
		opacity: 0.45;
	}

	.go {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 0.5em;
		border: 0;
		background: none;
		padding: 0;
		color: var(--text);
		font: 600 0.92em/1.2 var(--font);
		cursor: pointer;
		text-align: left;
	}

	.badge {
		padding: 0.1em 0.4em;
		background: rgba(255, 255, 255, 0.1);
		font-size: 0.85em;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.tool {
		appearance: none;
		border: 0;
		background: none;
		color: var(--faint);
		cursor: pointer;
		padding: 0.1em 0.3em;
	}

	.tool:hover {
		color: var(--text);
	}

	.station {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: 0.9em;
	}

	.text {
		grid-column: 1 / -1;
		outline: none;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.empty {
		margin: 0;
		color: var(--muted);
		font-weight: 600;
	}

	.keys {
		position: absolute;
		left: 1.6em;
		top: 5.6em;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3em;
		max-width: 34em;
		padding: 0.5em;
		background: var(--panel);
	}

	kbd {
		min-width: 1.8em;
		padding: 0.25em 0.4em;
		border-radius: 0.25em;
		background: rgba(255, 255, 255, 0.08);
		color: var(--faint);
		font: 700 0.85em/1 var(--font);
		text-align: center;
	}

	kbd.on {
		background: #f4f5f7;
		color: #15171b;
	}

	kbd.hit {
		background: var(--accent);
		color: var(--text);
	}

	.mouse {
		margin-left: 0.4em;
		color: var(--accent);
		font-weight: 700;
	}

	.bar {
		position: absolute;
		left: 1.6em;
		right: 26.2em;
		bottom: 1.4em;
		display: flex;
		flex-direction: column;
		gap: 0.55em;
		padding: 0.8em 1em 0.9em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.45em;
		min-width: 0;
	}

	.btn svg {
		width: 0.85em;
		height: 0.85em;
		fill: currentColor;
	}

	.time {
		margin-left: 0.5em;
		font-size: 1.05em;
		white-space: nowrap;
	}

	.time span {
		color: var(--muted);
	}

	.controls .where {
		display: flex;
		align-items: center;
		gap: 0.5em;
		margin-left: 0.6em;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: 1em;
		color: var(--text);
	}

	.controls .where b {
		box-shadow: inset 0 -2px 0 var(--family);
	}

	.controls .where i {
		font-style: normal;
		font-weight: 700;
		font-size: 0.85em;
		text-transform: uppercase;
		color: var(--good);
	}

	.controls .where i.fail {
		color: var(--bad);
	}

	.runner {
		color: var(--muted);
	}

	.canvas :global(canvas) {
		display: block;
		width: 100%;
		cursor: crosshair;
	}

	.bar :global(.prompts) {
		font-size: 0.92em;
	}
</style>
