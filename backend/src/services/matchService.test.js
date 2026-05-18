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
