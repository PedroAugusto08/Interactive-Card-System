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
const {
  getDivisionById,
  getDivisionCatalogEntries,
  hydrateDivision,
  inferDivisionIdFromActionIds,
} = require('../config/divisionCatalog');
const { canUserManageMultipleDecks } = require('./masterOverride');

async function getCharacterCatalog(ownerId) {
  const imoCards = await listImoCardsByOwner(ownerId);
  return {
    divisions: getDivisionCatalogEntries(),
    imoCards: imoCards.map(mapImoCardRecordToCatalogCard),
  };
}

async function getCharacterCatalogSections(ownerId) {
  return getCharacterCatalog(ownerId);
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

async function createCharacterForUser({ ownerId, name, description, divisionId, imoCardIds, requesterUser = null }) {
  await assertUserCanCreateCharacter({ ownerId, requesterUser });
  const normalized = await normalizeAndValidateCharacterLoadout({ ownerId, divisionId, imoCardIds });

  const created = await createCharacter({
    ownerId,
    name,
    description: description || null,
    divisionId: normalized.divisionId,
    divisionIds: normalized.divisionIds,
    imoCardIds: normalized.imoCardIds,
  });

  return serializeCharacterRecord(created);
}

async function listCharactersForUser(ownerId) {
  const characters = await listCharactersByOwner(ownerId);
  return characters.map(serializeCharacterRecord);
}

async function getCharacterForUser({ characterId, ownerId }) {
  const character = await findCharacterById(characterId);
  if (!character || character.owner_id !== ownerId) {
    throw new AppError('Personagem não encontrado.', 404);
  }

  return serializeCharacterRecord(character);
}

async function updateCharacterForUser({
  characterId,
  ownerId,
  name,
  description,
  divisionId,
  imoCardIds,
}) {
  const existing = await findCharacterById(characterId);
  if (!existing || existing.owner_id !== ownerId) {
    throw new AppError('Personagem não encontrado.', 404);
  }

  const normalized = await normalizeAndValidateCharacterLoadout({ ownerId, divisionId, imoCardIds });
  const updated = await updateCharacterById({
    characterId,
    ownerId,
    name,
    description: description || null,
    divisionId: normalized.divisionId,
    divisionIds: normalized.divisionIds,
    imoCardIds: normalized.imoCardIds,
  });

  return serializeCharacterRecord(updated);
}

async function deleteCharacterForUser({ characterId, ownerId }) {
  const existing = await findCharacterById(characterId);
  if (!existing || existing.owner_id !== ownerId) {
    throw new AppError('Personagem não encontrado.', 404);
  }

  const deleted = await deleteCharacterById({ characterId, ownerId });
  return serializeCharacterRecord(deleted);
}

async function getResolvedCharacterForUser({ characterId, ownerId }) {
  const character = await getCharacterForUser({ characterId, ownerId });
  const catalogMap = await buildCatalogMap(ownerId);
  const division = getCharacterDivision(character);

  return {
    character,
    division,
    divisionCards: (division?.actionIds || [])
      .map((cardId) => catalogMap.get(cardId) || getDivisionActionById(cardId))
      .filter(Boolean),
    imoCards: (character.imo_card_ids_json || [])
      .map((cardId) => catalogMap.get(cardId))
      .filter(Boolean),
  };
}

async function normalizeAndValidateCharacterLoadout({ ownerId, divisionId, imoCardIds }) {
  const catalogMap = await buildCatalogMap(ownerId);
  const normalizedDivisionId = String(divisionId || '').trim();
  const nextImoCardIds = normalizeStringList(imoCardIds);
  const division = getDivisionById(normalizedDivisionId);

  if (!division) {
    throw new AppError('Escolha uma Divisão válida para o personagem.', 400);
  }

  if (nextImoCardIds.length !== Number(division.imoCardSlots || 0)) {
    throw new AppError(
      `A Divisão ${division.name} exige exatamente ${division.imoCardSlots} carta(s) de Imo no personagem.`,
      400
    );
  }

  for (const imoCardId of nextImoCardIds) {
    const card = catalogMap.get(imoCardId);
    if (!card || card.category !== CARD_CATEGORIES.IMO) {
      throw new AppError(`Carta de Imo desconhecida: ${imoCardId}.`, 400);
    }
  }

  return {
    divisionId: division.id,
    divisionIds: [...division.actionIds],
    imoCardIds: nextImoCardIds,
  };
}

async function buildCatalogMap(ownerId) {
  const map = new Map(DIVISION_ACTION_CATALOG.map((card) => [card.id, card]));
  const legacyCeifar = getDivisionActionById('ceifar');
  if (legacyCeifar) {
    map.set('ceifar', legacyCeifar);
  }
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

function getCharacterDivision(character) {
  const divisionId = String(character?.division_id || '').trim() || inferDivisionIdFromActionIds(character?.division_ids_json || []);
  return hydrateDivision(getDivisionById(divisionId));
}

function serializeCharacterRecord(character) {
  if (!character) {
    return null;
  }

  const division = getCharacterDivision(character);
  return {
    ...character,
    division_id: division?.id || String(character.division_id || '').trim() || null,
    division_ids_json: division?.actionIds || character.division_ids_json || [],
    division: division
      ? {
          id: division.id,
          name: division.name,
          passive: division.passive,
          imoCardSlots: division.imoCardSlots,
          actionIds: division.actionIds,
          cards: division.cards,
        }
      : null,
  };
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
  __testables: {
    getCharacterDivision,
    serializeCharacterRecord,
  },
};
