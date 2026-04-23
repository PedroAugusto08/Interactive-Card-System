const {
  createDeck,
  listDecksByOwner,
  findDeckById,
  updateDeckById,
  deleteDeckById,
} = require('../models/deckModel');
const { AppError } = require('../utils/AppError');

// Cria deck para usuario autenticado.
async function createDeckForUser({ ownerId, name, description, cards }) {
  const createdDeck = await createDeck({
    ownerId,
    name,
    description: description || null,
    cardsJson: cards || [],
  });

  return createdDeck;
}

// Lista decks do usuario autenticado.
async function listDecksForUser(ownerId) {
  return listDecksByOwner(ownerId);
}

// Busca um deck do usuario.
async function getDeckForUser({ deckId, ownerId }) {
  const deck = await findDeckById(deckId);
  if (!deck || deck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  return deck;
}

// Atualiza um deck do usuario.
async function updateDeckForUser({ deckId, ownerId, name, description, cards }) {
  const existingDeck = await findDeckById(deckId);
  if (!existingDeck || existingDeck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const updatedDeck = await updateDeckById({
    deckId,
    ownerId,
    name,
    description: description || null,
    cardsJson: cards || [],
  });

  return updatedDeck;
}

// Remove um deck do usuario.
async function deleteDeckForUser({ deckId, ownerId }) {
  const existingDeck = await findDeckById(deckId);
  if (!existingDeck || existingDeck.owner_id !== ownerId) {
    throw new AppError('Deck nao encontrado.', 404);
  }

  const deletedDeck = await deleteDeckById({ deckId, ownerId });
  return deletedDeck;
}

module.exports = {
  createDeckForUser,
  listDecksForUser,
  getDeckForUser,
  updateDeckForUser,
  deleteDeckForUser,
};
