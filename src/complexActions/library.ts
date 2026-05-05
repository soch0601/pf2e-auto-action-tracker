import type { SpecialActivity } from './types.d.ts';

export const SPECIAL_ACTIVITIES: SpecialActivity[] = [
    {
        name: 'Administer First Aid',
        slug: 'administer-first-aid',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'medicine' } }
        ]
    },
    {
        name: 'Antler Rush',
        slug: 'antler-rush',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minCost: 1, maxCost: 2 } },
            { type: 'OPERATOR', value: 'AND' },
            {
                type: 'GROUP',
                value: [
                    { type: 'ACTION', properties: { type: 'action', subtype: 'disarm' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'shove' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
                ]
            },
        ]
    },
    {
        name: 'Arcane Shroud',
        slug: 'arcane-shroud',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'arcane-cascade' } },
        ]
    },
    {
        name: 'Arcane Slam',
        slug: 'arcane-slam',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
        ]
    },
    {
        name: 'Balance',
        slug: 'balance',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'acrobatics' } },
        ]
    },
    // TODO: TEST this fails on the athletics and strike.  Why?
    {
        name: 'Barreling Charge',
        slug: 'barreling-charge',
        childActions: [
            {
                type: 'GROUP',
                value: [
                    {
                        type: 'GROUP',
                        value: [
                            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minCost: 1, maxCost: 1, modifiers: ['allowInterruption', 'manualFinish'] } },
                            { type: 'OPERATOR', value: 'XOR' },
                            { type: 'ACTION', properties: { type: 'move', subtype: 'burrow', minCost: 1, maxCost: 1, modifiers: ['allowInterruption', 'manualFinish'] } },
                            { type: 'OPERATOR', value: 'XOR' },
                            { type: 'ACTION', properties: { type: 'move', subtype: 'swim', minCost: 1, maxCost: 1, modifiers: ['allowInterruption', 'manualFinish'] } },
                            { type: 'OPERATOR', value: 'XOR' },
                            { type: 'ACTION', properties: { type: 'move', subtype: 'fly', minCost: 1, maxCost: 1, modifiers: ['allowInterruption', 'manualFinish'] } },
                            { type: 'OPERATOR', value: 'XOR' },
                            { type: 'ACTION', properties: { type: 'move', subtype: 'climb', minCost: 1, maxCost: 1, modifiers: ['allowInterruption', 'manualFinish'] } },
                        ],
                    },
                    { type: 'OPERATOR', value: 'AND' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics', minOccurrences: 0, maxOccurrences: 500 } },
                ]
            },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Bat around',
        slug: 'bat-around',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            {
                type: 'GROUP',
                value: [
                    { type: 'ACTION', properties: { type: 'action', subtype: 'shove' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'reposition' } },
                ]
            },
        ]
    },
    {
        name: 'Battlefield Agility',
        slug: 'battlefield-agility',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'step' } }
        ]
    },
    {
        name: 'Black Powder Blaze',
        slug: 'black-powder-blaze',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'black-powder-boost' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
        ]
    },
    {
        name: 'Black Powder Boost',
        slug: 'black-powder-boost',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } },
            { type: 'OPERATOR', value: 'XOR' },
            // This has a special ability that let's you make it one cost if high jump or long jump cost one, but TBD how to implement that
            { type: 'ACTION', properties: { type: 'action', subtype: 'high-jump', overrideParentCost: 2 } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'long-jump', overrideParentCost: 2 } },
        ]
    },
    {
        name: 'Blazing Talon Surge',
        slug: 'blazing-talon-surge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics', minOccurrences: 0, maxOccurrences: 1 } },
        ]
    },
    {
        name: 'Bombing Run',
        slug: 'bombing-run',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'fly' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
        ]
    },
    {
        name: 'Bon Mot',
        slug: 'bon-mot',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'diplomacy' } },
        ]
    },
    {
        name: 'Brandish Authority',
        slug: 'brandish-authority',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation', minOccurrences: 0 } }
        ]
    },
    {
        name: 'Bullet Split',
        slug: 'bullet-split',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['deferMAP'] } }
        ]
    },
    {
        name: 'Called Shot',
        slug: 'called-shot',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    // TODO: Handle when handling summons - PF2e Summons Assistant (Chasarooni)
    // {
    //     name: 'Cavalier\'s Charge',
    //     slug: 'cavaliers-charge',
    //     childActions: [
    //         { type: 'ACTION', properties: { type: 'action', subtype: 'command-an-animal' } },
    //         { type: 'OPERATOR', value: 'THEN' },
    //         { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
    //     ]
    // },
    {
        name: 'Chain Reaction',
        slug: 'chain-reaction',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 500 } }
        ]
    },
    {
        name: 'Clear the Way',
        slug: 'clear-the-way',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'shove', minOccurrences: 0, maxOccurrences: 500, modifiers: ['deferMAP'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'trip', minOccurrences: 0, maxOccurrences: 500, modifiers: ['deferMAP'] } },
            { type: 'OPERATOR', value: 'THEN' },
            //TODO: Needs to be up to half speed - no way to implement currently
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', modifiers: ['manualFinish'] } },
        ]
    },
    {
        name: 'Climb',
        slug: 'climb',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'climb' } },
        ]
    },
    {
        name: 'Clobber',
        slug: 'clobber',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'shove' } }
        ]
    },
    {
        name: 'Command An Animal',
        slug: 'command-an-animal',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'nature' } }
        ]
    },
    {
        name: 'Commitment to Equality',
        slug: 'commitment-to-equality',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'diplomacy' } }
        ]
    },
    {
        name: 'Conceal An Object',
        slug: 'conceal-an-object',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'stealth' } }
        ]
    },
    {
        name: 'Coordinated Charge',
        slug: 'coordinated-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Courageous Onslaught',
        slug: 'courageous-onslaught',
        childActions: [
            { type: 'ACTION', properties: { type: 'spell', subtype: 'courageous-anthem' } }
        ]
    },
    {
        name: 'Covered Reload',
        slug: 'covered-reload',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'hide' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'take-cover' } }
                ]
            },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
        ]
    },
    {
        name: 'Create A Diversion',
        slug: 'create-a-diversion',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'deception' } }
        ]
    },
    {
        name: 'Cross the Final Horizon',
        slug: 'cross-the-final-horizon',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 3, modifiers: ['fixedMAP', 'manualFinish'] } }
        ]
    },
    {
        name: 'Daring Act',
        slug: 'daring-act',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } }
                ]
            },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minCost: 0, maxCost: 1, minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Dashing Strike',
        slug: 'dashing-strike',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Death from Above',
        slug: 'death-from-above',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
        ]
    },
    {
        name: 'Defensive Advance',
        slug: 'defensive-advance',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'raise-shield' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Defensive Instincts',
        slug: 'defensive-instincts',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step' } }
        ]
    },
    {
        name: 'Demoralize',
        slug: 'demoralize',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Desperate Resuscitation',
        slug: 'desperate-resuscitation',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'medicine' } }
        ]
    },
    {
        name: 'Disable A Device',
        slug: 'disable-a-device',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'thievery' } }
        ]
    },
    {
        name: 'Disarm',
        slug: 'disarm',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Divide and Conquer',
        slug: 'divide-and-conquer',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['fixedMAP', 'deferMAP'] } }
        ]
    },
    {
        name: 'Doctor\'s Visitation',
        slug: 'doctor\'s-visitation',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'battle-medicine', overrideParentCost: 1 } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'treat-poison', overrideParentCost: 1 } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'administer-first-aid', overrideParentCost: 2 } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'treat-condition', overrideParentCost: 2 } }
                ]
            }
        ]
    },
    {
        name: 'Dodge Away',
        slug: 'dodge-away',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Double Shot',
        slug: 'double-shot',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['fixedMAP', 'deferMAP'] } }
        ]
    },
    {
        name: 'Double Slice',
        slug: 'double-slice',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 2, modifiers: ['combineDamage', 'manualFinish'] } }
        ]
    },
    {
        name: 'Dread Marshal Stance',
        slug: 'dread-marshal-stance',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Drifter\'s Juke',
        slug: 'drifters-juke',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
        ]
    },
    {
        name: 'Dual-Weapon Blitz',
        slug: 'dual-weapon-blitz',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2 } }
        ]
    },
    {
        name: 'Emphatic Emissary',
        slug: 'emphatic-emmisary',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'disarming-smile' } },
        ]
    },
    {
        name: 'Encouraging Words',
        slug: 'encouraging-words',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'diplomacy' } }
        ]
    },
    {
        name: 'Escape',
        slug: 'escape',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Extract Vow of Nonviolence',
        slug: 'extract-vow-of-nonviolence',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'diplomacy' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Falcon Swoop',
        slug: 'falcon-swoop',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'fly' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'fly' } },
        ]
    },
    {
        name: 'Fane\'s Escape',
        slug: 'fanes-escape',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'sneak' } }
        ]
    },
    {
        name: 'Fated Duel',
        slug: 'fated-duel',
        childActions: [{ type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation', minOccurrences: 0, maxOccurrences: 1 } }]
    },
    {
        name: 'Feint',
        slug: 'feint',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'stealth' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'deception' } }
        ]
    },
    {
        name: 'Felling Shot',
        slug: 'felling-shot',
        childActions: [{ type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }]
    },
    {
        name: 'Felling Strike',
        slug: 'felling-strike',
        childActions: [{ type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }]
    },
    {
        name: 'Feral Lunge',
        slug: 'feral-lunge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Feral Scramble',
        slug: 'feral-scramble',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'climb' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Final Shot Knows the Way',
        slug: 'final-shot-knows-the-way',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 2, maxOccurrences: 2, modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Flinging Charge',
        slug: 'flinging-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Flurry of Blows',
        slug: 'flurry-of-blows',
        childActions: [
            {
                type: 'ACTION',
                properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 2, modifiers: ['combineDamage', 'manualFinish'] }
            }
        ]
    },
    {
        name: 'Flying Tackle',
        slug: 'flying-tackle',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Force Open',
        slug: 'force-open',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Form Lock',
        slug: 'form-lock',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Furious Grab',
        slug: 'furious-grab',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Glory on High',
        slug: 'glory-on-high',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'fly' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } }
        ]
    },
    {
        name: 'Godbreaker',
        slug: 'godbreaker',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 3, modifiers: ['manualFinish', 'deferMAP'] } }
        ]
    },
    {
        name: 'Gorilla Pound',
        slug: 'gorilla-pound',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Goring Charge',
        slug: 'goring-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 2, maxOccurrences: 2 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Grapple',
        slug: 'grapple',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Haft Beatdown',
        slug: 'haft-beatdown',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['deferMAP', 'combineDamage'] } }
        ]
    },
    {
        name: 'Hide',
        slug: 'hide',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'stealth' } }
        ]
    },
    {
        name: 'High Jump',
        slug: 'high-jump',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap', minOccurrences: 0, maxOccurrences: 1 } },
        ]
    },
    {
        name: 'Hit and Run',
        slug: 'hit-and-run',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'move', subtype: 'step' } }
                ]
            },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'sneak' } }
        ]
    },
    //GUSTING SPELL - how to do?
    {
        name: 'Homing Shot',
        slug: 'homing-shot',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Hunted Shot',
        slug: 'hunted-shot',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['combineDamage'] } }
        ]
    },
    {
        name: 'Hurling Charge',
        slug: 'hurling-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } }
        ]
    },
    {
        name: 'Idol Threat',
        slug: 'idol-threat',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Infiltrator\'s Reload',
        slug: 'infiltrators-reload',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'hide' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'sneak' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'take-cover' } }
                ]
            }
        ]
    },
    {
        name: 'Interpose',
        slug: 'interpose',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Into the Fray',
        slug: 'into-the-fray',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'move', subtype: 'swim' } }
                ]
            },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['deferMAP', 'allowInterruption'] } }
        ]
    },
    {
        name: 'Invincible Army',
        slug: 'invincible-army',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'deception' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'diplomacy' } }
                ]
            }
        ]
    },
    {
        name: 'It Was Me All Along!',
        slug: 'it-was-me-all-along',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'feint' } }]
    },
    {
        name: 'Juggernaut Charge',
        slug: 'juggernaut-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } }
        ]
    },
    {
        name: 'Lie',
        slug: 'lie',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'deception' } }
        ]
    },
    {
        name: 'Lightspeed Assault',
        slug: 'lightspeed-assault',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Long Jump',
        slug: 'long-jump',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap', minOccurrences: 0, maxOccurrences: 1 } },
        ]
    },
    {
        name: 'Magpie Snatch',
        slug: 'magpie-snatch',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 2, maxOccurrences: 2 } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'interact', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Mammoth Charge',
        slug: 'mammoth-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'command-an-animal' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Maneuver In Flight',
        slug: 'maneuver-in-flight',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } }
        ]
    },
    {
        name: 'Mobile Finisher',
        slug: 'mobile-finisher',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Mobile Magical Combat',
        slug: 'mobile-magical-combat',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Momentous Charge',
        slug: 'momentous-charge',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'move', subtype: 'climb' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } }
                ]
            },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Murderer\'s Circle',
        slug: 'murderers-circle',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Muscle Mimicry',
        slug: 'muscle-mimicry',
        childActions: [
            {
                type: 'GROUP', value: [
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } }
                ]
            }
        ]
    },
    {
        name: 'Mythic Containment',
        slug: 'mythic-containment',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'deception' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'diplomacy' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Needle in the Gods\' Eyes',
        slug: 'needle-in-the-gods-eyes',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['deferMAP'] } }
        ]
    },
    {
        name: 'Nightwave Springing Reload',
        slug: 'nightwave-springing-reload',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } }
        ]
    },
    {
        name: 'Pack Movement',
        slug: 'pack-movement',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Paired Shots',
        slug: 'paired-shots',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['fixedMAP', 'combineDamage'] } }
        ]
    },
    {
        name: 'Palm An Object',
        slug: 'palm-an-object',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'thievery' } }
        ]
    },
    {
        name: 'Parting Shot',
        slug: 'parting-shot',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Pass Through',
        slug: 'pass-through',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'fly', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Pass Vengeful Judgment',
        slug: 'pass-vengeful-judgment',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'pass-vengeful-judgment' } }
        ]
    },
    {
        name: 'Path of Iron',
        slug: 'path-of-iron',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 3, modifiers: ['deferMAP'] } }
        ]
    },
    {
        name: 'Peafowl Strut',
        slug: 'peafowl-strut',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minOccurrences: 2, maxOccurrences: 2 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Pick A Lock',
        slug: 'pick-a-lock',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'thievery' } }
        ]
    },
    {
        name: 'Pierce the Eye',
        slug: 'pierce-the-eye',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Pistolero\'s Challenge',
        slug: 'pistoleros-challenge',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'deception' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Pluck from the Sky',
        slug: 'pluck-from-the-sky',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Pounce Mimicry',
        slug: 'pounce-mimicry',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Pouncing Transformation',
        slug: 'pouncing-transformation',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', maxCost: 2 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Pounding Leap',
        slug: 'pounding-leap',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Predator\'s Pounce',
        slug: 'predators-pounce',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Quick Stow (Swordmaster)',
        slug: 'quick-stow-swordmaster',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } }
        ]
    },
    {
        name: 'Quick Draw',
        slug: 'quick-draw',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Rallying Charge (Marshal)',
        slug: 'rallying-charge-marshal',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Ravenous Charge',
        slug: 'ravenous-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'grapple', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Reposition',
        slug: 'reposition',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Resuscitate',
        slug: 'resuscitate',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'medicine' } }
        ]
    },
    {
        name: 'Retaliating Rescue',
        slug: 'retaliating-rescue',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Retreating Finisher',
        slug: 'retreating-finisher',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minOccurrences: 0, maxOccurrences: 1, modifiers: ['manualFinish'] } }
        ]
    },
    {
        name: 'Reversing Charge',
        slug: 'reversing-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Running Reload',
        slug: 'running-reload',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } }
        ]
    },
    {
        name: 'Ruthless Orator',
        slug: 'ruthless-orator',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'performance' } },
        ]
    },
    {
        name: 'Scout\'s Charge',
        slug: 'scouts-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'feint' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Scout\'s Pounce',
        slug: 'scouts-pounce',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2 } }
        ]
    },
    {
        name: 'Seek',
        slug: 'seek',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'perception' } }
        ]
    },
    {
        name: 'Shielded Attrition',
        slug: 'shielded-attrition',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'raise-shield' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Serpentcoil Slam',
        slug: 'serpentcoil-slam',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Shield of Reckoning',
        slug: 'shield-of-reckoning',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'shield-block' } },
            { type: 'OPERATOR', value: 'AND' },
            {
                type: 'GROUP',
                value: [
                    { type: 'ACTION', properties: { type: 'action', subtype: 'glimpse-of-redemption' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'liberating-step' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'redeploy-defenses' } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'retributive-strike' } }
                ],
            }
        ],
    },
    {
        name: 'Shove',
        slug: 'shove',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Skeptic\'s Defense',
        slug: 'skeptics-defense',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Skirmish Strike',
        slug: 'skirmish-strike',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minCost: 1, maxCost: 1 } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Skyseeker',
        slug: 'skyseeker',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'leap', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 3 } }
        ]
    },
    {
        name: 'Slinger\'s Reload',
        slug: 'slingers-reload',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } }
        ]
    },
    {
        name: 'Slip the Grasp',
        slug: 'slip-the-grasp',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'escape' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'step', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Snare Commando',
        slug: 'snare-commando',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'create-a-diversion' } },
            { type: 'OPERATOR', value: 'XOR' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'demoralize' } }
        ]
    },
    {
        name: 'Snap Out of It! (Pathfinder Agent)',
        slug: 'snap-out-of-it-pathfinder-agent',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'medicine' } }
        ]
    },
    {
        name: 'Sneak',
        slug: 'sneak',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'stealth' } }
        ]
    },
    {
        name: 'Sovereign\'s Blade',
        slug: 'sovereigns-blade',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'sovereigns-blade' } }
        ]
    },
    {
        name: 'Spark of Independence',
        slug: 'spark-of-independence',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'spark-of-independence' } }
        ]
    },
    {
        name: 'Spear Dancer',
        slug: 'spear-dancer',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'step' } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Spring from the Shadows',
        slug: 'spring-from-the-shadows',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Steal',
        slug: 'steal',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'thievery' } }
        ]
    },
    {
        name: 'Stella\'s Stab and Snag',
        slug: 'stellas-stab-and-snag',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'action', subtype: 'steal', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Subtle Shank',
        slug: 'subtle-shank',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'conceal-an-object' } }
        ]
    },
    {
        name: 'Sudden Charge',
        slug: 'sudden-charge',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', minCost: 1, maxCost: 2 } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Surgical Shock',
        slug: 'surgical-shock',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'medicine' } }
        ]
    },
    {
        name: 'Swift Elusion',
        slug: 'swift-elusion',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Tactical Entry',
        slug: 'tactical-entry',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } }
        ]
    },
    {
        name: 'Temporal Fury',
        slug: 'temporal-fury',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'That Was a Close One, Huh?',
        slug: 'that-was-a-close-one-huh',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'deception' } }
        ]
    },
    //TODO: How to associate damage rolls with no attacks?
    {
        name: 'Trample',
        slug: 'trample',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', minOccurrences: 1, maxOccurrences: 2 } },
        ]
    },
    {
        name: 'Threatening Pursuit',
        slug: 'threatening-pursuit',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Treat Condition',
        slug: 'treat-condition',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'medicine' } }
        ]
    },
    {
        name: 'Triangle Shot',
        slug: 'triangle-shot',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 3, maxOccurrences: 3, modifiers: ['fixedMAP', 'deferMAP', 'combineDamage'] } }
        ]
    },
    {
        name: 'Triggerbrand Blitz',
        slug: 'triggerbrand-blitz',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 3, modifiers: ['deferMAP', 'manualFinish'] } }
        ]
    },
    {
        name: 'Trip',
        slug: 'trip',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics' } }
        ]
    },
    {
        name: 'Tumble Through',
        slug: 'tumble-through',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Tumbling Diversion',
        slug: 'tumbling-diversion',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'skill', subtype: 'deception', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Tumbling Strike',
        slug: 'tumbling-strike',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'acrobatics' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'move', subtype: 'tumble-through' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 0, maxOccurrences: 1 } }
        ]
    },
    {
        name: 'Twin Shot Knockdown',
        slug: 'twin-shot-knockdown',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2 } }
        ]
    },
    {
        name: 'Twin Takedown',
        slug: 'twin-takedown',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2, modifiers: ['combineDamage'] } }
        ]
    },
    {
        name: 'Two-Weapon Flurry',
        slug: 'two-weapon-flurry',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2 } }
        ]
    },
    {
        name: 'Two-Weapon Fusillade',
        slug: 'two-weapon-fusillade',
        childActions: [
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 2, maxOccurrences: 2 } }
        ]
    },
    {
        name: 'Unbalancing Sweep',
        slug: 'unbalancing-sweep',
        childActions: [
            {
                type: 'GROUP',
                value: [
                    { type: 'ACTION', properties: { type: 'action', subtype: 'shove', minOccurrences: 1, maxOccurrences: 3, modifiers: ['deferMAP'] } },
                    { type: 'OPERATOR', value: 'XOR' },
                    { type: 'ACTION', properties: { type: 'action', subtype: 'trip', minOccurrences: 1, maxOccurrences: 3, modifiers: ['deferMAP'] } }
                ]
            }
        ]
    },
    {
        name: 'Viper Strike',
        slug: 'viper-strike',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike' } }
        ]
    },
    {
        name: 'Voice Cold as Death',
        slug: 'voice-cold-as-death',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'intimidation' } }
        ]
    },
    {
        name: 'Whirlpool\'s Pull',
        slug: 'whirlpools-pull',
        childActions: [
            { type: 'ACTION', properties: { type: 'action', subtype: 'interact' } },
            { type: 'OPERATOR', value: 'THEN' },
            { type: 'ACTION', properties: { type: 'spell', subtype: 'cast-a-spell' } }
        ]
    },
    {
        name: 'Wild Dance',
        slug: 'wild-dance',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride' } }
        ]
    },
    {
        name: 'Wing Buffet',
        slug: 'wing-buffet',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics', minOccurrences: 1, maxOccurrences: 2, modifiers: ['deferMAP'] } }
        ]
    },
    {
        name: 'Wing Shove',
        slug: 'wing-shove',
        childActions: [
            { type: 'ACTION', properties: { type: 'skill', subtype: 'athletics-shove', minOccurrences: 2, maxOccurrences: 2, modifiers: ['deferMAP'] } }
        ]
    },
    {
        name: 'Whirlwind Maul',
        slug: 'whirlwind-maul',
        childActions: [
            {
                type: 'ACTION',
                properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 4, modifiers: ['deferMAP', 'manualFinish'] }
            }
        ]
    },
    {
        name: 'Writhing Runelord Weapon',
        slug: 'writhing-runelord-weapon',
        childActions: [
            { type: 'ACTION', properties: { type: 'move', subtype: 'stride', modifiers: ['allowInterruption', 'manualFinish'] } },
            { type: 'OPERATOR', value: 'AND' },
            { type: 'ACTION', properties: { type: 'attack', subtype: 'strike', minOccurrences: 1, maxOccurrences: 2 } }
        ]
    },
    // TODO: Figure out how to include damage rolls, and figure out how to implement the cost override
    // {
    //     name: 'Force Barrage',
    //     slug: 'force-barrage',
    //     childActions: [
    //         { type: 'ACTION', properties: { type: 'spell', minOccurrences: 1, maxOccurrences: 3 } }
    //     ]
    // },
]