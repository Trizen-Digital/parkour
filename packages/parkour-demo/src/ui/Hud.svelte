<!-- The HUD in play: the tutorial's lesson card, the jump's charge, Easy mode, slow motion, the prompts (the touch
	controls have their own: src/ui/TouchControls.svelte), and what the HUD settings turn on (the frame rate, the
	runner's state, the validator's list). H hides it. -->
<script>
	import { getContext } from 'svelte';
	import Binding from './Binding.svelte';
	import Prompts from './Prompts.svelte';
	import { bindingOf } from './controls.js';
	import { ui } from './state.svelte.js';

	const { player, qa } = getContext( 'app' );
	const hud = ui.hud;

	// A binding as the device in use shows it: the touch control on touch, else the pad's or the keys (the keys where
	// the pad has none).
	const tokens = ( action ) => {

		const binding = bindingOf( action );
		if ( ui.device === 'touch' && binding.touch.length ) return binding.touch;
		return ui.device === 'pad' && binding.pad.length ? binding.pad : binding.keys;

	};
</script>

{#snippet phrase( parts )}{#each parts as part, i ( i )}{#if typeof part === 'string'}{part}{:else}<Binding tokens={tokens( part.a )} />{/if}{/each}{/snippet}

<div class="hud" class:hidden={hud.hidden || ui.screen}>
	<div class="corner">
		{#if ui.lesson}
			{@const lesson = ui.lesson}
			{@const words = ( ui.device === 'touch' && lesson.touch ) || lesson}
			<div class="lesson" class:done={lesson.state === 'done'}>
				<h2>{lesson.name}</h2>
				<p class="say">{@render phrase( words.say ?? lesson.say )}</p>
				{#if words.also ?? lesson.also}<p class="also">{@render phrase( words.also ?? lesson.also )}</p>{/if}
				<ul>
					{#each lesson.tasks as task, i ( i )}
						<li class:done={task.done}><span class="box">{task.done ? '✓' : ''}</span>{task.text}</li>
					{/each}
				</ul>
				{#if lesson.state === 'stuck' && ! hud.easy}<p class="tip">{@render phrase( [ 'Stuck? ', { a: 'easyMode' }, ' turns on Easy mode, which shows you the way.' ] )}</p>{/if}
			</div>
		{/if}
		{#if hud.easy}<span class="easy">Easy</span>{/if}
	</div>
	<!-- Top right, clear of the touch controls' menu button. Slow motion is easy to slip into (a right click toggles it),
		so it says so, and how to leave it, wherever the run is. -->
	<div class="top-right" class:touch={ui.device === 'touch'}>
		{#if hud.slow}
			<div class="slow">
				<span class="name">Slow motion</span>
				<!-- The touch controls have no slow motion button: only a mouse or a pad gets into it, and that device shows its
					own glyphs once used. -->
				{#if ! hud.slowHeld && ui.device !== 'touch'}<span class="off"><Binding tokens={tokens( 'slowMotion' )} /> turns it off</span>{/if}
			</div>
		{/if}
		{#if ui.options.fps}<span class="fps mono">{hud.fps}</span>{/if}
	</div>
	{#if ui.options.debug}<pre class="debug mono">{hud.debug}</pre>{/if}
	{#if ui.report !== null}<pre class="report mono">{ui.report}</pre>{/if}
	{#if ( ui.options.jumpMeter || ui.lesson?.meter ) && hud.charge > 0}<div class="charge" class:full={hud.full}><i style:width="{hud.charge * 100}%"></i></div>{/if}
	<div class="prompts" class:hidden={ui.device === 'touch'}>
		<Prompts prompts={[
			...( hud.captured ? [] : [ { key: 'Mouse0', label: 'Look', run: () => player.sim?.input.capture() } ] ),
			{ key: 'Backspace', pad: 'pad:select', label: 'Restart', run: () => player.restart() },
			{ key: 'Escape', pad: 'pad:start', label: 'Menu', run: () => qa.openMenu() },
		]} />
	</div>
</div>

{#if ui.armed && ! ui.screen}<div class="armed">{ui.armed}</div>{/if}

<div class="toasts">
	{#each ui.toasts as t ( t.id )}<div class="toast {t.kind}">{t.text}</div>{/each}
</div>

<style>
	.hud {
		position: fixed;
		inset: 0;
		font-size: var(--u);
		pointer-events: none;
	}

	.hud.hidden {
		display: none;
	}

	.corner {
		position: absolute;
		left: 1.6em;
		top: 1.4em;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6em;
	}

	.lesson {
		width: 27em;
		max-width: calc(100vw - 3.2em);
		padding: 0.9em 1.05em 1em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		box-shadow: inset 3px 0 0 var(--accent);
		font-weight: 600;
		line-height: 1.4;
		animation: in 160ms ease-out;
	}

	.lesson.done {
		box-shadow: inset 3px 0 0 var(--good);
	}

	.lesson h2 {
		margin: 0 0 0.35em;
		font-size: 1.5em;
		font-weight: 700;
		line-height: 1.1;
	}

	.lesson p {
		margin: 0 0 0.7em;
	}

	.lesson .also {
		margin-top: -0.3em;
		color: var(--muted);
		font-size: 0.92em;
	}

	.lesson ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.35em;
		font-size: 0.92em;
	}

	.lesson li {
		display: flex;
		align-items: center;
		gap: 0.55em;
		color: var(--muted);
	}

	.lesson li.done {
		color: var(--text);
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.2em;
		height: 1.2em;
		flex: none;
		border-radius: 50%;
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
		font-size: 0.85em;
		font-weight: 700;
	}

	li.done .box {
		background: var(--good);
		box-shadow: none;
		color: #0b0d10;
	}

	.lesson .tip {
		margin: 0.8em 0 0;
		padding-top: 0.7em;
		border-top: 1px solid var(--line);
		color: var(--warn);
		font-size: 0.92em;
	}

	/* A short screen (a phone held sideways, 540 px tall or less): the card smaller, wider than it is tall, and closer
	   to the corner, so the run stays in view. */
	@media (max-height: 540px) and (orientation: landscape) {
		.corner {
			left: 0.9em;
			top: 0.8em;
			gap: 0.4em;
		}

		.lesson {
			width: 26em;
			padding: 0.5em 0.75em 0.6em;
			font-size: 0.8em;
			line-height: 1.3;
		}

		.lesson h2 {
			margin-bottom: 0.25em;
			font-size: 1.25em;
		}

		.lesson p {
			margin-bottom: 0.45em;
		}

		.lesson ul {
			gap: 0.2em;
		}
	}

	.easy {
		padding: 0.3em 0.65em;
		background: var(--good);
		color: #0b0d10;
		font-weight: 700;
		font-size: 0.85em;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.top-right {
		position: absolute;
		right: 1.6em;
		top: 1.4em;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5em;
	}

	/* On touch the menu button holds the corner (src/ui/TouchControls.svelte: 42 px, max(16px, 2.5vw) in): this sits
	   beside it. */
	.top-right.touch {
		right: calc(max(16px, 2.5vw) + 42px + 10px);
		top: calc(max(12px, 3vh) + 6px);
	}

	.slow {
		display: flex;
		align-items: center;
		gap: 0.8em;
		min-height: 2.2em;
		padding: 0.35em 0.8em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		box-shadow: inset -3px 0 0 var(--accent);
		font-weight: 600;
		animation: in 160ms ease-out;
	}

	.slow .name {
		font-size: 0.85em;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.slow .off {
		color: var(--muted);
		font-size: 0.92em;
	}

	.fps {
		font-size: 0.75em;
		color: var(--muted);
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
	}

	pre {
		margin: 0;
		padding: 0.8em 1em;
		background: rgba(10, 12, 16, 0.7);
		font-size: 0.68em;
		line-height: 1.55;
	}

	.debug {
		position: absolute;
		left: 1.6em;
		bottom: 1.4em;
		min-width: 22em;
	}

	.report {
		position: absolute;
		left: 1.6em;
		top: 4em;
		max-width: 46vw;
		max-height: 48vh;
		overflow: auto;
		pointer-events: auto;
		user-select: text;
	}

	.charge {
		position: absolute;
		left: 50%;
		bottom: 3.2em;
		width: 12em;
		height: 0.35em;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.45);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
	}

	.charge i {
		display: block;
		height: 100%;
		background: var(--text);
	}

	.charge.full i {
		background: var(--accent);
	}

	.prompts {
		position: absolute;
		right: 1.6em;
		bottom: 1.4em;
		opacity: 0.8;
		font-size: 0.85em;
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
	}

	.prompts.hidden {
		display: none;
	}

	.armed {
		position: fixed;
		left: 50%;
		top: 2.2em;
		transform: translateX(-50%);
		padding: 0.6em 1.2em;
		background: var(--panel);
		font-size: var(--u);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		animation: pulse 1.6s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.6;
		}
	}

	.toasts {
		position: fixed;
		left: 50%;
		top: 5em;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4em;
		font-size: var(--u);
		z-index: 30;
	}

	.toast {
		max-width: min(40em, calc(100vw - 32px));
		padding: 0.55em 1em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		font-weight: 600;
		box-shadow: inset 3px 0 0 var(--text);
		animation: in 160ms ease-out;
	}

	.toast.good {
		box-shadow: inset 3px 0 0 var(--good);
	}

	.toast.warn {
		box-shadow: inset 3px 0 0 var(--warn);
	}

	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
</style>
