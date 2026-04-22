const { query } = require('../config/db');

// Cria uma sala nova no banco.
async function createRoom({ code, hostId, status = 'lobby' }) {
  const result = await query(
    `
      INSERT INTO rooms (code, host_id, status)
      VALUES ($1, $2, $3)
      RETURNING id, code, host_id, status, created_at;
    `,
    [code, hostId, status]
  );

  return result.rows[0];
}

// Busca sala pelo codigo curto compartilhado entre jogadores.
async function findRoomByCode(code) {
  const result = await query(
    `
      SELECT id, code, host_id, status, created_at
      FROM rooms
      WHERE code = $1
      LIMIT 1;
    `,
    [code]
  );

  return result.rows[0] || null;
}

// Busca sala pelo id interno.
async function findRoomById(roomId) {
  const result = await query(
    `
      SELECT id, code, host_id, status, created_at
      FROM rooms
      WHERE id = $1
      LIMIT 1;
    `,
    [roomId]
  );

  return result.rows[0] || null;
}

// Adiciona jogador na sala sem duplicar entrada.
async function addPlayerToRoom({ roomId, userId }) {
  await query(
    `
      INSERT INTO room_players (room_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (room_id, user_id) DO NOTHING;
    `,
    [roomId, userId]
  );
}

// Remove jogador da sala.
async function removePlayerFromRoom({ roomId, userId }) {
  await query(
    `
      DELETE FROM room_players
      WHERE room_id = $1 AND user_id = $2;
    `,
    [roomId, userId]
  );
}

// Verifica se um jogador ja esta na sala.
async function isPlayerInRoom({ roomId, userId }) {
  const result = await query(
    `
      SELECT 1
      FROM room_players
      WHERE room_id = $1 AND user_id = $2
      LIMIT 1;
    `,
    [roomId, userId]
  );

  return result.rowCount > 0;
}

// Lista jogadores da sala com dados basicos do usuario.
async function listRoomPlayers(roomId) {
  const result = await query(
    `
      SELECT
        rp.room_id,
        rp.user_id,
        rp.selected_deck_id,
        rp.is_ready,
        rp.turn_order,
        rp.joined_at,
        u.username,
        u.email
      FROM room_players rp
      INNER JOIN users u ON u.id = rp.user_id
      WHERE rp.room_id = $1
      ORDER BY rp.joined_at ASC;
    `,
    [roomId]
  );

  return result.rows;
}

module.exports = {
  createRoom,
  findRoomByCode,
  findRoomById,
  addPlayerToRoom,
  removePlayerFromRoom,
  isPlayerInRoom,
  listRoomPlayers,
};
