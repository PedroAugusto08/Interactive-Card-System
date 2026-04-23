const { query } = require('../config/db');

// Cria deck para um usuario.
async function createDeck({ ownerId, name, description = null, cardsJson = [] }) {
  const result = await query(
    `
      INSERT INTO decks (owner_id, name, description, cards_json)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, owner_id, name, description, cards_json, created_at, updated_at;
    `,
    [ownerId, name, description, JSON.stringify(cardsJson)]
  );

  return result.rows[0];
}

// Lista todos os decks do dono em ordem de criacao.
async function listDecksByOwner(ownerId) {
  const result = await query(
    `
      SELECT id, owner_id, name, description, cards_json, created_at, updated_at
      FROM decks
      WHERE owner_id = $1
      ORDER BY created_at DESC;
    `,
    [ownerId]
  );

  return result.rows;
}

// Busca deck por id sem filtrar dono.
async function findDeckById(deckId) {
  const result = await query(
    `
      SELECT id, owner_id, name, description, cards_json, created_at, updated_at
      FROM decks
      WHERE id = $1
      LIMIT 1;
    `,
    [deckId]
  );

  return result.rows[0] || null;
}

// Atualiza deck do dono e devolve novo estado.
async function updateDeckById({ deckId, ownerId, name, description = null, cardsJson = [] }) {
  const result = await query(
    `
      UPDATE decks
      SET
        name = $3,
        description = $4,
        cards_json = $5::jsonb,
        updated_at = NOW()
      WHERE id = $1 AND owner_id = $2
      RETURNING id, owner_id, name, description, cards_json, created_at, updated_at;
    `,
    [deckId, ownerId, name, description, JSON.stringify(cardsJson)]
  );

  return result.rows[0] || null;
}

// Remove deck do dono.
async function deleteDeckById({ deckId, ownerId }) {
  const result = await query(
    `
      DELETE FROM decks
      WHERE id = $1 AND owner_id = $2
      RETURNING id, owner_id, name, description, cards_json, created_at, updated_at;
    `,
    [deckId, ownerId]
  );

  return result.rows[0] || null;
}

module.exports = {
  createDeck,
  listDecksByOwner,
  findDeckById,
  updateDeckById,
  deleteDeckById,
};
