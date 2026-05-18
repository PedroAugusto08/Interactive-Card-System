const { query } = require('../config/db');

async function createMatch({
  roomId,
  currentTurnParticipantId = null,
  currentTurnPlayerId = null,
  winnerParticipantId = null,
  winnerUserId = null,
  status = 'opening',
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
      WHERE room_id = $1 AND status IN ('opening', 'active')
      ORDER BY id DESC
      LIMIT 1;
    `,
    [roomId]
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
  combatState = undefined,
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
        combat_state_json = COALESCE($8::jsonb, combat_state_json),
        ended_at = $9
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
      combatState === undefined ? null : JSON.stringify(combatState),
      endedAt,
    ]
  );

  return result.rows[0] || null;
}

async function createMatchParticipant({
  matchId,
  controllerUserId,
  participantType,
  sourceCharacterId = null,
  displayName,
  turnOrder,
  health = 10,
  imo = 3,
  maxImo = 10,
  hasGeneratedImoThisTurn = false,
  standardActionUsed = false,
  complementaryActionUsed = false,
  openingHandReady = false,
  isDefeated = false,
  handCards = [],
  exiledImoCardIds = [],
}) {
  const result = await query(
    `
      INSERT INTO match_participants (
        match_id,
        controller_user_id,
        participant_type,
        source_character_id,
        display_name,
        turn_order,
        health,
        imo,
        max_imo,
        has_generated_imo_this_turn,
        standard_action_used,
        complementary_action_used,
        opening_hand_ready,
        is_defeated,
        hand_cards_json,
        exiled_imo_card_ids_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)
      RETURNING
        id,
        match_id,
        controller_user_id,
        participant_type,
        source_character_id,
        display_name,
        turn_order,
        health,
        imo,
        max_imo,
        has_generated_imo_this_turn,
        standard_action_used,
        complementary_action_used,
        opening_hand_ready,
        is_defeated,
        hand_cards_json,
        exiled_imo_card_ids_json;
    `,
    [
      matchId,
      controllerUserId,
      participantType,
      sourceCharacterId,
      displayName,
      turnOrder,
      health,
      imo,
      maxImo,
      hasGeneratedImoThisTurn,
      standardActionUsed,
      complementaryActionUsed,
      openingHandReady,
      isDefeated,
      JSON.stringify(handCards),
      JSON.stringify(exiledImoCardIds),
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
  hasGeneratedImoThisTurn,
  standardActionUsed,
  complementaryActionUsed,
  openingHandReady,
  isDefeated,
  handCards,
  exiledImoCardIds,
}) {
  const result = await query(
    `
      UPDATE match_participants
      SET
        turn_order = $2,
        health = $3,
        imo = $4,
        max_imo = $5,
        has_generated_imo_this_turn = $6,
        standard_action_used = $7,
        complementary_action_used = $8,
        opening_hand_ready = $9,
        is_defeated = $10,
        hand_cards_json = $11::jsonb,
        exiled_imo_card_ids_json = $12::jsonb
      WHERE id = $1
      RETURNING
        id,
        match_id,
        controller_user_id,
        participant_type,
        source_character_id,
        display_name,
        turn_order,
        health,
        imo,
        max_imo,
        has_generated_imo_this_turn,
        standard_action_used,
        complementary_action_used,
        opening_hand_ready,
        is_defeated,
        hand_cards_json,
        exiled_imo_card_ids_json;
    `,
    [
      participantId,
      turnOrder,
      health,
      imo,
      maxImo,
      hasGeneratedImoThisTurn,
      standardActionUsed,
      complementaryActionUsed,
      openingHandReady,
      isDefeated,
      JSON.stringify(handCards),
      JSON.stringify(exiledImoCardIds),
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
        mp.source_character_id,
        mp.display_name,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_generated_imo_this_turn,
        mp.standard_action_used,
        mp.complementary_action_used,
        mp.opening_hand_ready,
        mp.is_defeated,
        mp.hand_cards_json,
        mp.exiled_imo_card_ids_json,
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
        mp.source_character_id,
        mp.display_name,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_generated_imo_this_turn,
        mp.standard_action_used,
        mp.complementary_action_used,
        mp.opening_hand_ready,
        mp.is_defeated,
        mp.hand_cards_json,
        mp.exiled_imo_card_ids_json,
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
        mp.source_character_id,
        mp.display_name,
        mp.turn_order,
        mp.health,
        mp.imo,
        mp.max_imo,
        mp.has_generated_imo_this_turn,
        mp.standard_action_used,
        mp.complementary_action_used,
        mp.opening_hand_ready,
        mp.is_defeated,
        mp.hand_cards_json,
        mp.exiled_imo_card_ids_json,
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
  findMatchParticipantById,
  listMatchLogs,
  listMatchParticipants,
  listMatchParticipantsByController,
  updateMatchParticipant,
  updateMatchState,
};
