<!-- A menu screen over the dimmed game: the title, the tabs between the bumpers, a list of rows, what the selected
	row is about beside it, and the prompts along the bottom with the build in the middle. -->
<script>
	import Glyph from './Glyph.svelte';
	import Prompts from './Prompts.svelte';
	import { ui } from './state.svelte.js';

	/**
	 * @type {{
	 *   title: string,
	 *   tabs?: {id: string, name: string}[],
	 *   tab?: string,
	 *   onTab?: (id: string) => void,
	 *   onDropTab?: (id: string, event: DragEvent) => void,
	 *   prompts?: object[],
	 *   side?: 'text'|'panel',
	 *   header?: import('svelte').Snippet,
	 *   children: import('svelte').Snippet,
	 *   about?: import('svelte').Snippet,
	 * }}
	 */
	let { title, tabs = null, tab = null, onTab = () => {}, onDropTab = null, prompts = [], side = 'text', header, children, about } = $props();

	// A tab takes what is dragged onto it when the screen says so (a replay dropped on a category files it).
	const over = ( event ) => onDropTab && event.preventDefault();

	const step = ( by ) => {

		const i = tabs.findIndex( ( t ) => t.id === tab );
		onTab( tabs[ ( i + by + tabs.length ) % tabs.length ].id );

	};

	// The tab on show is scrolled into sight: on a phone the tabs run wider than the screen.
	let nav = $state();
	$effect( () => {

		if ( tab !== null ) nav?.querySelector( '.on' )?.scrollIntoView( { block: 'nearest', inline: 'nearest' } );

	} );
</script>

<div class="screen" class:touch={ui.device === 'touch'}>
	<header>
		<h1>{title}</h1>
		{#if tabs}
			<nav class="tabs" bind:this={nav}>
				{#if ui.device !== 'touch'}<button type="button" class="bumper" onclick={() => step( - 1 )} tabindex="-1"><Glyph code={ui.device === 'pad' ? 'pad:l1' : 'KeyQ'} /></button>{/if}
				{#each tabs as t ( t.id )}
					<button
						type="button"
						class="tab"
						class:on={t.id === tab}
						onclick={() => onTab( t.id )}
						ondragover={over}
						ondrop={( event ) => onDropTab?.( t.id, event )}
						tabindex="-1"
					>{t.name}</button>
				{/each}
				{#if ui.device !== 'touch'}<button type="button" class="bumper" onclick={() => step( 1 )} tabindex="-1"><Glyph code={ui.device === 'pad' ? 'pad:r1' : 'KeyE'} /></button>{/if}
			</nav>
		{/if}
		{@render header?.()}
	</header>
	<main class:panel={side === 'panel'}>
		<section class="list">{@render children()}</section>
		<aside class="about">{@render about?.()}</aside>
	</main>
	<footer>
		<span class="build">{ui.build}</span>
		<Prompts {prompts} />
	</footer>
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		display: grid;
		/* One column, the screen's width: what is wider (the tabs on a phone) scrolls inside it rather than pushing
		   the rows and the prompts past the edge. */
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr) auto;
		padding: 3.4em 2.95em 2.4em;
		font-size: var(--u);
		background:
			linear-gradient(90deg, rgba(6, 8, 11, 0.86) 0%, rgba(6, 8, 11, 0.66) 58%, rgba(6, 8, 11, 0.5) 100%);
		backdrop-filter: blur(6px) saturate(0.85);
		-webkit-backdrop-filter: blur(6px) saturate(0.85);
		pointer-events: auto;
		animation: in 160ms ease-out;
	}

	@keyframes in {
		from {
			opacity: 0;
		}
	}

	h1 {
		margin: 0 0 0.95em;
		font-size: 2.3em;
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.005em;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: 1.55em;
		margin-bottom: 1.5em;
		font-size: 1.36em;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tabs button {
		appearance: none;
		border: 0;
		background: none;
		padding: 0;
		color: rgba(255, 255, 255, 0.6);
		font: 600 1em/1 var(--font);
		cursor: pointer;
		white-space: nowrap;
	}

	.tabs .tab {
		padding-bottom: 0.2em;
		border-bottom: 0.13em solid transparent;
	}

	.tabs .tab:hover,
	.tabs .tab.on {
		color: var(--text);
	}

	.tabs .tab.on {
		border-bottom-color: var(--accent);
	}

	/* A tab big enough to tap: 44 px, as phones advise. */
	.touch .tabs .tab {
		min-height: 44px;
	}

	.tabs .bumper {
		display: inline-flex;
		font-size: 0.74em;
	}

	.tabs .bumper:first-child {
		margin-right: 1.4em;
	}

	.tabs .bumper:last-child {
		margin-left: 1.4em;
	}

	main {
		display: grid;
		grid-template-columns: minmax(0, 53.9em) minmax(0, 1fr);
		gap: 7.4em;
		min-height: 0;
	}

	main.panel {
		gap: 3em;
	}

	.list {
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.4em;
		scrollbar-width: thin;
	}

	.about {
		min-height: 0;
		overflow-y: auto;
		font-size: 1em;
		font-weight: 600;
		line-height: 1.45;
		padding-top: 0.42em;
	}

	main.panel .about {
		padding-top: 0;
	}

	footer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: 2em;
		padding-top: 1.2em;
	}

	.build {
		text-align: center;
		font-size: 0.78em;
		color: var(--faint);
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	/* A narrow screen (a phone held upright): one column, the list first at its own height and what the selected row is
	   about under it, in what is left, scrolling. The list is what is used: it never gives its room to the about. */
	@media (max-width: 860px) {
		.screen {
			padding: 1.6em 1em 1.2em;
		}

		main {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, auto) minmax(0, 1fr);
			gap: 1em;
		}

		footer {
			grid-template-columns: 1fr;
		}

		.build {
			display: none;
		}
	}

	/* A short screen (a phone held sideways, 540 px tall or less): the list and its about side by side again, closer,
	   under a smaller title, each scrolling on its own. After the narrow screen's rules, which it takes over from. */
	@media (max-height: 540px) and (orientation: landscape) {
		.screen {
			padding: 0.9em 1.4em 0.8em;
		}

		h1 {
			margin-bottom: 0.45em;
			font-size: 1.6em;
		}

		.tabs {
			margin-bottom: 0.7em;
		}

		main,
		main.panel {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
			gap: 1.6em;
		}

		footer {
			grid-template-columns: 1fr;
			padding-top: 0.5em;
		}

		.build {
			display: none;
		}
	}
</style>
