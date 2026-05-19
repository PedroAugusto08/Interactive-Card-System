const { getDivisionActionById } = require('./cardsCatalog');

const FRAGMENT_KEYS = [
  'combate',
  'pontaria',
  'resistencia',
  'furor',
  'percepcao',
  'conhecimento',
  'medicina',
  'furtividade',
  'improviso',
  'mobilidade',
];

function normalizeDivisionFragments(fragments) {
  return Object.fromEntries(FRAGMENT_KEYS.map((key) => [key, Number(fragments?.[key] || 0)]));
}

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
    fragments: {
      combate: 2,
      pontaria: 2,
      resistencia: 1,
    },
  },
  {
    id: 'condutor-de-ecos',
    name: 'Condutor de Ecos',
    actionIds: ['visualizar', 'ecoar', 'equalizar'],
    passive:
      'Pode consumir uma carta de Imo da mao para gerar uma carta de mesmo custo na mao de um aliado ao custo de 1 de Imo.',
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
    fragments: {
      furor: 3,
      conhecimento: 2,
    },
  },
  {
    id: 'flagelado-voluntario',
    name: 'Flagelado Voluntario',
    actionIds: ['divisao', 'maldicao'],
    passive: 'Uma vez por turno ao sofrer dano ganha 1 de Imo Temporario.',
    imoCardSlots: 1,
    passiveConfig: {
      id: 'flagelado-temp-imo',
      type: 'trigger',
      trigger: 'take-damage',
    },
    fragments: {
      resistencia: 3,
      combate: 1,
      furor: 1,
    },
  },
  {
    id: 'rato-de-ruina',
    name: 'Rato de Ruina',
    actionIds: ['exploracao', 'loucura'],
    passive: 'Pode gerar duas de uma carta por turno.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'rato-double-generate',
      type: 'modifier',
      trigger: 'generate-imo',
      maxGeneratedCards: 2,
    },
    fragments: {
      furtividade: 3,
      percepcao: 2,
    },
  },
  {
    id: 'remendador',
    name: 'Remendador',
    actionIds: ['esquema'],
    passive: 'Pode utilizar seu turno para gerar uma carta de qualquer divisao para si ao custo de 3 de Imo.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'remendador-borrow-division',
      type: 'active',
      actionSlot: 'standard',
      imoCost: 3,
      selection: 'division-action-id',
    },
    fragments: {
      improviso: 3,
      conhecimento: 1,
      resistencia: 1,
    },
  },
  {
    id: 'arquivista-do-vazio',
    name: 'Arquivista do Vazio',
    actionIds: ['interromper', 'memoria-seletiva'],
    passive: 'Quando um inimigo usa uma carta de Imo, voce pode olhar uma carta da mao dele.',
    imoCardSlots: 2,
    passiveConfig: {
      id: 'arquivista-view-on-enemy-imo',
      type: 'trigger',
      trigger: 'enemy-use-imo',
    },
    fragments: {
      conhecimento: 3,
      percepcao: 2,
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
    fragments: normalizeDivisionFragments(division.fragments),
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
  FRAGMENT_KEYS,
  getDivisionById,
  getDivisionCatalogEntries,
  hydrateDivision,
  inferDivisionIdFromActionIds,
  normalizeDivisionFragments,
};
