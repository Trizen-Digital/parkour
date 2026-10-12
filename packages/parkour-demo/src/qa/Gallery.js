// The replay library: every saved replay, a tab per category (the inbox holds the unfiled). Filing, sharing,
// promoting and deleting replays and adding, renaming, describing and deleting categories go through the QA store; a
// shared .qa.zip opened here joins the library. src/ui/Replays.svelte shows it from `view`.

import { store } from './store.js';
import { openSharedReplay, shareReplay } from './share.js';
import { reactive, snapshot, toast } from '../ui/state.svelte.js';

class Gallery {

	/**
	 * @param {QA} qa
	 */
	constructor( qa ) {

		this.qa = qa;
		this.view = reactive( {
			loading: false,
			error: '',
			replays: [],
			categories: [],
			/** The category on show: its id, or '' for the inbox. */
			tab: '',
			filter: '',
		} );

	}

	/** Shows the library, loading the index from the store. */
	async open() {

		const view = this.view;
		view.loading = true;
		view.error = '';
		try {

			const [ index ] = await Promise.all( [ store.index(), this.qa.loadCategories() ] );
			this.qa.categories = index.categories;
			view.replays = index.replays;
			view.categories = index.categories;
			if ( view.tab && ! index.categories.some( ( category ) => category.id === view.tab ) ) view.tab = '';

		} catch ( error ) {

			view.error = error.message;

		} finally {

			view.loading = false;

		}

	}

	close() {}

	/**
	 * The replays in a tab that match the search: every word somewhere in the id, title, course, description, notes or
	 * moves. A replay whose category no longer exists is in the inbox.
	 * @param {string} tab a category's id, or '' for the inbox
	 * @returns {object[]}
	 */
	listed( tab ) {

		const view = this.view, known = new Set( view.categories.map( ( category ) => category.id ) ), words = view.filter.trim().toLowerCase().split( /\s+/ ).filter( Boolean );
		return view.replays.filter( ( replay ) => {

			if ( tab ? replay.category !== tab : known.has( replay.category ) ) return false;
			const text = [ replay.id, replay.title, replay.course, replay.description, ...( replay.notes ?? [] ).map( ( note ) => note.text ), ...( replay.moves ?? [] ) ].join( ' ' ).toLowerCase();
			return words.every( ( word ) => text.includes( word ) );

		} );

	}

	/**
	 * Files a replay under a category (null: the inbox), at once in the list, then in the store.
	 * @param {string} id
	 * @param {string|null} category
	 */
	async file( id, category ) {

		const replay = this.view.replays.find( ( r ) => r.id === id );
		if ( ! replay || ( replay.category ?? null ) === category ) return;
		const before = replay.category;
		replay.category = category;
		try {

			await store.patch( id, { category, updated: new Date().toISOString() } );

		} catch ( error ) {

			replay.category = before;
			toast( error.message, 'warn' );

		}

	}

	async share( replay ) {

		try {

			const { fileName, opened } = await shareReplay( replay.id );
			toast( opened ? `Attach ${fileName} to the new issue` : `Pop-up blocked · attach ${fileName} to a new issue`, opened ? 'good' : 'warn' );

		} catch ( error ) {

			toast( error.message, 'warn' );

		}

	}

	async promote( replay ) {

		try {

			await store.promote( replay.id );
			replay.place = 'curated';
			toast( 'Promoted to qa/replays/', 'good' );

		} catch ( error ) {

			toast( error.message, 'warn' );

		}

	}

	async openShared( file ) {

		try {

			const rec = await openSharedReplay( file );
			toast( `Opened ${rec.title || rec.id}`, 'good' );
			await this.open();

		} catch ( error ) {

			toast( error.message, 'warn' );

		}

	}

	async remove( replay ) {

		if ( ! confirm( `Delete "${replay.title || replay.id}"?` ) ) return false;
		try {

			await store.remove( replay.id );
			this.view.replays = this.view.replays.filter( ( r ) => r.id !== replay.id );
			return true;

		} catch ( error ) {

			toast( error.message, 'warn' );
			return false;

		}

	}

	// The categories as the view has them, saved.
	async saveCategories() {

		this.qa.categories = snapshot( this.view.categories );
		try {

			await this.qa.saveCategories();

		} catch ( error ) {

			toast( error.message, 'warn' );

		}

	}

	/** @returns {Promise<object>} a new category, shown */
	async addCategory() {

		this.qa.categories = snapshot( this.view.categories );
		const category = this.qa.newCategory( 'New Category' );
		this.view.categories.push( category );
		this.view.tab = category.id;
		await this.saveCategories();
		return category;

	}

	async editCategory( id, change ) {

		const category = this.view.categories.find( ( c ) => c.id === id );
		if ( ! category ) return;
		Object.assign( category, change );
		await this.saveCategories();

	}

	async deleteCategory( id ) {

		const view = this.view, category = view.categories.find( ( c ) => c.id === id );
		if ( ! category ) return;
		const filed = view.replays.filter( ( replay ) => replay.category === id );
		if ( ! confirm( `Delete the category "${category.name}"?` ) ) return;
		view.categories = view.categories.filter( ( c ) => c.id !== id );
		view.tab = '';
		for ( const replay of filed ) replay.category = null;
		await this.saveCategories();
		for ( const replay of filed ) await store.patch( replay.id, { category: null } ).catch( ( error ) => toast( error.message, 'warn' ) );

	}

}

export { Gallery };
