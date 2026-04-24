const {
  createDeck,
  listDecksByOwner,
  findDeckById,
  updateDeckById,
  deleteDeckById,
} = require('../models/deckModel');
const {
  createImoCard,
  listImoCardsByOwner,
  findImoCardById,
} = require('../models/imoCardModel');
const { AppError } = require('../utils/AppError');
const {
  CARD_CATALOG,
  CARD_CATEGORIES,
  DECK_RULES,
  getCardById,
  mapImoCardRecordToCatalogCard,
} = require('../config/cardsCatalog');

async function getDeckCatalog(ownerId) {
  const imoCards = await listImoCardsByOwner(ownerId);
  return [...CARD_CATALOG, ...imoCards.map(mapImoCardRecordToCatalogCard)];
}

function getDeckRules() {
  return DECK_RULES;
}

async function createImoCardForUser({ ownerId, name, description, imagePath, maxCopies, imoCost }) {
  const created = await createImoCard({
    ownerId,
    name,
    description,
    imagePath,
    maxCopies,
    imoCost,
  });

  return mapImoCardRecordToCatalogCard(created);
}

async function listImoCardsForUser(ownerId) {
  const cards = await listImoCardsByOwner(ownerId);
  return cards.map(mapImoCardRecordToCatalogCard);
}

async function createDeckForUser({ ownerId, name, description, cards }) {
  const normalizedCards = await normalizeAndValidateDeckCards({ ownerId, cards });

  const createdDeck = await createDeck({
    ownerId,
    name,
    description: description || null,
    cardsJson: normalizedCards,
  });

  return attachDeckSummary(createdDeck, ownerId);
}

async function listDecksForUser(ownerId) {
  const decks = await listDecksByOwner(ownerId);
  return Promise.all(decks.map((deck) => attachDeckSummary(deck, ownerId)));
}

async function getDeckForUser({ deckId, ownerId }) {
  const deck = await findDeckById(deckId);
  if (!deck || deck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  return attachDeckSummary(deck, ownerId);
}

async function updateDeckForUser({ deckId, ownerId, name, description, cards }) {
  const existingDeck = await findDeckById(deckId);
  if (!existingDeck || existingDeck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const normalizedCards = await normalizeAndValidateDeckCards({ ownerId, cards });

  const updatedDeck = await updateDeckById({
    deckId,
    ownerId,
    name,
    description: description || null,
    cardsJson: normalizedCards,
  });

  return attachDeckSummary(updatedDeck, ownerId);
}

async function deleteDeckForUser({ deckId, ownerId }) {
  const existingDeck = await findDeckById(deckId);
  if (!existingDeck || existingDeck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const deletedDeck = await deleteDeckById({ deckId, ownerId });
  return attachDeckSummary(deletedDeck, ownerId);
}

async function getResolvedDeckForUser({ deckId, ownerId }) {
  const deck = await findDeckById(deckId);
  if (!deck || deck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const catalog = await buildCatalogMap(ownerId);
  const expandedCards = [];

  for (const entry of deck.cards_json || []) {
    const card = catalog.get(entry.cardId);
    if (!card) {
      continue;
    }

    for (let index = 0; index < entry.quantity; index += 1) {
      expandedCards.push({
        ...card,
        instanceId: `${entry.cardId}#${index + 1}`,
      });
    }
  }

  return {
    deck,
    expandedCards,
  };
}

async function normalizeAndValidateDeckCards({ ownerId, cards }) {
  const entries = Array.isArray(cards) ? cards : [];
  if (!entries.length) {
    throw new AppError('O baralho precisa informar cartas.', 400);
  }

  const catalog = await buildCatalogMap(ownerId);
  const normalizedCards = [];
  const seenCardIds = new Set();

  const categoryTotals = {
    [CARD_CATEGORIES.FIXED]: 0,
    [CARD_CATEGORIES.DIVISION]: 0,
    [CARD_CATEGORIES.IMO]: 0,
  };

  let totalCards = 0;

  for (const entry of entries) {
    const cardId = String(entry.cardId || '').trim();
    const quantity = Number(entry.quantity);

    if (!cardId) {
      throw new AppError('Cada carta precisa de um cardId valido.', 400);
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(`Quantidade invalida para carta ${cardId}.`, 400);
    }

    if (seenCardIds.has(cardId)) {
      throw new AppError(`Carta duplicada no baralho: ${cardId}.`, 400);
    }

    const card = catalog.get(cardId);
    if (!card) {
      throw new AppError(`Carta desconhecida no catalogo: ${cardId}.`, 400);
    }

    if (quantity > card.maxCopies) {
      throw new AppError(`Carta ${card.name} excede o limite de ${card.maxCopies} copias.`, 400);
    }

    seenCardIds.add(cardId);
    totalCards += quantity;
    categoryTotals[card.category] += quantity;

    normalizedCards.push({
      cardId,
      quantity,
    });
  }

  if (totalCards < DECK_RULES.minCards || totalCards > DECK_RULES.maxCards) {
    throw new AppError(
      `Baralho invalido: total de cartas deve ficar entre ${DECK_RULES.minCards} e ${DECK_RULES.maxCards}.`,
      400
    );
  }

  if (categoryTotals[CARD_CATEGORIES.FIXED] < DECK_RULES.fixedMinCards) {
    throw new AppError(`Baralho invalido: minimo de ${DECK_RULES.fixedMinCards} cartas fixas.`, 400);
  }

  if (
    categoryTotals[CARD_CATEGORIES.DIVISION] < DECK_RULES.divisionMinCards ||
    categoryTotals[CARD_CATEGORIES.DIVISION] > DECK_RULES.divisionMaxCards
  ) {
    throw new AppError(
      `Baralho invalido: cartas de divisao devem ficar entre ${DECK_RULES.divisionMinCards} e ${DECK_RULES.divisionMaxCards}.`,
      400
    );
  }

  if (categoryTotals[CARD_CATEGORIES.IMO] > DECK_RULES.imoMaxCards) {
    throw new AppError(
      `Baralho invalido: cartas de imo devem ficar entre ${DECK_RULES.imoMinCards} e ${DECK_RULES.imoMaxCards}.`,
      400
    );
  }

  return normalizedCards;
}

async function buildCatalogMap(ownerId) {
  const map = new Map(CARD_CATALOG.map((card) => [card.id, card]));
  const imoCards = await listImoCardsForUser(ownerId);

  for (const card of imoCards) {
    map.set(card.id, card);
  }

  return map;
}

async function resolveCardById({ ownerId, cardId }) {
  if (String(cardId).startsWith('imo:')) {
    const rawId = Number(String(cardId).split(':')[1]);
    if (!Number.isInteger(rawId)) {
      return null;
    }

    const imoCard = await findImoCardById(rawId);
    if (!imoCard || imoCard.owner_id !== ownerId) {
      return null;
    }

    return mapImoCardRecordToCatalogCard(imoCard);
  }

  return getCardById(cardId);
}

function buildDeckSummary(entries, catalogMap) {
  const categoryTotals = {
    [CARD_CATEGORIES.FIXED]: 0,
    [CARD_CATEGORIES.DIVISION]: 0,
    [CARD_CATEGORIES.IMO]: 0,
  };

  let totalCards = 0;

  for (const entry of entries || []) {
    const card = catalogMap.get(entry.cardId);
    const quantity = Number(entry.quantity) || 0;
    totalCards += quantity;

    if (card) {
      categoryTotals[card.category] += quantity;
    }
  }

  return {
    totalCards,
    categoryTotals,
  };
}

async function attachDeckSummary(deck, ownerId) {
  if (!deck) {
    return deck;
  }

  const catalogMap = await buildCatalogMap(ownerId);

  return {
    ...deck,
    summary: buildDeckSummary(deck.cards_json, catalogMap),
  };
}

module.exports = {
  getDeckCatalog,
  getDeckRules,
  createImoCardForUser,
  listImoCardsForUser,
  createDeckForUser,
  listDecksForUser,
  getDeckForUser,
  updateDeckForUser,
  deleteDeckForUser,
  getResolvedDeckForUser,
  resolveCardById,
};
