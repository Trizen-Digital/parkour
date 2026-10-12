// The Y Bot: Mixamo's Y Bot as the demo's runner, a RiggedFigure from the core given the Y Bot's rig (ybot.json), its
// ragdoll (ybot-ragdoll.json) and its takes (public/data/takes/).

import { RiggedFigure } from '@trizendigital/parkour/figure/RiggedFigure.js';
import { keepSharp } from '../stage/sharp.js';
import YBOT from '../data/ybot.json' with { type: 'json' };
import RAGDOLL from '../data/ybot-ragdoll.json' with { type: 'json' };

class YBotFigure extends RiggedFigure {

	constructor( { takes = './data/takes/' } = {} ) {

		super( { rig: YBOT, ragdoll: RAGDOLL, takes, name: 'the Y Bot' } );

	}

	/** Loads the model and the takes (RiggedFigure.load); the motion blur keeps the Y Bot sharp. */
	async load( library, progress ) {

		await super.load( library, progress );
		keepSharp( this.model );
		return this;

	}

}

export { YBotFigure };
