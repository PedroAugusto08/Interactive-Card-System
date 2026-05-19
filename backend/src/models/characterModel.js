const { query } = require('../config/db');

const CHARACTER_SELECT_FIELDS = `
  id,
  owner_id,
  legacy_deck_id,
  name,
  description,
  division_id,
  base_carne,
  base_imo,
  combate,
  pontaria,
  resistencia,
  furor,
  percepcao,
  conhecimento,
  medicina,
  furtividade,
  improviso,
  mobilidade,
  division_ids_json,
  imo_card_ids_json,
  created_at,
  updated_at
`;

async function createCharacter({
  ownerId,
  name,
  description = null,
  divisionId = null,
  baseCarne = 5,
  baseImo = 5,
  fragments = {},
  divisionIds = [],
  imoCardIds = [],
}) {
  const result = await query(
    `
      INSERT INTO characters (
        owner_id,
        name,
        description,
        division_id,
        base_carne,
        base_imo,
        combate,
        pontaria,
        resistencia,
        furor,
        percepcao,
        conhecimento,
        medicina,
        furtividade,
        improviso,
        mobilidade,
        division_ids_json,
        imo_card_ids_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb)
      RETURNING ${CHARACTER_SELECT_FIELDS};
    `,
    [
      ownerId,
      name,
      description,
      divisionId,
      baseCarne,
      baseImo,
      fragments.combate,
      fragments.pontaria,
      fragments.resistencia,
      fragments.furor,
      fragments.percepcao,
      fragments.conhecimento,
      fragments.medicina,
      fragments.furtividade,
      fragments.improviso,
      fragments.mobilidade,
      JSON.stringify(divisionIds),
      JSON.stringify(imoCardIds),
    ]
  );

  return result.rows[0] || null;
}

async function listCharactersByOwner(ownerId) {
  const result = await query(
    `
      SELECT ${CHARACTER_SELECT_FIELDS}
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
      SELECT ${CHARACTER_SELECT_FIELDS}
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
      SELECT ${CHARACTER_SELECT_FIELDS}
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
  divisionId = null,
  baseCarne = 5,
  baseImo = 5,
  fragments = {},
  divisionIds = [],
  imoCardIds = [],
}) {
  const result = await query(
    `
      UPDATE characters
      SET
        name = $3,
        description = $4,
        division_id = $5,
        base_carne = $6,
        base_imo = $7,
        combate = $8,
        pontaria = $9,
        resistencia = $10,
        furor = $11,
        percepcao = $12,
        conhecimento = $13,
        medicina = $14,
        furtividade = $15,
        improviso = $16,
        mobilidade = $17,
        division_ids_json = $18::jsonb,
        imo_card_ids_json = $19::jsonb,
        updated_at = NOW()
      WHERE id = $1 AND owner_id = $2
      RETURNING ${CHARACTER_SELECT_FIELDS};
    `,
    [
      characterId,
      ownerId,
      name,
      description,
      divisionId,
      baseCarne,
      baseImo,
      fragments.combate,
      fragments.pontaria,
      fragments.resistencia,
      fragments.furor,
      fragments.percepcao,
      fragments.conhecimento,
      fragments.medicina,
      fragments.furtividade,
      fragments.improviso,
      fragments.mobilidade,
      JSON.stringify(divisionIds),
      JSON.stringify(imoCardIds),
    ]
  );

  return result.rows[0] || null;
}

async function deleteCharacterById({ characterId, ownerId }) {
  const result = await query(
    `
      DELETE FROM characters
      WHERE id = $1 AND owner_id = $2
      RETURNING ${CHARACTER_SELECT_FIELDS};
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
