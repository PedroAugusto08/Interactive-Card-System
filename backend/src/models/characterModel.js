const { query } = require('../config/db');

async function createCharacter({ ownerId, name, description = null, divisionIds = [], imoCardIds = [] }) {
  const result = await query(
    `
      INSERT INTO characters (owner_id, name, description, division_ids_json, imo_card_ids_json)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
      RETURNING
        id,
        owner_id,
        legacy_deck_id,
        name,
        description,
        division_ids_json,
        imo_card_ids_json,
        created_at,
        updated_at;
    `,
    [ownerId, name, description, JSON.stringify(divisionIds), JSON.stringify(imoCardIds)]
  );

  return result.rows[0] || null;
}

async function listCharactersByOwner(ownerId) {
  const result = await query(
    `
      SELECT
        id,
        owner_id,
        legacy_deck_id,
        name,
        description,
        division_ids_json,
        imo_card_ids_json,
        created_at,
        updated_at
      FROM characters
      WHERE owner_id = $1
      ORDER BY created_at DESC;
    `,
    [ownerId]
  );

  return result.rows;
}

async function listCharactersByIds(characterIds = []) {
  const normalizedIds = [...new Set((characterIds || []).map((value) => Number(value)).filter(Number.isInteger))];
  if (!normalizedIds.length) {
    return [];
  }

  const result = await query(
    `
      SELECT
        id,
        owner_id,
        legacy_deck_id,
        name,
        description,
        division_ids_json,
        imo_card_ids_json,
        created_at,
        updated_at
      FROM characters
      WHERE id = ANY($1::int[])
      ORDER BY created_at DESC;
    `,
    [normalizedIds]
  );

  return result.rows;
}

async function findCharacterById(characterId) {
  const result = await query(
    `
      SELECT
        id,
        owner_id,
        legacy_deck_id,
        name,
        description,
        division_ids_json,
        imo_card_ids_json,
        created_at,
        updated_at
      FROM characters
      WHERE id = $1
      LIMIT 1;
    `,
    [characterId]
  );

  return result.rows[0] || null;
}

async function updateCharacterById({
  characterId,
  ownerId,
  name,
  description = null,
  divisionIds = [],
  imoCardIds = [],
}) {
  const result = await query(
    `
      UPDATE characters
      SET
        name = $3,
        description = $4,
        division_ids_json = $5::jsonb,
        imo_card_ids_json = $6::jsonb,
        updated_at = NOW()
      WHERE id = $1 AND owner_id = $2
      RETURNING
        id,
        owner_id,
        legacy_deck_id,
        name,
        description,
        division_ids_json,
        imo_card_ids_json,
        created_at,
        updated_at;
    `,
    [characterId, ownerId, name, description, JSON.stringify(divisionIds), JSON.stringify(imoCardIds)]
  );

  return result.rows[0] || null;
}

async function deleteCharacterById({ characterId, ownerId }) {
  const result = await query(
    `
      DELETE FROM characters
      WHERE id = $1 AND owner_id = $2
      RETURNING
        id,
        owner_id,
        legacy_deck_id,
        name,
        description,
        division_ids_json,
        imo_card_ids_json,
        created_at,
        updated_at;
    `,
    [characterId, ownerId]
  );

  return result.rows[0] || null;
}

module.exports = {
  createCharacter,
  deleteCharacterById,
  findCharacterById,
  listCharactersByIds,
  listCharactersByOwner,
  updateCharacterById,
};
