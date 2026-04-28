const test = require('node:test');
const assert = require('node:assert/strict');

const { getCardById, mapImoCardRecordToCatalogCard } = require('./cardsCatalog');
const { normalizeCardAutomationConfig } = require('./cardAutomation');

test('getCardById resolves official card with imoCost metadata', () => {
  const card = getCardById('divisao');

  assert.ok(card);
  assert.equal(card.category, 'division');
  assert.equal(card.imoCost, 1);
  assert.equal(card.maxCopies, 3);
});

test('official cards expose structured automation metadata when needed', () => {
  const visualizar = getCardById('visualizar');
  const movimento = getCardById('movimento');
  const maldicao = getCardById('maldicao');

  assert.equal(movimento.canPlayTogether, true);
  assert.equal(visualizar.playAutomation.targetScope, 'selected-player');
  assert.equal(visualizar.discardAutomation.effects[0].type, 'moveTopDeckToExile');
  assert.equal(maldicao.canDiscard, false);
});

test('mapImoCardRecordToCatalogCard maps persisted imo cards to catalog shape', () => {
  const card = mapImoCardRecordToCatalogCard({
    id: 7,
    name: 'Ritual de Eclipse',
    description: 'Carta personalizada de teste.',
    image_path: 'data:image/png;base64,abc',
    max_copies: 2,
    imo_cost: 4,
    automation_json: {
      canDiscard: false,
      canPlayTogether: true,
      playAutomation: {
        targetScope: 'selected-player',
        effects: [
          {
            type: 'revealTopDeck',
            target: 'selected-player',
          },
        ],
      },
      discardAutomation: {
        effects: [
          {
            type: 'drawTopDeckToHand',
          },
        ],
      },
    },
  });

  assert.deepEqual(card, {
    id: 'imo:7',
    sourceId: 7,
    name: 'Ritual de Eclipse',
    category: 'imo',
    maxCopies: 2,
    imoCost: 4,
    effect: 'Carta personalizada de teste.',
    imagePath: 'data:image/png;base64,abc',
    isCustom: true,
    canDiscard: false,
    canPlayTogether: true,
    playAutomation: {
      targetScope: 'selected-player',
      effects: [
        {
          type: 'revealTopDeck',
          target: 'selected-player',
        },
      ],
    },
    discardAutomation: null,
  });
});

test('normalizeCardAutomationConfig applies defaults for custom cards', () => {
  const automation = normalizeCardAutomationConfig({
    playAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'reacao',
        },
      ],
    },
  });

  assert.deepEqual(automation, {
    canDiscard: true,
    canPlayTogether: false,
    playAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'reacao',
        },
      ],
    },
    discardAutomation: null,
  });
});
