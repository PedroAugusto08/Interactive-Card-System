const { normalizeCardAutomationConfig } = require('./cardAutomation');

const CARD_CATEGORIES = {
  FIXED: 'fixed',
  DIVISION: 'division',
  IMO: 'imo',
};

const DECK_RULES = {
  minCards: 15,
  maxCards: 25,
  fixedDefaultCards: 10,
  fixedMinCards: 10,
  divisionMinCards: 5,
  divisionMaxCards: 10,
  imoMinCards: 0,
  imoMaxCards: 5,
};

function defineCard(card) {
  return {
    ...normalizeCardAutomationConfig(),
    ...card,
  };
}

const CARD_CATALOG = [
  defineCard({
    id: 'ataque_normal',
    name: 'Ataque Normal',
    category: CARD_CATEGORIES.FIXED,
    maxCopies: 5,
    imoCost: 0,
    effect:
      'Ao jogar esta carta, o jogador desfere um golpe com Combate ou Pontaria, usando a arma em maos (ou os punhos). Ao ser descartada, esta carta gera a carta Reacao em sua mao.',
    imagePath: '/cartas/1.png',
    discardAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'reacao',
        },
      ],
    },
  }),
  defineCard({
    id: 'ataque_especial',
    name: 'Ataque Especial',
    category: CARD_CATEGORIES.FIXED,
    maxCopies: 3,
    imoCost: 0,
    effect:
      'Ao jogar esta carta, o jogador desfere um golpe com vantagem de +1 dado com Combate ou Pontaria, usando a arma em maos (ou os punhos). Ao ser descartada, esta carta gera a carta Reacao em sua mao e cura 1 de Carne.',
    imagePath: '/cartas/2.png',
    discardAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'reacao',
        },
      ],
    },
  }),
  defineCard({
    id: 'reacao',
    name: 'Reacao',
    category: CARD_CATEGORIES.FIXED,
    maxCopies: 4,
    imoCost: 0,
    effect:
      'Esta carta deve ser jogada quando um golpe for direcionado ao alvo. O jogador deve superar o ataque com um teste de Resistencia ou Percepcao. Com sucesso, pode jogar ou descartar uma carta em resposta e evitar o golpe.',
    imagePath: '/cartas/3.png',
  }),
  defineCard({
    id: 'movimento',
    name: 'Movimento',
    category: CARD_CATEGORIES.FIXED,
    maxCopies: 4,
    imoCost: 0,
    effect:
      'Esta carta pode ser jogada junto a outra carta. Ao jogar, o personagem se movimenta em ate 1 metro em alguma direcao. Ao descartar esta carta, o jogador recupera +1d3 em Carne.',
    imagePath: '/cartas/4.png',
    canPlayTogether: true,
  }),
  defineCard({
    id: 'concentrar',
    name: 'Concentrar',
    category: CARD_CATEGORIES.FIXED,
    maxCopies: 3,
    imoCost: 0,
    effect:
      'Ao jogar, o personagem nao pode jogar uma carta de movimento neste e no proximo turno. Alem disso, recupera +1d4 de Carne ou Imo. Ao descartar esta carta, o jogador recupera uma carta exilada.',
    imagePath: '/cartas/5.png',
    discardAutomation: {
      selection: 'own-exile-card',
      effects: [
        {
          type: 'moveSelectedExileCardToHand',
          excludeCurrentCard: true,
        },
      ],
    },
  }),
  defineCard({
    id: 'recarregar',
    name: 'Recarregar',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 2,
    imoCost: 1,
    effect:
      'Ao jogar, o personagem recarrega toda municao ou recupera sua arma branca quebrada. Ao descartar, o jogador compra uma carta de Ataque Especial.',
    imagePath: '/cartas/6.png',
    discardAutomation: {
      effects: [
        {
          type: 'gainCatalogCardToHand',
          cardId: 'ataque_especial',
        },
      ],
    },
  }),
  defineCard({
    id: 'destruir',
    name: 'Destruir',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 2,
    imoCost: 1,
    effect:
      'Ao jogar, o personagem consome 1 de Carne para dobrar o dano da proxima carta jogada.',
    imagePath: '/cartas/7.png',
  }),
  defineCard({
    id: 'visualizar',
    name: 'Visualizar',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 2,
    imoCost: 1,
    effect:
      'Pode ser jogada junto com outra carta. Ao jogar, visualiza (podendo revelar) o topo do baralho de um alvo selecionado. Ao descartar, exila a carta do topo do seu baralho.',
    imagePath: '/cartas/8.png',
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
          type: 'moveTopDeckToExile',
          target: 'self',
        },
      ],
    },
  }),
  defineCard({
    id: 'ecoar',
    name: 'Ecoar',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 1,
    imoCost: 1,
    effect:
      'Pode ser jogada junto com outra carta. Ao jogar, cause 1d6 de Dano em Imo no alvo selecionado. Ao descartar, retorna a carta do topo do exilio para seu baralho.',
    imagePath: '/cartas/9.png',
    canPlayTogether: true,
    discardAutomation: {
      effects: [
        {
          type: 'moveTopExileToDeck',
          target: 'self',
          shuffleIntoDeck: true,
        },
      ],
    },
  }),
  defineCard({
    id: 'equalizar',
    name: 'Equalizar',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 2,
    imoCost: 1,
    effect:
      'Pode ser jogada junto com outra carta. Ao jogar, exile a carta no topo do baralho do alvo. Ao descartar, retorna a carta do topo do exilio de um alvo aliado para seu baralho.',
    imagePath: '/cartas/10.png',
    canPlayTogether: true,
    playAutomation: {
      targetScope: 'selected-player',
      effects: [
        {
          type: 'moveTopDeckToExile',
          target: 'selected-player',
        },
      ],
    },
    discardAutomation: {
      targetScope: 'other-player',
      effects: [
        {
          type: 'moveTopExileToDeck',
          target: 'selected-player',
          shuffleIntoDeck: true,
        },
      ],
    },
  }),
  defineCard({
    id: 'divisao',
    name: 'Divisao',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 3,
    imoCost: 1,
    effect:
      'Ao jogar, gaste 1 de Imo para passar uma carta de sua mao, a sua escolha, para um alvo. Ao descartar, visualize uma carta aleatoria da mao de um alvo.',
    imagePath: '/cartas/11.png',
  }),
  defineCard({
    id: 'maldicao',
    name: 'Maldicao',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 1,
    imoCost: 3,
    effect:
      'Enquanto estiver na mao, cause 3 de dano em Carne em si mesmo. Ao jogar, gaste 3 de Imo. Nao pode ser descartada.',
    imagePath: '/cartas/12.png',
    canDiscard: false,
  }),
  defineCard({
    id: 'exploracao',
    name: 'Exploracao',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 3,
    imoCost: 1,
    effect:
      'Enquanto estiver na mao, o alvo selecionado possui -1 em Combate. Ao jogar, recebe 1 de Imo temporario. Nao pode ser descartada.',
    imagePath: '/cartas/13.png',
    canDiscard: false,
  }),
  defineCard({
    id: 'loucura',
    name: 'Loucura',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 1,
    imoCost: 1,
    effect:
      'Enquanto estiver na mao, o alvo selecionado possui -1 em Conhecimento. Ao jogar, recebe 1 de Carne temporario. Ao descartar, escolha outro alvo para comprar uma carta.',
    imagePath: '/cartas/14.png',
    discardAutomation: {
      targetScope: 'other-player',
      effects: [
        {
          type: 'drawTopDeckToHand',
          target: 'selected-player',
        },
      ],
    },
  }),
  defineCard({
    id: 'esquema',
    name: 'Esquema',
    category: CARD_CATEGORIES.DIVISION,
    maxCopies: 2,
    imoCost: 1,
    effect:
      'Ao tornar-se Corrompida e estiver na mao, cure o alvo em 2 de Imo. Ao jogar, destrua uma carta na mao do alvo selecionado. Ao descartar, compre uma carta.',
    imagePath: '/cartas/15.png',
    discardAutomation: {
      effects: [
        {
          type: 'drawTopDeckToHand',
          target: 'self',
        },
      ],
    },
  }),
];

const CARD_BY_ID = new Map(CARD_CATALOG.map((card) => [card.id, card]));

function getCardById(cardId) {
  return CARD_BY_ID.get(cardId) || null;
}

function mapImoCardRecordToCatalogCard(record) {
  if (!record) {
    return null;
  }

  const automationConfig = normalizeCardAutomationConfig(record.automation_json);

  return {
    id: `imo:${record.id}`,
    sourceId: record.id,
    name: record.name,
    category: CARD_CATEGORIES.IMO,
    maxCopies: record.max_copies,
    imoCost: record.imo_cost,
    effect: record.description,
    imagePath: record.image_path,
    isCustom: true,
    ...automationConfig,
  };
}

module.exports = {
  CARD_CATEGORIES,
  DECK_RULES,
  CARD_CATALOG,
  getCardById,
  mapImoCardRecordToCatalogCard,
};
