// What a menu row does when it is stepped (left and right) or chosen (select or a click), for the rows
// src/ui/settings.js makes. Toggles and choices step without wrapping round, as the arrows show: a toggle's Off is
// at the left end and On at the right; choosing one steps it on, round to the start.

import { format } from './settings.js';

const shown = ( row, value ) => row.shown ? row.shown( value ) : value;

/** @returns {{value: *, label: string}[]} a toggle's or a choice's values in order */
function optionsOf( row ) {

	if ( row.kind === 'toggle' ) return [ { value: false, label: 'Off' }, { value: true, label: 'On' } ];
	return row.options.map( ( [ value, label ] ) => ( { value, label } ) );

}

/**
 * @param {object} row
 * @returns {string} the row's value as it shows
 */
function valueText( row ) {

	if ( row.kind === 'number' ) return format( shown( row, row.get() ), shown( row, row.step ) ) + ( row.unit ?? '' );
	if ( row.kind === 'action' ) return row.value?.() ?? '';
	if ( row.kind !== 'toggle' && row.kind !== 'choice' ) return '';
	const value = row.get();
	return optionsOf( row ).find( ( option ) => option.value === value )?.label ?? String( value );

}

/**
 * @param {object} row
 * @param {number} by -1 or 1
 * @returns {boolean} whether stepping that way changes the value
 */
function canStep( row, by ) {

	if ( row.kind === 'number' ) {

		const value = row.get();
		return by < 0 ? value > row.min : value < row.max;

	}

	if ( row.kind !== 'toggle' && row.kind !== 'choice' ) return false;
	const options = optionsOf( row ), i = options.findIndex( ( option ) => option.value === row.get() );
	return by < 0 ? i > 0 : i < options.length - 1;

}

/**
 * Sets a number from a fraction of its range, on its step.
 * @param {object} row
 * @param {number} fraction 0…1
 */
function setFraction( row, fraction ) {

	const min = shown( row, row.min ), max = shown( row, row.max ), step = shown( row, row.step );
	setShown( row, min + Math.round( Math.max( 0, Math.min( 1, fraction ) ) * ( max - min ) / step ) * step );

}

// Sets a number from its value as shown (degrees for an angle), kept inside its range.
function setShown( row, value ) {

	const min = shown( row, row.min ), max = shown( row, row.max );
	const clamped = Math.min( max, Math.max( min, + value.toFixed( 9 ) ) );
	const raw = Math.min( row.max, Math.max( row.min, row.unshown ? row.unshown( clamped ) : clamped ) );
	if ( raw !== row.get() ) return row.set( raw );

}

/** @returns {number} 0…1, where a number stands in its range */
function fractionOf( row ) {

	return ( row.get() - row.min ) / ( row.max - row.min );

}

/**
 * Steps a row's value; a number by its step (shift: ten steps).
 * @param {object} row
 * @param {number} by -1 or 1
 * @param {boolean} [shift]
 * @returns {*} what the row's set returned (a promise for a change that takes time)
 */
function stepRow( row, by, shift = false ) {

	if ( ! canStep( row, by ) ) return undefined;
	if ( row.kind === 'number' ) {

		const min = shown( row, row.min ), step = shown( row, row.step );
		const steps = Math.round( ( shown( row, row.get() ) - min ) / step ) + by * ( shift ? 10 : 1 );
		return setShown( row, min + steps * step );

	}

	const options = optionsOf( row ), i = options.findIndex( ( option ) => option.value === row.get() );
	return row.set( options[ i + by ].value );

}

/**
 * Chooses a row: a toggle flips, a choice steps on (round to its start), an action runs. A choice that has a `run`
 * runs it instead: its arrows pick, choosing goes (the Game Mode's Sandbox picks a course and plays it).
 * @param {object} row
 * @returns {*}
 */
function chooseRow( row ) {

	if ( row.kind === 'action' || row.run ) return row.run();
	if ( row.kind !== 'toggle' && row.kind !== 'choice' ) return undefined;
	const options = optionsOf( row ), i = options.findIndex( ( option ) => option.value === row.get() );
	return row.set( options[ ( i + 1 ) % options.length ].value );

}

/** @returns {boolean} whether the row takes the selection (headers do not) */
function selectable( row ) {

	return row.kind !== 'header';

}

export { valueText, canStep, stepRow, chooseRow, setFraction, fractionOf, selectable };
