const { z } = require('zod');

const deckService = require('../services/deckService');

// Valida cada carta do deck com id e quantidade.
const cardEntrySchema = z.object({
  cardId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
});

// Valida lista de cartas do baralho.
const cardsSchema = z.array(cardEntrySchema).min(1);

// Valida payload de criacao de deck.
const createDeckSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  cards: cardsSchema,
});

// Valida payload de atualizacao de deck.
const updateDeckSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  cards: cardsSchema,
});

// Valida id de deck na URL.
const deckIdParamSchema = z.object({
  deckId: z.coerce.number().int().positive(),
});

// Retorna regras do sistema de baralho.
async function getDeckRules(req, res) {
  const rules = deckService.getDeckRules();
  return res.status(200).json({ rules });
}

// Retorna catalogo oficial de cartas.
async function getDeckCatalog(req, res) {
  const catalog = deckService.getDeckCatalog();
  return res.status(200).json({ catalog });
}

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
  getDeckRules,
  getDeckCatalog,
  createDeck,
  listDecks,
  getDeckById,
  updateDeck,
  deleteDeck,
};
