const { query } = require('../config/db');

async function createMatch({
  roomId,
  currentTurnParticipantId = null,
  currentTurnPlayerId = null,
  winnerParticipantId = null,
  winnerUserId = null,
  status = 'active',
  round = 1,
  combatState = null,
}) {
  const result = await query(
    `
      INSERT INTO matches (
        room_id,
        status,
        round,
        current_turn_player_id,
        current_turn_participant_id,
        winner_user_id,
        winner_participant_id,
        combat_state_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING
        id,
        room_id,
        status,
        round,
        current_turn_player_id,
        current_turn_participant_id,
        winner_user_id,
        winner_participant_id,
        combat_state_json,
        started_at,
        ended_at,
        created_at;
    `,
    [
      roomId,
      status,
      round,
      currentTurnPlayerId,
      currentTurnParticipantId,
      winnerUserId,
      winnerParticipantId,
      JSON.stringify(combatState),
    ]
  );

  return result.rows[0] || null;
}

async function findActiveMatchByRoomId(roomId) {
  const result = await query(
    `
      SELECT
        id,
        room_id,
        status,
        round,
        current_turn_player_id,
        current_turn_participant_id,
        winner_user_id,
        winner_participant_id,
        combat_state_json,
        started_at,
        ended_at,
        created_at
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
      SELECT
        id,
        room_id,
        status,
        round,
        current_turn_player_id,
        current_turn_participant_id,
        winner_user_id,
        winner_participant_id,
        combat_state_json,
        started_at,
        ended_at,
        created_at
      FROM matches
      WHERE id = $1
      LIMIT 1;
    `,
    [matchId]
  );

  return result.rows[0] || null;
}

async function updateMatchState({
  matchId,
  status,
  round,
  currentTurnPlayerId,
  currentTurnParticipantId,
  winnerUserId,
  winnerParticipantId,
  endedAt = null,
}) {
  const result = await query(
    `
      UPDATE matches
      SET
        status = $2,
        round = $3,
        current_turn_player_id = $4,
        current_turn_participant_id = $5,
        winner_user_id = $6,
        winner_participant_id = $7,
        ended_at = $8
      WHERE id = $1
      RETURNING
        id,
        room_id,
        status,
        round,
        current_turn_player_id,
        current_turn_participant_id,
        winner_user_id,
        winner_participant_id,
        combat_state_json,
        started_at,
        ended_at,
        created_at;
    `,
    [
      matchId,
      status,
      round,
      currentTurnPlayerId,
      currentTurnParticipantId,
      winnerUserId,
      winnerParticipantId,
      endedAt,
    ]
  );

  return result.rows[0] || null;
}

async function updateMatchCombatState({ matchId, combatState = null }) {
  const result = await query(
    `
      UPDATE matches
      SET combat_state_json = $2::jsonb
      WHERE id = $1
      RETURNING
        id,
        room_id,
        status,
        round,
        current_turn_player_id,
        current_turn_participant_id,
        winner_user_id,
        winner_participant_id,
        combat_state_json,
        started_at,
        ended_at,
        created_at;
    `,
    [matchId, JSON.stringify(combatState)]
  );

  return result.rows[0] || null;
}

async function createMatchParticipant({
  matchId,
  controllerUserId,
  participantType,
  sourceDeckId = null,
  displayName,
  turnOrder,
  health = 10,
  imo = 3,
  maxImo = 10,
  hasDrawnThisTurn = false,
  hasUsedCardActionThisTurn = false,
  isDefeated = false,
  deckCards = [],
  handCards = [],
  exileCards = [],
}) {
  const result = await query(
    `
      INSERT INTO match_participants (
        match_id,
        controller_user_id,
        participant_type,
        source_deck_id,
        display_name,
        turn_order,
        health,
        imo,
        max_imo,
        has_drawn_this_turn,
        has_used_card_action_this_turn,
        is_defeated,
        deck_cards_json,
        hand_cards_json,
        exile_cards_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb)
      RETURNING
        id,
        match_id,
        controller_user_id,
        participant_type,
        source_deck_id,
        display_name,
        turn_order,
        health,
        imo,
        max_imo,
        has_drawn_this_turn,
        has_used_card_action_this_turn,
        is_defeated,
        deck_cards_json,
        hand_cards_json,
        exile_cards_json;
    `,
    [
      matchId,
      controllerUserId,
      participantType,
      sourceDeckId,
      displayName,
      turnOrder,
      health,
      imo,
      maxImo,
      hasDrawnThisTurn,
      hasUsedCardActionThisTurn,
      isDefeated,
      JSON.stringify(deckCards),
      JSON.stringify(handCards),
      JSON.stringify(exileCards),
    ]
  );

  return result.rows[0] || null;
}

async function updateMatchParticipant({
  participantId,
  turnOrder,
  health,
  imo,
  maxImo,
  hasDrawnThisTurn,
  hasUsedCardActionThisTurn,
  isDefeated,
  deckCards,
  handCards,
  exileCards,
}) {
  const result = await query(
    `
      UPDATE match_participants
      SET
        turn_order = $2,
        health = $3,
        imo = $4,
        max_imo = $5,
        has_drawn_this_turn = $6,
        has_used_card_action_this_turn = $7,
        is_defeated = $8,
        deck_cards_json = $9::jsonb,
        hand_cards_json = $10::jsonb,
        exile_cards_json = $11::jsonb
      WHERE id = $1
      RETURNING
        id,
        match_id,
        controller_user_id,
        participant_type,
        source_deck_id,
        display_name,
        turn_order,
        health,
        imo,
        max_imo,
        has_drawn_this_turn,
        has_used_card_action_this_turn,
        is_defeated,
        deck_cards_json,
        hand_cards_json,
        exile_cards_json;
    `,
    [
      participantId,
      turnOrder,
      health,
      imo,
      maxImo,
      hasDrawnThisTurn,
      hasUsedCardActionThisTurn,
      isDefeated,
      JSON.stringify(deckCards),
      JSON.stringify(handCards),
      JSON.stringify(exileCards),
    ]
  );

  return result.rows[0] || null;
}

async function listMatchParticipants(matchId) {
  const result = await query(
    `
      SELECT
        mp.id,
        mp.match_id,
        mp.controller_user_id,
        mp.participant_type,
        mp.source_deck_id,
        mp.display_name,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_drawn_this_turn,
        mp.has_used_card_action_this_turn,
        mp.is_defeated,
        mp.deck_cards_json,
        mp.hand_cards_json,
        mp.exile_cards_json,
        u.username AS controller_username,
        u.email AS controller_email
      FROM match_participants mp
      INNER JOIN users u ON u.id = mp.controller_user_id
      WHERE mp.match_id = $1
      ORDER BY mp.turn_order ASC, mp.id ASC;
    `,
    [matchId]
  );

  return result.rows;
}

async function findMatchParticipantById({ matchId, participantId }) {
  const result = await query(
    `
      SELECT
        mp.id,
        mp.match_id,
        mp.controller_user_id,
        mp.participant_type,
        mp.source_deck_id,
        mp.display_name,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_drawn_this_turn,
        mp.has_used_card_action_this_turn,
        mp.is_defeated,
        mp.deck_cards_json,
        mp.hand_cards_json,
        mp.exile_cards_json,
        u.username AS controller_username,
        u.email AS controller_email
      FROM match_participants mp
      INNER JOIN users u ON u.id = mp.controller_user_id
      WHERE mp.match_id = $1 AND mp.id = $2
      LIMIT 1;
    `,
    [matchId, participantId]
  );

  return result.rows[0] || null;
}

async function listMatchParticipantsByController({ matchId, controllerUserId }) {
  const result = await query(
    `
      SELECT
        mp.id,
        mp.match_id,
        mp.controller_user_id,
        mp.participant_type,
        mp.source_deck_id,
        mp.display_name,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_drawn_this_turn,
        mp.has_used_card_action_this_turn,
        mp.is_defeated,
        mp.deck_cards_json,
        mp.hand_cards_json,
        mp.exile_cards_json,
        u.username AS controller_username,
        u.email AS controller_email
      FROM match_participants mp
      INNER JOIN users u ON u.id = mp.controller_user_id
      WHERE mp.match_id = $1 AND mp.controller_user_id = $2
      ORDER BY mp.turn_order ASC, mp.id ASC;
    `,
    [matchId, controllerUserId]
  );

  return result.rows;
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
  addMatchLog,
  createMatch,
  createMatchParticipant,
  findActiveMatchByRoomId,
  findMatchById,
  findMatchParticipantById,
  listMatchLogs,
  listMatchParticipants,
  listMatchParticipantsByController,
  updateMatchCombatState,
  updateMatchParticipant,
  updateMatchState,
};
