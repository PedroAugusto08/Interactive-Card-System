const {
  createDeck,
  listDecksByOwner,
  findDeckById,
  updateDeckById,
  deleteDeckById,
} = require('../models/deckModel');
const { AppError } = require('../utils/AppError');
const {
  CARD_CATALOG,
  CARD_CATEGORIES,
  DECK_RULES,
  getCardById,
} = require('../config/cardsCatalog');

// Exibe catalogo oficial de cartas para montar o baralho.
function getDeckCatalog() {
  return CARD_CATALOG;
}

// Exibe regras de composicao do baralho.
function getDeckRules() {
  return DECK_RULES;
}

// Cria deck para usuario autenticado.
async function createDeckForUser({ ownerId, name, description, cards }) {
  const normalizedCards = normalizeAndValidateDeckCards(cards);

  const createdDeck = await createDeck({
    ownerId,
    name,
    description: description || null,
    cardsJson: normalizedCards,
  });

  return attachDeckSummary(createdDeck);
}

// Lista decks do usuario autenticado.
async function listDecksForUser(ownerId) {
  const decks = await listDecksByOwner(ownerId);
  return decks.map(attachDeckSummary);
}

// Busca um deck do usuario.
async function getDeckForUser({ deckId, ownerId }) {
  const deck = await findDeckById(deckId);
  if (!deck || deck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  return attachDeckSummary(deck);
}

// Atualiza um deck do usuario.
async function updateDeckForUser({ deckId, ownerId, name, description, cards }) {
  const existingDeck = await findDeckById(deckId);
  if (!existingDeck || existingDeck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const normalizedCards = normalizeAndValidateDeckCards(cards);

  const updatedDeck = await updateDeckById({
    deckId,
    ownerId,
    name,
    description: description || null,
    cardsJson: normalizedCards,
  });

  return attachDeckSummary(updatedDeck);
}

// Remove um deck do usuario.
async function deleteDeckForUser({ deckId, ownerId }) {
  const existingDeck = await findDeckById(deckId);
  if (!existingDeck || existingDeck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const deletedDeck = await deleteDeckById({ deckId, ownerId });
  return attachDeckSummary(deletedDeck);
}

// Valida e normaliza cartas recebidas no payload de deck.
function normalizeAndValidateDeckCards(cards) {
  const entries = Array.isArray(cards) ? cards : [];
  if (!entries.length) {
    throw new AppError('O baralho precisa informar cartas.', 400);
  }

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

    const card = getCardById(cardId);
    if (!card) {
      throw new AppError(`Carta desconhecida no catalogo: ${cardId}.`, 400);
    }

    if (quantity > card.maxCopies) {
      throw new AppError(
        `Carta ${card.name} excede o limite de ${card.maxCopies} copias.`,
        400
      );
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
    throw new AppError(
      `Baralho invalido: minimo de ${DECK_RULES.fixedMinCards} cartas fixas.`,
      400
    );
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

// Calcula totais uteis para inspecao rapida do deck.
function buildDeckSummary(cardsJson) {
  const entries = Array.isArray(cardsJson) ? cardsJson : [];

  const categoryTotals = {
    [CARD_CATEGORIES.FIXED]: 0,
    [CARD_CATEGORIES.DIVISION]: 0,
    [CARD_CATEGORIES.IMO]: 0,
  };

  let totalCards = 0;

  for (const entry of entries) {
    const card = getCardById(entry.cardId);
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

// Anexa metadados de resumo sem alterar o registro do banco.
function attachDeckSummary(deck) {
  if (!deck) {
    return deck;
  }

  return {
    ...deck,
    summary: buildDeckSummary(deck.cards_json),
  };
}

module.exports = {
  getDeckCatalog,
  getDeckRules,
  createDeckForUser,
  listDecksForUser,
  getDeckForUser,
  updateDeckForUser,
  deleteDeckForUser,
};
