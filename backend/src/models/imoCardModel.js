const { query } = require('../config/db');

async function createImoCard({ ownerId, name, description, imagePath = null, maxCopies, imoCost }) {
  const result = await query(
    `
      INSERT INTO imo_cards (owner_id, name, description, image_path, max_copies, imo_cost)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, owner_id, name, description, image_path, max_copies, imo_cost, created_at, updated_at;
    `,
    [ownerId, name, description, imagePath, maxCopies, imoCost]
  );

  return result.rows[0] || null;
}

async function listImoCardsByOwner(ownerId) {
  const result = await query(
    `
      SELECT id, owner_id, name, description, image_path, max_copies, imo_cost, created_at, updated_at
      FROM imo_cards
      WHERE owner_id = $1
      ORDER BY created_at DESC;
    `,
    [ownerId]
  );

  return result.rows;
}

async function findImoCardById(cardId) {
  const result = await query(
    `
      SELECT id, owner_id, name, description, image_path, max_copies, imo_cost, created_at, updated_at
      FROM imo_cards
      WHERE id = $1
      LIMIT 1;
    `,
    [cardId]
  );

  return result.rows[0] || null;
}

module.exports = {
  createImoCard,
  listImoCardsByOwner,
  findImoCardById,
};
