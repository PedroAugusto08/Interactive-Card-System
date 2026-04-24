const { query } = require('../config/db');

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

async function updateRoomState({ roomId, hostId, status }) {
  const result = await query(
    `
      UPDATE rooms
      SET
        host_id = $2,
        status = $3
      WHERE id = $1
      RETURNING id, code, host_id, status, created_at;
    `,
    [roomId, hostId, status]
  );

  return result.rows[0] || null;
}

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

async function findActiveRoomForUser(userId) {
  const result = await query(
    `
      SELECT r.id, r.code, r.host_id, r.status, r.created_at
      FROM room_players rp
      INNER JOIN rooms r ON r.id = rp.room_id
      WHERE rp.user_id = $1 AND r.status IN ('lobby', 'in_match')
      ORDER BY rp.joined_at DESC
      LIMIT 1;
    `,
    [userId]
  );

  return result.rows[0] || null;
}

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

async function removePlayerFromRoom({ roomId, userId }) {
  await query(
    `
      DELETE FROM room_players
      WHERE room_id = $1 AND user_id = $2;
    `,
    [roomId, userId]
  );
}

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

async function updateRoomPlayerState({
  roomId,
  userId,
  selectedDeckId = null,
  isReady = false,
  turnOrder = null,
}) {
  const result = await query(
    `
      UPDATE room_players
      SET
        selected_deck_id = $3,
        is_ready = $4,
        turn_order = $5
      WHERE room_id = $1 AND user_id = $2
      RETURNING room_id, user_id, selected_deck_id, is_ready, turn_order, joined_at;
    `,
    [roomId, userId, selectedDeckId, isReady, turnOrder]
  );

  return result.rows[0] || null;
}

async function assignRoomPlayerTurnOrders({ roomId, orderedUserIds }) {
  for (let index = 0; index < orderedUserIds.length; index += 1) {
    await query(
      `
        UPDATE room_players
        SET turn_order = $3
        WHERE room_id = $1 AND user_id = $2;
      `,
      [roomId, orderedUserIds[index], index + 1]
    );
  }
}

module.exports = {
  createRoom,
  updateRoomState,
  findRoomByCode,
  findRoomById,
  findActiveRoomForUser,
  addPlayerToRoom,
  removePlayerFromRoom,
  isPlayerInRoom,
  listRoomPlayers,
  updateRoomPlayerState,
  assignRoomPlayerTurnOrders,
};
