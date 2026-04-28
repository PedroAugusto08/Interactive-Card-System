const { z } = require('zod');

const deckService = require('../services/deckService');
const { cardAutomationConfigSchema } = require('../config/cardAutomation');

const cardEntrySchema = z.object({
  cardId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
});

const cardsSchema = z.array(cardEntrySchema).min(1);

const createDeckSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  cards: cardsSchema,
});

const updateDeckSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  cards: cardsSchema,
});

const createImoCardSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(5).max(1000),
  imagePath: z.string().trim().max(200000).optional(),
  maxCopies: z.coerce.number().int().min(1).max(5),
  imoCost: z.coerce.number().int().min(0).max(10),
  automation: cardAutomationConfigSchema.optional(),
});

const deckIdParamSchema = z.object({
  deckId: z.coerce.number().int().positive(),
});

async function getDeckRules(req, res) {
  const rules = deckService.getDeckRules();
  return res.status(200).json({ rules });
}

async function getDeckCatalog(req, res) {
  const catalog = await deckService.getDeckCatalog(req.user.id);
  return res.status(200).json({ catalog });
}

async function listImoCards(req, res) {
  const cards = await deckService.listImoCardsForUser(req.user.id);
  return res.status(200).json({ cards });
}

async function createImoCard(req, res) {
  const payload = createImoCardSchema.parse(req.body);
  const card = await deckService.createImoCardForUser({
    ownerId: req.user.id,
    name: payload.name,
    description: payload.description,
    imagePath: payload.imagePath,
    maxCopies: payload.maxCopies,
    imoCost: payload.imoCost,
    automation: payload.automation,
  });

  return res.status(201).json({ card });
}

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

async function listDecks(req, res) {
  const decks = await deckService.listDecksForUser(req.user.id);
  return res.status(200).json({ decks });
}

async function getDeckById(req, res) {
  const { deckId } = deckIdParamSchema.parse(req.params);
  const deck = await deckService.getDeckForUser({
    deckId,
    ownerId: req.user.id,
  });

  return res.status(200).json({ deck });
}

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
  listImoCards,
  createImoCard,
  createDeck,
  listDecks,
  getDeckById,
  updateDeck,
  deleteDeck,
};
