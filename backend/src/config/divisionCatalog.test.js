const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DIVISION_CATALOG,
  getDivisionById,
  getDivisionCatalogEntries,
  inferDivisionIdFromActionIds,
} = require('./divisionCatalog');

test('division catalog exposes fixed divisions with passive, cards, and imo slot count', () => {
  const arquivista = getDivisionById('arquivista-do-vazio');
  const entries = getDivisionCatalogEntries();

  assert.equal(DIVISION_CATALOG.length, 6);
  assert.ok(arquivista);
  assert.equal(arquivista.imoCardSlots, 2);
  assert.match(arquivista.passive, /inimigo usa uma carta de Imo/i);
  assert.equal(arquivista.passiveConfig.id, 'arquivista-view-on-enemy-imo');
  assert.ok(entries.every((division) => Array.isArray(division.cards) && division.cards.length >= 1));
});

test('inferDivisionIdFromActionIds resolves exact modern and legacy-ceifar loadouts', () => {
  assert.equal(
    inferDivisionIdFromActionIds(['visualizar', 'ecoar', 'equalizar']),
    'condutor-de-ecos'
  );
  assert.equal(
    inferDivisionIdFromActionIds(['interromper', 'memoria-seletiva']),
    'arquivista-do-vazio'
  );
  assert.equal(
    inferDivisionIdFromActionIds(['ceifar']),
    null
  );
});

test('inferDivisionIdFromActionIds can recover single-division subsets during migration', () => {
  assert.equal(inferDivisionIdFromActionIds(['esquema']), 'remendador');
  assert.equal(inferDivisionIdFromActionIds(['visualizar', 'equalizar']), 'condutor-de-ecos');
  assert.equal(inferDivisionIdFromActionIds(['equalizar', 'loucura']), null);
});
