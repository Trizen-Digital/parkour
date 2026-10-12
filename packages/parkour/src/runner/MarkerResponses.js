/**
 * What markers do to the runner. The moves and the graph fire markers as they play (Motion queues them); the runner
 * drains them at the start of its next step, so a marker fired during step n acts in step n + 1.
 */
class MarkerResponses {

	constructor( runner ) {

		this.runner = runner;

	}

	update() {

		for ( const marker of this.runner.motion.takeMarkers() ) this.handle( marker );

	}

	handle( name ) {

		const c = this.runner;

		switch ( name ) {

			// Footfalls on the ground say which foot leads (the landing and the graph read it).
			case 'leftFoot':
				if ( c.grounded ) c.leftFootLeads = true;
				break;
			case 'rightFoot':
				if ( c.grounded ) c.leftFootLeads = false;
				break;
			// The part of a roll and of a trick the body is committed to.
			case 'rollStart':
				c.rolling = true;
				break;
			case 'rollEnd':
				c.rolling = false;
				break;
			case 'trickStart':
				c.tricking = true;
				break;
			case 'trickEnd':
				c.tricking = false;
				break;
			// A move that can be followed by an air trick says when.
			case 'airComboOpen':
				c.openAirComboSoon();
				break;
			case 'capsuleShrink':
				c.capsule.shrink();
				break;
			case 'capsuleRestore':
				c.capsule.restore();
				break;

		}

	}

}

export { MarkerResponses };
