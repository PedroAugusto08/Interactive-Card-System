const { query } = require('../config/db');

async function createMatch({ roomId, currentTurnPlayerId }) {
  const result = await query(
    `
      INSERT INTO matches (room_id, current_turn_player_id)
      VALUES ($1, $2)
      RETURNING id, room_id, status, round, current_turn_player_id, winner_user_id, started_at, ended_at, created_at;
    `,
    [roomId, currentTurnPlayerId]
  );

  return result.rows[0] || null;
}

async function findActiveMatchByRoomId(roomId) {
  const result = await query(
    `
      SELECT id, room_id, status, round, current_turn_player_id, winner_user_id, started_at, ended_at, created_at
      FROM matches
      WHERE room_id = $1 AND status = 'active'
      LIMIT 1;
    `,
    [roomId]
  );

  return result.rows[0] || null;
}

async function findMatchById(matchId) {
  const result = await query(
    `
      SELECT id, room_id, status, round, current_turn_player_id, winner_user_id, started_at, ended_at, created_at
      FROM matches
      WHERE id = $1
      LIMIT 1;
    `,
    [matchId]
  );

  return result.rows[0] || null;
}

async function updateMatchState({ matchId, status, round, currentTurnPlayerId, winnerUserId, endedAt = null }) {
  const result = await query(
    `
      UPDATE matches
      SET
        status = $2,
        round = $3,
        current_turn_player_id = $4,
        winner_user_id = $5,
        ended_at = $6
      WHERE id = $1
      RETURNING id, room_id, status, round, current_turn_player_id, winner_user_id, started_at, ended_at, created_at;
    `,
    [matchId, status, round, currentTurnPlayerId, winnerUserId, endedAt]
  );

  return result.rows[0] || null;
}

async function upsertMatchPlayer({
  matchId,
  userId,
  turnOrder,
  health = 10,
  imo = 3,
  maxImo = 10,
  hasDrawnThisTurn = false,
  hasUsedCardActionThisTurn = false,
  isDefeated = false,
  deckCards = [],
  handCards = [],
  discardCards = [],
  exileCards = [],
}) {
  const result = await query(
    `
      INSERT INTO match_players (
        match_id,
        user_id,
        turn_order,
        health,
        imo,
        max_imo,
        has_drawn_this_turn,
        has_used_card_action_this_turn,
        is_defeated,
        deck_cards_json,
        hand_cards_json,
        discard_cards_json,
        exile_cards_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb)
      ON CONFLICT (match_id, user_id)
      DO UPDATE SET
        turn_order = EXCLUDED.turn_order,
        health = EXCLUDED.health,
        imo = EXCLUDED.imo,
        max_imo = EXCLUDED.max_imo,
        has_drawn_this_turn = EXCLUDED.has_drawn_this_turn,
        has_used_card_action_this_turn = EXCLUDED.has_used_card_action_this_turn,
        is_defeated = EXCLUDED.is_defeated,
        deck_cards_json = EXCLUDED.deck_cards_json,
        hand_cards_json = EXCLUDED.hand_cards_json,
        discard_cards_json = EXCLUDED.discard_cards_json,
        exile_cards_json = EXCLUDED.exile_cards_json
      RETURNING
        match_id,
        user_id,
        turn_order,
        health,
        imo,
        max_imo,
        has_drawn_this_turn,
        has_used_card_action_this_turn,
        is_defeated,
        deck_cards_json,
        hand_cards_json,
        discard_cards_json,
        exile_cards_json;
    `,
    [
      matchId,
      userId,
      turnOrder,
      health,
      imo,
      maxImo,
      hasDrawnThisTurn,
      hasUsedCardActionThisTurn,
      isDefeated,
      JSON.stringify(deckCards),
      JSON.stringify(handCards),
      JSON.stringify(discardCards),
      JSON.stringify(exileCards),
    ]
  );

  return result.rows[0] || null;
}

async function listMatchPlayers(matchId) {
  const result = await query(
    `
      SELECT
        mp.match_id,
        mp.user_id,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_drawn_this_turn,
        mp.has_used_card_action_this_turn,
        mp.is_defeated,
        mp.deck_cards_json,
        mp.hand_cards_json,
        mp.discard_cards_json,
        mp.exile_cards_json,
        u.username,
        u.email
      FROM match_players mp
      INNER JOIN users u ON u.id = mp.user_id
      WHERE mp.match_id = $1
      ORDER BY mp.turn_order ASC;
    `,
    [matchId]
  );

  return result.rows;
}

async function findMatchPlayer({ matchId, userId }) {
  const result = await query(
    `
      SELECT
        mp.match_id,
        mp.user_id,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_drawn_this_turn,
        mp.has_used_card_action_this_turn,
        mp.is_defeated,
        mp.deck_cards_json,
        mp.hand_cards_json,
        mp.discard_cards_json,
        mp.exile_cards_json,
        u.username,
        u.email
      FROM match_players mp
      INNER JOIN users u ON u.id = mp.user_id
      WHERE mp.match_id = $1 AND mp.user_id = $2
      LIMIT 1;
    `,
    [matchId, userId]
  );

  return result.rows[0] || null;
}

async function addMatchLog({ matchId, type, message, payload = {} }) {
  const result = await query(
    `
      INSERT INTO match_logs (match_id, type, message, payload_json)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, match_id, type, message, payload_json, created_at;
    `,
    [matchId, type, message, JSON.stringify(payload)]
  );

  return result.rows[0] || null;
}

async function listMatchLogs(matchId, limit = 50) {
  const result = await query(
    `
      SELECT id, match_id, type, message, payload_json, created_at
      FROM match_logs
      WHERE match_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2;
    `,
    [matchId, limit]
  );

  return result.rows;
}

module.exports = {
  createMatch,
  findActiveMatchByRoomId,
  findMatchById,
  updateMatchState,
  upsertMatchPlayer,
  listMatchPlayers,
  findMatchPlayer,
  addMatchLog,
  listMatchLogs,
};
