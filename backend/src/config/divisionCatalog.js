const { getDivisionActionById } = require('./cardsCatalog');

const DIVISION_CATALOG = [
  {
    id: 'executor-desgastado',
    name: 'Executor Desgastado',
    actionIds: ['recarregar', 'destruir'],
    passive:
      'Pode realizar um ataque extra a cada 2 turnos. Sofre +1 de dano ao falhar neste ataque.',
    imoCardSlots: 1,
    passiveConfig: {
      id: 'executor-extra-attack',
      type: 'active',
      actionSlot: 'free',
      targetScope: 'selected-enemy',
    },
  },
  {
    id: 'condutor-de-ecos',
    name: 'Condutor de Ecos',
    actionIds: ['visualizar', 'ecoar', 'equalizar'],
    passive:
      'Pode consumir uma carta de Imo da mão para gerar uma carta de mesmo custo na mão de um aliado ao custo de 1 de Imo.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'condutor-share-imo',
      type: 'active',
      actionSlot: 'complementary',
      imoCost: 1,
      targetScope: 'selected-ally',
      selection: 'own-hand-card',
      extraSelection: 'own-catalog-card',
    },
  },
  {
    id: 'flagelado-voluntario',
    name: 'Flagelado Voluntário',
    actionIds: ['divisao', 'maldicao'],
    passive: 'Uma vez por turno ao sofrer dano ganha 1 de Imo Temporário.',
    imoCardSlots: 1,
    passiveConfig: {
      id: 'flagelado-temp-imo',
      type: 'trigger',
      trigger: 'take-damage',
    },
  },
  {
    id: 'rato-de-ruina',
    name: 'Rato de Ruína',
    actionIds: ['exploracao', 'loucura'],
    passive: 'Pode gerar duas de uma carta por turno.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'rato-double-generate',
      type: 'modifier',
      trigger: 'generate-imo',
      maxGeneratedCards: 2,
    },
  },
  {
    id: 'remendador',
    name: 'Remendador',
    actionIds: ['esquema'],
    passive: 'Pode utilizar seu turno para gerar uma carta de qualquer divisão para si ao custo de 3 de Imo.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'remendador-borrow-division',
      type: 'active',
      actionSlot: 'standard',
      imoCost: 3,
      selection: 'division-action-id',
    },
  },
  {
    id: 'arquivista-do-vazio',
    name: 'Arquivista do Vazio',
    actionIds: ['interromper', 'memoria-seletiva'],
    passive: 'Quando um inimigo usa uma carta de Imo, você pode olhar uma carta da mão dele.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'arquivista-view-on-enemy-imo',
      type: 'trigger',
      trigger: 'enemy-use-imo',
    },
  },
];

const DIVISION_BY_ID = new Map(DIVISION_CATALOG.map((division) => [division.id, division]));

function getDivisionById(divisionId) {
  return DIVISION_BY_ID.get(String(divisionId || '').trim()) || null;
}

function hydrateDivision(division) {
  if (!division) {
    return null;
  }

  return {
    ...division,
    cards: division.actionIds.map((actionId) => getDivisionActionById(actionId)).filter(Boolean),
  };
}

function getDivisionCatalogEntries() {
  return DIVISION_CATALOG.map((division) => hydrateDivision(division));
}

function inferDivisionIdFromActionIds(actionIds) {
  const normalizedIds = [...new Set((Array.isArray(actionIds) ? actionIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!normalizedIds.length) {
    return null;
  }

  const normalizedSet = new Set(normalizedIds.map((value) => (value === 'ceifar' ? 'ferroada' : value)));

  for (const division of DIVISION_CATALOG) {
    if (
      division.actionIds.length === normalizedSet.size &&
      division.actionIds.every((actionId) => normalizedSet.has(actionId))
    ) {
      return division.id;
    }
  }

  const subsetMatches = DIVISION_CATALOG.filter((division) =>
    [...normalizedSet].every((actionId) => division.actionIds.includes(actionId))
  );
  if (subsetMatches.length === 1) {
    return subsetMatches[0].id;
  }

  return null;
}

module.exports = {
  DIVISION_CATALOG,
  getDivisionById,
  getDivisionCatalogEntries,
  hydrateDivision,
  inferDivisionIdFromActionIds,
};
