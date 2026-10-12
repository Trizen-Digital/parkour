<!-- The touch controls in play: a stick under the left thumb wherever it lands, the view dragged by the right, and the
	buttons for what Easy mode leaves to the player, round Jump. src/touch/TouchInput.js turns them into the run's raw
	input. Use shows only where Interact would work something (Kick, Turn, Press). Shown while touch is the device in
	use (src/ui/nav.js) and no screen covers the game. -->
<script>
	import { getContext } from 'svelte';
	import { TOUCH_NAMES } from './glyphs.js';
	import { ui } from './state.svelte.js';

	const { player, qa } = getContext( 'app' );
	const touch = player.touch;

	// A touch landing left of this share of the screen's width takes the stick; right of it, the view.
	const STICK_SIDE = 0.4;

	// The buttons round Jump: each at a turn (degrees anticlockwise from the left) and a distance (in Jump's widths)
	// from Jump's centre. The ones used most sit nearest the thumb; the tricks make an outer ring.
	const BUTTONS = [
		{ action: 'grab', size: 'mid', turn: 0, out: 1.12 },
		{ action: 'slide', size: 'mid', turn: 47, out: 1.12 },
		{ action: 'dive', size: 'mid', turn: 92, out: 1.12 },
		{ action: 'flip', size: 'small', turn: 14, out: 2.02 },
		{ action: 'wheel', size: 'small', turn: 45, out: 2.02 },
		{ action: 'backflip', size: 'small', turn: 76, out: 2.02 },
	];

	const shown = $derived( ui.device === 'touch' && ! ui.screen );

	// The stick as drawn: where its base is (px from the top left) while a thumb is on it, the knob's push (px), and
	// whether it sprints. At rest it has no thumb on it.
	const REST = { held: false, x: 0, y: 0, dx: 0, dy: 0, sprint: false };
	let stick = $state( { ...REST } );
	// The actions held, for drawing them pressed.
	let held = $state( {} );
	// The screen's size, which sets the stick's reach.
	let width = $state( innerWidth ), height = $state( innerHeight );
	const reach = $derived( Math.min( 70, Math.max( 46, 0.13 * Math.min( width, height ) ) ) );

	// Each pointer down on the controls, by id: what it holds ('stick', 'look', 'menu' or a button's action) and where it
	// last was.
	const pointers = new Map();

	function holding( action ) {

		return [ ...pointers.values() ].some( ( p ) => p.what === action );

	}

	function pressButton( event, action ) {

		event.preventDefault();
		event.stopPropagation();
		pointers.set( event.pointerId, { what: action } );
		if ( action === 'menu' ) return;
		touch.press( action );
		held[ action ] = true;

	}

	// A touch on the screen itself: the stick on the left, the view on the right, one thumb each.
	function down( event ) {

		event.preventDefault();
		const what = event.clientX < width * STICK_SIDE ? 'stick' : 'look';
		if ( holding( what ) ) return;
		pointers.set( event.pointerId, { what, x: event.clientX, y: event.clientY } );
		if ( what === 'look' ) touch.looking = true;
		else moveStick( pointers.get( event.pointerId ), event );

	}

	function move( event ) {

		const p = pointers.get( event.pointerId );
		if ( p?.what === 'look' ) {

			touch.look( event.clientX - p.x, event.clientY - p.y );
			p.x = event.clientX;
			p.y = event.clientY;

		} else if ( p?.what === 'stick' ) {

			moveStick( p, event );

		}

	}

	// The stick pushed from where the thumb landed. Past its reach the base follows the thumb, so the stick turns back
	// from where the thumb is, not from where it landed.
	function moveStick( p, event ) {

		let dx = event.clientX - p.x, dy = event.clientY - p.y;
		const length = Math.hypot( dx, dy );
		if ( length > reach ) {

			const over = 1 - reach / length;
			p.x += dx * over;
			p.y += dy * over;
			dx -= dx * over;
			dy -= dy * over;

		}

		touch.setStick( dx / reach, dy / reach );
		stick = { held: true, x: p.x, y: p.y, dx, dy, sprint: touch.sprint };

	}

	function up( event ) {

		const p = pointers.get( event.pointerId );
		if ( ! p ) return;
		pointers.delete( event.pointerId );
		if ( p.what === 'menu' ) {

			if ( event.type === 'pointerup' ) qa.openMenu();

		} else if ( p.what === 'stick' ) {

			touch.releaseStick();
			stick = { ...REST };

		} else if ( p.what === 'look' ) {

			touch.looking = false;

		} else if ( ! holding( p.what ) ) {

			touch.release( p.what );
			held[ p.what ] = false;

		}

	}

	// Hidden (a screen opened, another device in use), they let go of everything. This only writes the stick and the
	// buttons: an effect that read them too would run itself again on every write.
	$effect( () => {

		if ( shown ) return;
		pointers.clear();
		touch.releaseAll();
		held = {};
		stick = { ...REST };

	} );

	// Moves and lifts are followed on the window, so a button whose element hides under the thumb (Use, once its door
	// or switch is worked) still lets go.
	$effect( () => {

		const resize = () => {

			width = innerWidth;
			height = innerHeight;

		};

		addEventListener( 'pointermove', move );
		addEventListener( 'pointerup', up );
		addEventListener( 'pointercancel', up );
		addEventListener( 'resize', resize );
		return () => {

			removeEventListener( 'pointermove', move );
			removeEventListener( 'pointerup', up );
			removeEventListener( 'pointercancel', up );
			removeEventListener( 'resize', resize );

		};

	} );

	// The browser's own touch gestures (scrolling, zooming, the long press's menu) and the mouse events it makes up
	// from a tap stay off the controls: a tap here never reaches a menu that opens under it.
	function quiet( node ) {

		const stop = ( event ) => event.cancelable && event.preventDefault();
		for ( const type of [ 'touchstart', 'touchmove', 'touchend', 'contextmenu' ] ) node.addEventListener( type, stop, { passive: false } );
		return () => {

			for ( const type of [ 'touchstart', 'touchmove', 'touchend', 'contextmenu' ] ) node.removeEventListener( type, stop );

		};

	}
</script>

{#if shown}
	<div class="touch" style:--reach="{reach}px" onpointerdown={down} role="presentation" {@attach quiet}>
		<div
			class="stick"
			class:held={stick.held}
			class:sprint={stick.sprint}
			style:left={stick.held ? `${stick.x}px` : null}
			style:top={stick.held ? `${stick.y}px` : null}
		>
			<i class="knob" style:transform="translate({stick.held ? stick.dx : 0}px, {stick.held ? stick.dy : 0}px)"></i>
			<span class="sprint-label">Sprint</span>
		</div>

		<button type="button" class="menu" aria-label="Menu" onpointerdown={( e ) => pressButton( e, 'menu' )} tabindex="-1">
			<svg viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="1" width="3.4" height="12" rx="1" /><rect x="7.6" y="1" width="3.4" height="12" rx="1" /></svg>
		</button>

		<div class="cluster">
			{#each BUTTONS as b ( b.action )}
				<button
					type="button"
					class="button {b.size}"
					class:on={held[ b.action ]}
					style:--turn="{b.turn}deg"
					style:--out={b.out}
					onpointerdown={( e ) => pressButton( e, b.action )}
					tabindex="-1"
				>{TOUCH_NAMES[ b.action ]}</button>
			{/each}
			<button type="button" class="button use" class:shown={ui.hud.use} class:on={held.interact} onpointerdown={( e ) => pressButton( e, 'interact' )} tabindex="-1">{ui.hud.use || TOUCH_NAMES.interact}</button>
			<button type="button" class="button jump" class:on={held.jump} onpointerdown={( e ) => pressButton( e, 'jump' )} tabindex="-1">{TOUCH_NAMES.jump}</button>
		</div>
	</div>
{/if}

<style>
	.touch {
		/* Jump's width, which the cluster is laid out in. */
		--jump: clamp(68px, 18vmin, 92px);
		position: fixed;
		inset: 0;
		pointer-events: auto;
		touch-action: none;
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}

	/* The stick: resting at the bottom left until a thumb lands, then under it. */
	.stick {
		position: absolute;
		left: calc(max(28px, 6vw) + var(--reach));
		top: calc(100% - max(24px, 6vh) - var(--reach));
		width: calc(2 * var(--reach));
		height: calc(2 * var(--reach));
		margin: calc(-1 * var(--reach)) 0 0 calc(-1 * var(--reach));
		border-radius: 50%;
		background: rgba(12, 14, 18, 0.22);
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.28);
		opacity: 0.55;
		pointer-events: none;
		transition: opacity 120ms ease, box-shadow 120ms ease;
	}

	.stick.held {
		opacity: 1;
	}

	.stick.sprint {
		box-shadow: inset 0 0 0 2px var(--accent), 0 0 18px rgba(244, 124, 52, 0.35);
	}

	.knob {
		position: absolute;
		left: 50%;
		top: 50%;
		width: calc(0.92 * var(--reach));
		height: calc(0.92 * var(--reach));
		margin: calc(-0.46 * var(--reach)) 0 0 calc(-0.46 * var(--reach));
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.75);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.stick.sprint .knob {
		background: rgba(244, 124, 52, 0.45);
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	/* In the middle of the ring, which the knob has left for its edge. */
	.sprint-label {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		font: 700 11px/1 var(--font);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text);
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.stick.sprint .sprint-label {
		opacity: 1;
	}

	button {
		appearance: none;
		border: 0;
		padding: 0;
		margin: 0;
		font: 700 12px/1 var(--font);
		color: var(--text);
		touch-action: none;
		cursor: pointer;
	}

	.menu {
		position: absolute;
		right: max(16px, 2.5vw);
		top: max(12px, 3vh);
		display: grid;
		place-items: center;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		background: rgba(12, 14, 18, 0.4);
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.menu svg {
		width: 12px;
		height: 14px;
		fill: currentColor;
	}

	/* Jump in the bottom right corner, the rest placed round its centre. */
	.cluster {
		position: absolute;
		right: calc(max(18px, 3vw) + var(--jump) / 2);
		bottom: calc(max(16px, 4vh) + var(--jump) / 2);
		width: 0;
		height: 0;
	}

	.button {
		--size: var(--jump);
		position: absolute;
		left: 0;
		top: 0;
		display: grid;
		place-items: center;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: rgba(12, 14, 18, 0.38);
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-align: center;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
		transform: translate(-50%, -50%) translate(calc(-1 * cos(var(--turn, 0deg)) * var(--out, 0) * var(--jump)), calc(-1 * sin(var(--turn, 0deg)) * var(--out, 0) * var(--jump)));
		transition: background-color 60ms ease, scale 60ms ease;
	}

	.button.on {
		background: rgba(244, 124, 52, 0.85);
		box-shadow: inset 0 0 0 2px var(--accent);
		scale: 0.94;
	}

	.jump {
		font-size: 15px;
		box-shadow: inset 0 0 0 2.5px rgba(255, 255, 255, 0.75);
	}

	.mid {
		--size: calc(0.74 * var(--jump));
	}

	.small {
		--size: calc(0.62 * var(--jump));
		padding: 0 4px;
		font-size: 10.5px;
		line-height: 1.05;
		background: rgba(12, 14, 18, 0.3);
		box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.42);
	}

	/* Use, over Dive above Jump, only where Interact would work something. */
	.use {
		--size: calc(0.74 * var(--jump));
		--turn: 90deg;
		--out: 2.95;
		font-size: 12px;
		background: rgba(244, 124, 52, 0.75);
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.8);
		opacity: 0;
		visibility: hidden;
		scale: 0.8;
		transition: opacity 140ms ease, scale 140ms ease, visibility 0s 140ms;
	}

	.use.shown {
		opacity: 1;
		visibility: visible;
		scale: 1;
		transition: opacity 140ms ease, scale 140ms ease, visibility 0s;
	}

	.use.on {
		background: var(--accent);
		scale: 0.94;
	}
</style>
