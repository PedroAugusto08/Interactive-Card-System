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
    effect: 'Recarrega toda a munição ou recupera a arma quebrada do personagem.',
    imagePath: '/cartas/6.png',
  }),
  defineDivisionAction({
    id: 'destruir',
    name: 'Destruir',
    imoCost: 1,
    effect: 'Consome 1 de Carne para amplificar o próximo dano causado pelo personagem.',
    imagePath: '/cartas/7.png',
  }),
  defineDivisionAction({
    id: 'visualizar',
    name: 'Visualizar',
    imoCost: 1,
    effect: 'Visualiza privadamente uma carta aleatória da mão de um alvo selecionado.',
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
    effect: 'Retira uma carta do próprio exílio e a libera novamente para geração.',
    imagePath: '/cartas/9.png',
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
    id: 'equalizar',
    name: 'Equalizar',
    imoCost: 1,
    effect: 'Manual: desestabiliza o fluxo de Imo do alvo ou reequilibra o exílio de um aliado.',
    imagePath: '/cartas/10.png',
  }),
  defineDivisionAction({
    id: 'divisao',
    name: 'Divisão',
    imoCost: 1,
    effect: 'Passa uma carta da própria mão para a mão de um alvo selecionado.',
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
    name: 'Maldição',
    imoCost: 3,
    effect: 'Manual: amaldiçoa o corpo do personagem em troca de um efeito de alto risco.',
    imagePath: '/cartas/12.png',
  }),
  defineDivisionAction({
    id: 'exploracao',
    name: 'Exploração',
    imoCost: 1,
    effect: 'Manual: enfraquece um alvo e reposiciona o fluxo de Imo da cena.',
    imagePath: '/cartas/13.png',
  }),
  defineDivisionAction({
    id: 'loucura',
    name: 'Loucura',
    imoCost: 1,
    effect: 'Manual: instala uma distorção mental temporária sobre o alvo.',
    imagePath: '/cartas/14.png',
  }),
  defineDivisionAction({
    id: 'esquema',
    name: 'Esquema',
    imoCost: 1,
    effect: 'Destrói uma carta específica da mão do alvo selecionado.',
    imagePath: '/cartas/15.png',
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
    id: 'adrenalina',
    name: 'Adrenalina',
    imoCost: 1,
    effect: 'Manual: impulsiona a recuperação física e mental do personagem.',
    imagePath: '/cartas/16.png',
  }),
  defineDivisionAction({
    id: 'ceifar',
    name: 'Ceifar',
    imoCost: 1,
    effect: 'Manual: potencializa a próxima agressão ou roubo de recursos do alvo.',
    imagePath: '/cartas/17.png',
  }),
  defineDivisionAction({
    id: 'ferroada',
    name: 'Ferroada',
    imoCost: 1,
    effect: 'Manual: desfere um golpe brutal e pode ser combinado com o gerenciamento tático do exílio.',
    imagePath: '/cartas/18.png',
  }),
];

const DIVISION_ACTION_BY_ID = new Map(DIVISION_ACTION_CATALOG.map((card) => [card.id, card]));

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
