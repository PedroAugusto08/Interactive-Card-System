const { normalizeCardAutomationConfig } = require('./cardAutomation');

const CARD_CATEGORIES = {
  DIVISION: 'division',
  IMO: 'imo',
};

function defineDivisionAction(card) {
  return {
    category: CARD_CATEGORIES.DIVISION,
    actionSlot: 'complementary',
    canExile: false,
    useAutomation: null,
    exileAutomation: null,
    ...card,
  };
}

const DIVISION_ACTION_CATALOG = [
  defineDivisionAction({
    id: 'recarregar',
    name: 'Recarregar',
    imoCost: 1,
    effect: 'Gera uma municao ao custo de 1 de Imo ou recarrega completamente sua arma.',
    imagePath: '/cartas/6.png',
  }),
  defineDivisionAction({
    id: 'destruir',
    name: 'Destruir',
    imoCost: 1,
    effect: 'Consome 1 de Carne para dobrar o dano.',
    imagePath: '/cartas/7.png',
  }),
  defineDivisionAction({
    id: 'visualizar',
    name: 'Visualizar',
    imoCost: 1,
    effect: 'Ve uma carta aleatoria na mao de um alvo.',
    imagePath: '/cartas/8.png',
    useAutomation: {
      targetScope: 'selected-player',
      effects: [
        {
          type: 'revealRandomHandCard',
          target: 'selected-player',
        },
      ],
    },
  }),
  defineDivisionAction({
    id: 'ecoar',
    name: 'Ecoar',
    imoCost: 1,
    effect: 'Manual: causa 1d6 de dano extra em Imo.',
    imagePath: '/cartas/9.png',
  }),
  defineDivisionAction({
    id: 'equalizar',
    name: 'Equalizar',
    imoCost: 8,
    effect: 'Destroi uma carta na mao do alvo ao custo de 8 de Imo.',
    imagePath: '/cartas/10.png',
    useAutomation: {
      targetScope: 'selected-player',
      selection: 'target-hand-card',
      effects: [
        {
          type: 'destroySelectedHandCard',
          target: 'selected-player',
        },
      ],
    },
  }),
  defineDivisionAction({
    id: 'divisao',
    name: 'Divisao',
    imoCost: 2,
    effect:
      'Passa uma carta para o alvo ao custo de 2 de Imo. A automacao atual cobre cartas na mao; transferencias de Divisao seguem resolucao manual.',
    imagePath: '/cartas/11.png',
    useAutomation: {
      targetScope: 'selected-player',
      selection: 'own-hand-card',
      effects: [
        {
          type: 'moveSelectedOwnHandCardToTargetHand',
          target: 'selected-player',
        },
      ],
    },
  }),
  defineDivisionAction({
    id: 'maldicao',
    name: 'Maldicao',
    imoCost: 1,
    effect: 'Retorna uma carta do exilio proprio.',
    imagePath: '/cartas/12.png',
    useAutomation: {
      selection: 'own-exiled-card-id',
      effects: [
        {
          type: 'restoreSelectedExiledCardId',
          target: 'self',
        },
      ],
    },
  }),
  defineDivisionAction({
    id: 'exploracao',
    name: 'Exploracao',
    imoCost: 1,
    effect: 'Manual: o alvo selecionado recebe -1 em Combate por 1d3 turnos (nao cumulativo).',
    imagePath: '/cartas/13.png',
  }),
  defineDivisionAction({
    id: 'loucura',
    name: 'Loucura',
    imoCost: 1,
    effect: 'Manual: se voce exilou uma carta, outro jogador recupera todo o Imo.',
    imagePath: '/cartas/14.png',
  }),
  defineDivisionAction({
    id: 'esquema',
    name: 'Esquema',
    imoCost: 1,
    effect: 'Manual: recebe +2 no Fragmento desejado neste turno.',
    imagePath: '/cartas/15.png',
  }),
  defineDivisionAction({
    id: 'adrenalina',
    name: 'Adrenalina',
    imoCost: 1,
    effect: 'Manual: uma recuperacao fica 25% mais eficiente ou recupera 1d4 de Carne/Imo.',
    imagePath: '/cartas/16.png',
  }),
  defineDivisionAction({
    id: 'ferroada',
    name: 'Ferroada Ceifadora',
    imoCost: 3,
    effect:
      'Manual: pode tentar roubar uma carta do inimigo (Divisao ou Imo, de uso unico) gastando 3 de Imo e realizando um teste de Furor ou, com o mesmo custo, ao desferir um golpe tenha o dobro de dano e vantagem.',
    imagePath: '/cartas/18.png',
  }),
  defineDivisionAction({
    id: 'interromper',
    name: 'Interromper',
    imoCost: 0,
    effect: 'Ao custo de 3 de Imo, anule o complemento de uma acao inimiga (1x por turno).',
    imagePath: '',
    useAutomation: {
      targetScope: 'selected-enemy',
      effects: [
        {
          type: 'cancelComplementaryAction',
          target: 'selected-enemy',
        },
      ],
    },
  }),
  defineDivisionAction({
    id: 'memoria-seletiva',
    name: 'Memoria Seletiva',
    imoCost: 1,
    effect: 'Manual: conceda 2 de Percepcao para um alvo ate seu proximo turno.',
    imagePath: '',
  }),
];

const DIVISION_ACTION_BY_ID = new Map(DIVISION_ACTION_CATALOG.map((card) => [card.id, card]));
DIVISION_ACTION_BY_ID.set('ceifar', DIVISION_ACTION_BY_ID.get('ferroada'));

function getDivisionActionById(cardId) {
  return DIVISION_ACTION_BY_ID.get(cardId) || null;
}

function mapImoCardRecordToCatalogCard(record) {
  if (!record) {
    return null;
  }

  const automationConfig = normalizeCardAutomationConfig(record.automation_json);
  const card = {
    id: `imo:${record.id}`,
    sourceId: record.id,
    name: record.name,
    category: CARD_CATEGORIES.IMO,
    imoCost: record.imo_cost,
    effect: record.description,
    imagePath: record.image_path,
    isCustom: true,
    ...automationConfig,
  };

  if (Number.isInteger(Number(record.owner_id))) {
    card.catalogOwnerId = Number(record.owner_id);
  }

  return card;
}

module.exports = {
  CARD_CATEGORIES,
  DIVISION_ACTION_CATALOG,
  getDivisionActionById,
  mapImoCardRecordToCatalogCard,
};
