const { z } = require('zod');

const characterService = require('../services/characterService');
const { cardAutomationConfigSchema } = require('../config/cardAutomation');

const characterIdParamSchema = z.object({
  characterId: z.coerce.number().int().positive(),
});

const stringIdListSchema = z.array(z.string().trim().min(1));

const createCharacterSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  divisionIds: stringIdListSchema,
  imoCardIds: stringIdListSchema,
});

const updateCharacterSchema = createCharacterSchema;

const createImoCardSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(5).max(1000),
  imagePath: z.string().trim().max(200000).optional(),
  imoCost: z.coerce.number().int().min(0).max(10),
  automation: cardAutomationConfigSchema.optional(),
});

async function getCatalog(req, res) {
  const sections = await characterService.getCharacterCatalogSections(req.user.id);
  return res.status(200).json({
    catalog: sections,
  });
}

async function listImoCards(req, res) {
  const cards = await characterService.listImoCardsForUser(req.user.id);
  return res.status(200).json({ cards });
}

async function createImoCard(req, res) {
  const payload = createImoCardSchema.parse(req.body);
  const automation = payload.automation || {};

  const card = await characterService.createImoCardForUser({
    ownerId: req.user.id,
    name: payload.name,
    description: payload.description,
    imagePath: payload.imagePath,
    imoCost: payload.imoCost,
    actionSlot: automation.actionSlot,
    canExile: automation.canExile,
    useAutomation: automation.useAutomation,
    exileAutomation: automation.exileAutomation,
  });

  return res.status(201).json({ card });
}

async function createCharacter(req, res) {
  const payload = createCharacterSchema.parse(req.body);
  const character = await characterService.createCharacterForUser({
    ownerId: req.user.id,
    name: payload.name,
    description: payload.description,
    divisionIds: payload.divisionIds,
    imoCardIds: payload.imoCardIds,
    requesterUser: req.user,
  });

  return res.status(201).json({ character });
}

async function listCharacters(req, res) {
  const characters = await characterService.listCharactersForUser(req.user.id);
  return res.status(200).json({ characters });
}

async function getCharacterById(req, res) {
  const { characterId } = characterIdParamSchema.parse(req.params);
  const character = await characterService.getCharacterForUser({
    characterId,
    ownerId: req.user.id,
  });

  return res.status(200).json({ character });
}

async function updateCharacter(req, res) {
  const { characterId } = characterIdParamSchema.parse(req.params);
  const payload = updateCharacterSchema.parse(req.body);
  const character = await characterService.updateCharacterForUser({
    characterId,
    ownerId: req.user.id,
    name: payload.name,
    description: payload.description,
    divisionIds: payload.divisionIds,
    imoCardIds: payload.imoCardIds,
  });

  return res.status(200).json({ character });
}

async function deleteCharacter(req, res) {
  const { characterId } = characterIdParamSchema.parse(req.params);
  const character = await characterService.deleteCharacterForUser({
    characterId,
    ownerId: req.user.id,
  });

  return res.status(200).json({ character });
}

module.exports = {
  createCharacter,
  createImoCard,
  deleteCharacter,
  getCatalog,
  getCharacterById,
  listCharacters,
  listImoCards,
  updateCharacter,
};
