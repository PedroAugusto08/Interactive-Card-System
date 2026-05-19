const test = require('node:test');
const assert = require('node:assert/strict');

const { __testables } = require('./matchService');
const { getDivisionActionById } = require('../config/cardsCatalog');

test('addUniqueCardId stores each exiled card id only once', () => {
  const next = __testables.addUniqueCardId(['imo:1'], 'imo:1');
  const extended = __testables.addUniqueCardId(next, 'imo:2');

  assert.deepEqual(next, ['imo:1']);
  assert.deepEqual(extended, ['imo:1', 'imo:2']);
});

test('consumeActionSlot marks complementary action usage', () => {
  const participant = {
    standard_action_used: false,
    complementary_action_used: false,
  };

  __testables.consumeActionSlot({ participant, actionSlot: 'complementary' });

  assert.equal(participant.standard_action_used, false);
  assert.equal(participant.complementary_action_used, true);
});

test('consumeActionSlot marks standard action usage', () => {
  const participant = {
    standard_action_used: false,
    complementary_action_used: false,
  };

  __testables.consumeActionSlot({ participant, actionSlot: 'standard' });

  assert.equal(participant.standard_action_used, true);
  assert.equal(participant.complementary_action_used, false);
});

test('isAlliedParticipant treats players as allies and master creatures as a separate team', () => {
  assert.equal(
    __testables.isAlliedParticipant(
      { participant_type: 'player' },
      { participant_type: 'player' }
    ),
    true
  );
  assert.equal(
    __testables.isAlliedParticipant(
      { participant_type: 'player' },
      { participant_type: 'master-creature' }
    ),
    false
  );
  assert.equal(
    __testables.isAlliedParticipant(
      { participant_type: 'master-creature' },
      { participant_type: 'master-creature' }
    ),
    true
  );
});

test('buildGeneratedAllyImoCardKey creates a stable unique key per owner and card', () => {
  assert.equal(
    __testables.buildGeneratedAllyImoCardKey({
      catalogOwnerId: 15,
      cardId: 'imo:7',
    }),
    '15::imo:7'
  );
});

test('assertDivisionActionCanBeUsed blocks Loucura before exiling Imo in the turn', () => {
  assert.throws(
    () =>
      __testables.assertDivisionActionCanBeUsed({
        actingParticipant: {
          has_exiled_imo_this_turn: false,
        },
        divisionCard: {
          id: 'loucura',
        },
      }),
    /Loucura exige/
  );
});

test('buildDivisionActionNotice adds the partial Loucura reminder', () => {
  assert.equal(
    __testables.buildDivisionActionNotice({
      divisionCard: { id: 'loucura' },
      automationOutcome: { notices: [] },
    }),
    'Condicao de Loucura atendida. A recuperacao total de Imo ainda segue resolucao manual.'
  );
});

test('resolveAutomationTarget blocks allied targets for selected-enemy actions', () => {
  const automation = {
    targetScope: 'selected-enemy',
  };
  const actingParticipant = {
    id: 1,
    participant_type: 'player',
  };
  const participantsById = new Map([
    [
      2,
      {
        id: 2,
        participant_type: 'player',
      },
    ],
  ]);

  assert.throws(
    () =>
      __testables.resolveAutomationTarget({
        automation,
        actingParticipant,
        participantsById,
        targetParticipantId: 2,
      }),
    /inimigo/
  );
});

test('applyAutomation can cancel the complementary action of a selected enemy', async () => {
  const automation = getDivisionActionById('interromper').useAutomation;
  const actingParticipant = {
    id: 1,
    display_name: 'Heroi',
    participant_type: 'player',
    hand_cards_json: [],
  };
  const targetParticipant = {
    id: 3,
    display_name: 'Fera',
    participant_type: 'master-creature',
    complementary_action_used: false,
    hand_cards_json: [],
  };
  const participantsById = new Map([
    [1, actingParticipant],
    [3, targetParticipant],
  ]);

  const outcome = await __testables.applyAutomation({
    ownerUserId: 99,
    automation,
    actingParticipant,
    participantsById,
    targetParticipantId: 3,
  });

  assert.equal(targetParticipant.complementary_action_used, true);
  assert.deepEqual(outcome.effects, []);
  assert.deepEqual(outcome.notices, ['Efeito resolvido: a ação complementar de Fera foi anulada.']);
});

test('spendImo consumes temporary Imo before normal Imo', () => {
  const participant = { imo: 3, current_imo: 3, current_carne: 5 };
  const participantCombatState = { temporaryImo: 2, temporaryCarne: 0, combatStatus: 'active' };

  __testables.spendImo({
    participant,
    participantCombatState,
    amount: 4,
  });

  assert.equal(participantCombatState.temporaryImo, 0);
  assert.equal(participant.imo, 1);
  assert.equal(participant.current_imo, 1);
});

test('buildParticipantPassiveState reflects Rato generation and Executor cooldown', () => {
  const ratoState = __testables.buildParticipantPassiveState({
    matchParticipant: { has_generated_imo_this_turn: false },
    participantCombatState: { temporaryImo: 0, executorCooldownTurns: 0, temporaryDivisionActions: [] },
    division: { id: 'rato-de-ruina' },
  });
  const executorState = __testables.buildParticipantPassiveState({
    matchParticipant: { has_generated_imo_this_turn: false },
    participantCombatState: { temporaryImo: 0, executorCooldownTurns: 2, temporaryDivisionActions: [] },
    division: { id: 'executor-desgastado' },
  });

  assert.equal(ratoState.generateImoLimit, 2);
  assert.equal(executorState.executorExtraAttackReady, false);
  assert.equal(executorState.executorCooldownTurns, 2);
});

test('resolvePassiveTargetState accepts allied targets and blocks self for ally passives', () => {
  const actingParticipant = { id: 1, participant_type: 'player' };
  const participantsById = new Map([
    [1, actingParticipant],
    [2, { id: 2, participant_type: 'player' }],
  ]);

  assert.equal(
    __testables.resolvePassiveTargetState({
      actingParticipant,
      participantsById,
      targetParticipantId: 2,
      targetScope: 'selected-ally',
    }).id,
    2
  );

  assert.throws(
    () =>
      __testables.resolvePassiveTargetState({
        actingParticipant,
        participantsById,
        targetParticipantId: 1,
        targetScope: 'selected-ally',
      }),
    /outro participante/
  );
});

test('resolveMatchProgressAfterDamage finishes the match when only one team remains', () => {
  const resolution = __testables.resolveMatchProgressAfterDamage({
    match: {
      status: 'active',
      round: 3,
      current_turn_player_id: 10,
      current_turn_participant_id: 1,
      winner_user_id: null,
      winner_participant_id: null,
    },
    participants: [
      { id: 1, controller_user_id: 10, participant_type: 'player', is_defeated: false },
      { id: 2, controller_user_id: 11, participant_type: 'master-creature', is_defeated: true },
    ],
  });

  assert.equal(resolution.status, 'finished');
  assert.equal(resolution.winnerParticipantId, 1);
});

test('applyCarneDamage consumes temporary Carne before real Carne', () => {
  const participant = {
    health: 4,
    current_carne: 4,
    imo: 3,
    current_imo: 3,
    is_defeated: false,
  };
  const participantCombatState = {
    temporaryCarne: 2,
    temporaryImo: 0,
    combatStatus: 'active',
  };

  __testables.applyCarneDamage({
    participant,
    participantCombatState,
    amount: 3,
  });

  assert.equal(participantCombatState.temporaryCarne, 0);
  assert.equal(participant.current_carne, 3);
  assert.equal(participant.health, 3);
});

test('updateCombatStatus marks participant as down when effective Imo reaches zero', () => {
  const participant = {
    current_carne: 5,
    current_imo: 0,
    is_defeated: false,
  };
  const participantCombatState = {
    temporaryCarne: 0,
    temporaryImo: 0,
    combatStatus: 'active',
  };

  const nextStatus = __testables.updateCombatStatus({
    participant,
    participantCombatState,
  });

  assert.equal(nextStatus, 'down');
  assert.equal(__testables.getCombatStatus(participant, participantCombatState), 'down');
});

test('updateCombatStatus restores participant to active after resources become positive again', () => {
  const participant = {
    current_carne: 2,
    current_imo: 1,
    is_defeated: false,
  };
  const participantCombatState = {
    temporaryCarne: 0,
    temporaryImo: 0,
    combatStatus: 'down',
  };

  const nextStatus = __testables.updateCombatStatus({
    participant,
    participantCombatState,
  });

  assert.equal(nextStatus, 'active');
  assert.equal(__testables.getCombatStatus(participant, participantCombatState), 'active');
});
