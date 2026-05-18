const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DIVISION_ACTION_CATALOG,
  getDivisionActionById,
  mapImoCardRecordToCatalogCard,
} = require('./cardsCatalog');
const { normalizeCardAutomationConfig } = require('./cardAutomation');

test('division catalog resolves known open arsenal actions', () => {
  const divisao = getDivisionActionById('divisao');
  const visualizar = getDivisionActionById('visualizar');

  assert.ok(divisao);
  assert.ok(visualizar);
  assert.equal(divisao.category, 'division');
  assert.equal(divisao.actionSlot, 'complementary');
  assert.equal(visualizar.useAutomation.effects[0].type, 'revealRandomHandCard');
  assert.ok(DIVISION_ACTION_CATALOG.length >= 10);
});

test('mapImoCardRecordToCatalogCard maps persisted imo cards to the new runtime shape', () => {
  const card = mapImoCardRecordToCatalogCard({
    id: 7,
    owner_id: 11,
    name: 'Ritual de Eclipse',
    description: 'Carta personalizada de teste.',
    image_path: 'data:image/png;base64,abc',
    imo_cost: 4,
    automation_json: {
      actionSlot: 'complementary',
      canExile: false,
      useAutomation: {
        effects: [
          {
            type: 'gainCatalogCardToHand',
            cardId: 'imo:2',
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
    imoCost: 4,
    effect: 'Carta personalizada de teste.',
    imagePath: 'data:image/png;base64,abc',
    isCustom: true,
    actionSlot: 'complementary',
    canExile: false,
    useAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'imo:2',
        },
      ],
    },
    exileAutomation: null,
    catalogOwnerId: 11,
  });
});

test('normalizeCardAutomationConfig applies new defaults for custom imo cards', () => {
  const automation = normalizeCardAutomationConfig({
    useAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'imo:1',
        },
      ],
    },
  });

  assert.deepEqual(automation, {
    actionSlot: 'standard',
    canExile: true,
    useAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'imo:1',
        },
      ],
    },
    exileAutomation: null,
  });
});
