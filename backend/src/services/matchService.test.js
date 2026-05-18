const test = require('node:test');
const assert = require('node:assert/strict');

const { __testables } = require('./matchService');

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
