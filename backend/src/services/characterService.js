const {
  createCharacter,
  deleteCharacterById,
  findCharacterById,
  listCharactersByOwner,
  updateCharacterById,
} = require('../models/characterModel');
const {
  createImoCard,
  listImoCardsByOwner,
  findImoCardById,
} = require('../models/imoCardModel');
const { AppError } = require('../utils/AppError');
const {
  CARD_CATEGORIES,
  DIVISION_ACTION_CATALOG,
  getDivisionActionById,
  mapImoCardRecordToCatalogCard,
} = require('../config/cardsCatalog');
const { canUserManageMultipleDecks } = require('./masterOverride');

async function getCharacterCatalog(ownerId) {
  const imoCards = await listImoCardsByOwner(ownerId);
  return [...DIVISION_ACTION_CATALOG, ...imoCards.map(mapImoCardRecordToCatalogCard)];
}

async function getCharacterCatalogSections(ownerId) {
  const catalog = await getCharacterCatalog(ownerId);
  return {
    divisions: catalog.filter((card) => card.category === CARD_CATEGORIES.DIVISION),
    imoCards: catalog.filter((card) => card.category === CARD_CATEGORIES.IMO),
  };
}

async function createImoCardForUser({
  ownerId,
  name,
  description,
  imagePath,
  imoCost,
  actionSlot,
  canExile,
  useAutomation,
  exileAutomation,
}) {
  const created = await createImoCard({
    ownerId,
    name,
    description,
    imagePath,
    maxCopies: 1,
    imoCost,
    automationJson: {
      actionSlot,
      canExile,
      useAutomation,
      exileAutomation,
    },
  });

  return mapImoCardRecordToCatalogCard(created);
}

async function listImoCardsForUser(ownerId) {
  const cards = await listImoCardsByOwner(ownerId);
  return cards.map(mapImoCardRecordToCatalogCard);
}

async function createCharacterForUser({ ownerId, name, description, divisionIds, imoCardIds, requesterUser = null }) {
  await assertUserCanCreateCharacter({ ownerId, requesterUser });
  const normalized = await normalizeAndValidateCharacterLoadout({ ownerId, divisionIds, imoCardIds });

  return createCharacter({
    ownerId,
    name,
    description: description || null,
    divisionIds: normalized.divisionIds,
    imoCardIds: normalized.imoCardIds,
  });
}

async function listCharactersForUser(ownerId) {
  return listCharactersByOwner(ownerId);
}

async function getCharacterForUser({ characterId, ownerId }) {
  const character = await findCharacterById(characterId);
  if (!character || character.owner_id !== ownerId) {
    throw new AppError('Personagem não encontrado.', 404);
  }

  return character;
}

async function updateCharacterForUser({
  characterId,
  ownerId,
  name,
  description,
  divisionIds,
  imoCardIds,
}) {
  const existing = await findCharacterById(characterId);
  if (!existing || existing.owner_id !== ownerId) {
    throw new AppError('Personagem não encontrado.', 404);
  }

  const normalized = await normalizeAndValidateCharacterLoadout({ ownerId, divisionIds, imoCardIds });
  return updateCharacterById({
    characterId,
    ownerId,
    name,
    description: description || null,
    divisionIds: normalized.divisionIds,
    imoCardIds: normalized.imoCardIds,
  });
}

async function deleteCharacterForUser({ characterId, ownerId }) {
  const existing = await findCharacterById(characterId);
  if (!existing || existing.owner_id !== ownerId) {
    throw new AppError('Personagem não encontrado.', 404);
  }

  return deleteCharacterById({ characterId, ownerId });
}

async function getResolvedCharacterForUser({ characterId, ownerId }) {
  const character = await getCharacterForUser({ characterId, ownerId });
  const catalogMap = await buildCatalogMap(ownerId);

  return {
    character,
    divisionCards: (character.division_ids_json || [])
      .map((cardId) => catalogMap.get(cardId))
      .filter(Boolean),
    imoCards: (character.imo_card_ids_json || [])
      .map((cardId) => catalogMap.get(cardId))
      .filter(Boolean),
  };
}

async function normalizeAndValidateCharacterLoadout({ ownerId, divisionIds, imoCardIds }) {
  const catalogMap = await buildCatalogMap(ownerId);
  const nextDivisionIds = normalizeStringList(divisionIds);
  const nextImoCardIds = normalizeStringList(imoCardIds);

  for (const divisionId of nextDivisionIds) {
    const card = catalogMap.get(divisionId);
    if (!card || card.category !== CARD_CATEGORIES.DIVISION) {
      throw new AppError(`Ação de Divisão desconhecida: ${divisionId}.`, 400);
    }
  }

  for (const imoCardId of nextImoCardIds) {
    const card = catalogMap.get(imoCardId);
    if (!card || card.category !== CARD_CATEGORIES.IMO) {
      throw new AppError(`Carta de Imo desconhecida: ${imoCardId}.`, 400);
    }
  }

  return {
    divisionIds: nextDivisionIds,
    imoCardIds: nextImoCardIds,
  };
}

async function buildCatalogMap(ownerId) {
  const map = new Map(DIVISION_ACTION_CATALOG.map((card) => [card.id, card]));
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

  return getDivisionActionById(cardId);
}

async function assertUserCanCreateCharacter({ ownerId, requesterUser = null }) {
  if (canUserManageMultipleDecks(requesterUser)) {
    return;
  }

  const existing = await listCharactersByOwner(ownerId);
  if (existing.length >= 1) {
    throw new AppError('Jogadores comuns podem ter apenas 1 personagem salvo.', 409);
  }
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

module.exports = {
  getCharacterCatalog,
  getCharacterCatalogSections,
  createImoCardForUser,
  listImoCardsForUser,
  createCharacterForUser,
  listCharactersForUser,
  getCharacterForUser,
  updateCharacterForUser,
  deleteCharacterForUser,
  getResolvedCharacterForUser,
  resolveCardById,
};
