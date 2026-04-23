const { z } = require('zod');

const deckService = require('../services/deckService');

// Valida cards como lista generica de objetos ou strings.
const cardsSchema = z.array(z.union([z.string(), z.record(z.any())])).default([]);

// Valida payload de criacao de deck.
const createDeckSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  cards: cardsSchema.optional(),
});

// Valida payload de atualizacao de deck.
const updateDeckSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  cards: cardsSchema.optional(),
});

// Valida id de deck na URL.
const deckIdParamSchema = z.object({
  deckId: z.coerce.number().int().positive(),
});

// Cria deck do usuario autenticado.
async function createDeck(req, res) {
  const payload = createDeckSchema.parse(req.body);
  const deck = await deckService.createDeckForUser({
    ownerId: req.user.id,
    name: payload.name,
    description: payload.description,
    cards: payload.cards,
  });

  return res.status(201).json({ deck });
}

// Lista decks do usuario autenticado.
async function listDecks(req, res) {
  const decks = await deckService.listDecksForUser(req.user.id);
  return res.status(200).json({ decks });
}

// Busca um deck especifico do usuario.
async function getDeckById(req, res) {
  const { deckId } = deckIdParamSchema.parse(req.params);
  const deck = await deckService.getDeckForUser({
    deckId,
    ownerId: req.user.id,
  });

  return res.status(200).json({ deck });
}

// Atualiza um deck especifico do usuario.
async function updateDeck(req, res) {
  const { deckId } = deckIdParamSchema.parse(req.params);
  const payload = updateDeckSchema.parse(req.body);

  const deck = await deckService.updateDeckForUser({
    deckId,
    ownerId: req.user.id,
    name: payload.name,
    description: payload.description,
    cards: payload.cards,
  });

  return res.status(200).json({ deck });
}

// Remove um deck especifico do usuario.
async function deleteDeck(req, res) {
  const { deckId } = deckIdParamSchema.parse(req.params);
  const deck = await deckService.deleteDeckForUser({
    deckId,
    ownerId: req.user.id,
  });

  return res.status(200).json({ deck });
}

module.exports = {
  createDeck,
  listDecks,
  getDeckById,
  updateDeck,
  deleteDeck,
};
