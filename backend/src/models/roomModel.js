const { query } = require('../config/db');

async function createRoom({ code, hostId, status = 'lobby', turnOrderDraft = [] }) {
  const result = await query(
    `
      INSERT INTO rooms (code, host_id, status, turn_order_draft_json)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, code, host_id, status, turn_order_draft_json, created_at;
    `,
    [code, hostId, status, JSON.stringify(turnOrderDraft)]
  );

  return result.rows[0];
}

async function updateRoomState({ roomId, hostId, status, turnOrderDraft }) {
  const result = await query(
    `
      UPDATE rooms
      SET
        host_id = COALESCE($2, host_id),
        status = COALESCE($3, status),
        turn_order_draft_json = COALESCE($4::jsonb, turn_order_draft_json)
      WHERE id = $1
      RETURNING id, code, host_id, status, turn_order_draft_json, created_at;
    `,
    [roomId, hostId ?? null, status ?? null, turnOrderDraft === undefined ? null : JSON.stringify(turnOrderDraft)]
  );

  return result.rows[0] || null;
}

async function findRoomByCode(code) {
  const result = await query(
    `
      SELECT id, code, host_id, status, turn_order_draft_json, created_at
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
      SELECT id, code, host_id, status, turn_order_draft_json, created_at
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
      SELECT r.id, r.code, r.host_id, r.status, r.turn_order_draft_json, r.created_at
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
      INSERT INTO room_players (room_id, user_id, selected_deck_ids_json)
      VALUES ($1, $2, '[]'::jsonb)
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
        rp.selected_deck_ids_json,
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
  selectedDeckIds = [],
  isReady = false,
  turnOrder = null,
}) {
  const nextSelectedDeckIds = Array.isArray(selectedDeckIds)
    ? selectedDeckIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const normalizedSelectedDeckId =
    Number.isInteger(Number(selectedDeckId)) && Number(selectedDeckId) > 0
      ? Number(selectedDeckId)
      : nextSelectedDeckIds[0] || null;

  const result = await query(
    `
      UPDATE room_players
      SET
        selected_deck_id = $3,
        selected_deck_ids_json = $4::jsonb,
        is_ready = $5,
        turn_order = $6
      WHERE room_id = $1 AND user_id = $2
      RETURNING room_id, user_id, selected_deck_id, selected_deck_ids_json, is_ready, turn_order, joined_at;
    `,
    [roomId, userId, normalizedSelectedDeckId, JSON.stringify(nextSelectedDeckIds), isReady, turnOrder]
  );

  return result.rows[0] || null;
}

async function resetRoomPlayersReady(roomId) {
  await query(
    `
      UPDATE room_players
      SET is_ready = FALSE
      WHERE room_id = $1;
    `,
    [roomId]
  );
}

async function clearRoomPlayerTurnOrders(roomId) {
  await query(
    `
      UPDATE room_players
      SET turn_order = NULL
      WHERE room_id = $1;
    `,
    [roomId]
  );
}

module.exports = {
  addPlayerToRoom,
  clearRoomPlayerTurnOrders,
  createRoom,
  findActiveRoomForUser,
  findRoomByCode,
  findRoomById,
  isPlayerInRoom,
  listRoomPlayers,
  removePlayerFromRoom,
  resetRoomPlayersReady,
  updateRoomPlayerState,
  updateRoomState,
};
