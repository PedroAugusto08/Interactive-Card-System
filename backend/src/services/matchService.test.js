const test = require('node:test');
const assert = require('node:assert/strict');

const { __testables } = require('./matchService');

test('applyCeifarStealOnSuccessfulAttack steals one hand card when attacker holds Ceifar', () => {
  const attackerState = {
    id: 10,
    hand_cards_json: [
      { cardId: 'ceifar', instanceId: 'ceifar::1', ownerId: 10 },
      { cardId: 'movimento', instanceId: 'movimento::1', ownerId: 10 },
    ],
  };
  const defenderState = {
    id: 20,
    hand_cards_json: [
      { cardId: 'ataque_normal', instanceId: 'ataque::1', ownerId: 20 },
      { cardId: 'reacao', instanceId: 'reacao::1', ownerId: 20 },
    ],
  };

  const stolenCard = __testables.applyCeifarStealOnSuccessfulAttack({
    attackerState,
    defenderState,
    stolenIndex: 1,
  });

  assert.ok(stolenCard);
  assert.equal(stolenCard.cardId, 'reacao');
  assert.equal(stolenCard.ownerId, 10);
  assert.equal(attackerState.hand_cards_json.length, 3);
  assert.equal(defenderState.hand_cards_json.length, 1);
  assert.equal(defenderState.hand_cards_json[0].cardId, 'ataque_normal');
});

test('applyCeifarStealOnSuccessfulAttack does nothing without Ceifar in hand', () => {
  const attackerState = {
    id: 10,
    hand_cards_json: [{ cardId: 'movimento', instanceId: 'movimento::1', ownerId: 10 }],
  };
  const defenderState = {
    id: 20,
    hand_cards_json: [{ cardId: 'reacao', instanceId: 'reacao::1', ownerId: 20 }],
  };

  const stolenCard = __testables.applyCeifarStealOnSuccessfulAttack({
    attackerState,
    defenderState,
    stolenIndex: 0,
  });

  assert.equal(stolenCard, null);
  assert.equal(attackerState.hand_cards_json.length, 1);
  assert.equal(defenderState.hand_cards_json.length, 1);
});

test('applyFerroadaHandEffect exiles up to 2 other cards and draws 2 from deck', async () => {
  const actingParticipant = {
    id: 10,
    controller_user_id: 1,
    display_name: 'Bicho',
    hand_cards_json: [
      { cardId: 'ferroada', instanceId: 'ferroada::1', ownerId: 10 },
      { cardId: 'movimento', instanceId: 'movimento::1', ownerId: 10 },
      { cardId: 'reacao', instanceId: 'reacao::1', ownerId: 10 },
    ],
    exile_cards_json: [],
    deck_cards_json: [
      { cardId: 'ataque_normal', instanceId: 'ataque::1', ownerId: 10 },
      { cardId: 'divisao', instanceId: 'divisao::1', ownerId: 10 },
    ],
  };

  const outcome = await __testables.applyFerroadaHandEffect({
    ownerUserId: 1,
    actingParticipant,
    ferroadaCardId: 'ferroada::1',
    selectedOwnHandCardIds: ['movimento::1', 'reacao::1'],
  });

  assert.equal(outcome.exiledCount, 2);
  assert.equal(outcome.drawnCount, 2);
  assert.equal(actingParticipant.exile_cards_json.length, 2);
  assert.equal(actingParticipant.hand_cards_json.length, 3);
  assert.deepEqual(
    actingParticipant.hand_cards_json.map((card) => card.cardId),
    ['ferroada', 'ataque_normal', 'divisao']
  );
});
