const { query } = require('./db');
const { DIVISION_ACTION_CATALOG, getDivisionActionById } = require('./cardsCatalog');

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      code VARCHAR(8) NOT NULL UNIQUE,
      host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'lobby',
      turn_order_draft_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS decks (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description TEXT,
      cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS characters (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      legacy_deck_id INTEGER UNIQUE REFERENCES decks(id) ON DELETE SET NULL,
      name VARCHAR(80) NOT NULL,
      description TEXT,
      division_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      imo_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS room_players (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      selected_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      selected_character_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_ready BOOLEAN NOT NULL DEFAULT FALSE,
      turn_order INTEGER,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
  `);

  await query(`
    ALTER TABLE room_players
    ADD COLUMN IF NOT EXISTS selected_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;
  `);

  await query(`
    ALTER TABLE room_players
    ADD COLUMN IF NOT EXISTS selected_character_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS imo_cards (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      description TEXT NOT NULL,
      image_path TEXT,
      max_copies INTEGER NOT NULL DEFAULT 1,
      imo_cost INTEGER NOT NULL DEFAULT 0,
      automation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'opening',
      round INTEGER NOT NULL DEFAULT 1,
      current_turn_player_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      current_turn_participant_id INTEGER,
      winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      winner_participant_id INTEGER,
      combat_state_json JSONB DEFAULT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS matches_room_active_idx
    ON matches (room_id)
    WHERE status IN ('opening', 'active');
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS match_participants (
      id SERIAL PRIMARY KEY,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      controller_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      participant_type VARCHAR(32) NOT NULL,
      source_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      display_name VARCHAR(120) NOT NULL,
      turn_order INTEGER NOT NULL,
      health INTEGER NOT NULL DEFAULT 10,
      imo INTEGER NOT NULL DEFAULT 3,
      max_imo INTEGER NOT NULL DEFAULT 10,
      has_generated_imo_this_turn BOOLEAN NOT NULL DEFAULT FALSE,
      standard_action_used BOOLEAN NOT NULL DEFAULT FALSE,
      complementary_action_used BOOLEAN NOT NULL DEFAULT FALSE,
      opening_hand_ready BOOLEAN NOT NULL DEFAULT FALSE,
      is_defeated BOOLEAN NOT NULL DEFAULT FALSE,
      hand_cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      exiled_imo_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_ally_imo_card_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS source_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS has_generated_imo_this_turn BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS standard_action_used BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS complementary_action_used BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS opening_hand_ready BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS exiled_imo_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await query(`
    ALTER TABLE match_participants
    ADD COLUMN IF NOT EXISTS generated_ally_imo_card_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS match_participants_match_idx
    ON match_participants (match_id, turn_order);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS match_participants_controller_idx
    ON match_participants (match_id, controller_user_id);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS match_logs (
      id SERIAL PRIMARY KEY,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      type VARCHAR(40) NOT NULL,
      message TEXT NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await migrateDecksToCharacters();
  await migrateRoomSelectionsToCharacters();
  await migrateMatchParticipantsToCharacters();
}

async function migrateDecksToCharacters() {
  const existingCharacters = await query(`SELECT legacy_deck_id FROM characters WHERE legacy_deck_id IS NOT NULL;`);
  const migratedDeckIds = new Set(existingCharacters.rows.map((row) => Number(row.legacy_deck_id)));
  const decks = await query(`
    SELECT id, owner_id, name, description, cards_json, created_at, updated_at
    FROM decks
    ORDER BY id ASC;
  `);

  for (const deck of decks.rows) {
    if (migratedDeckIds.has(Number(deck.id))) {
      continue;
    }

    const { divisionIds, imoCardIds } = extractCharacterLoadout(deck.cards_json);
    await query(
      `
        INSERT INTO characters (
          owner_id,
          legacy_deck_id,
          name,
          description,
          division_ids_json,
          imo_card_ids_json,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8);
      `,
      [
        deck.owner_id,
        deck.id,
        deck.name,
        deck.description,
        JSON.stringify(divisionIds),
        JSON.stringify(imoCardIds),
        deck.created_at,
        deck.updated_at,
      ]
    );
  }
}

async function migrateRoomSelectionsToCharacters() {
  const hasLegacySelectedDeckId = await columnExists({
    tableName: 'room_players',
    columnName: 'selected_deck_id',
  });
  if (hasLegacySelectedDeckId) {
    await query(`
      UPDATE room_players rp
      SET selected_character_id = c.id
      FROM characters c
      WHERE rp.selected_character_id IS NULL
        AND rp.selected_deck_id IS NOT NULL
        AND c.legacy_deck_id = rp.selected_deck_id;
    `);
  }

  const hasLegacySelectedDeckIds = await columnExists({
    tableName: 'room_players',
    columnName: 'selected_deck_ids_json',
  });
  const roomPlayers = await query(`
    SELECT room_id, user_id, selected_character_ids_json
    FROM room_players;
  `);

  for (const row of roomPlayers.rows) {
    const alreadyMigrated = Array.isArray(row.selected_character_ids_json) && row.selected_character_ids_json.length;
    if (alreadyMigrated) {
      continue;
    }

    if (!hasLegacySelectedDeckIds) {
      continue;
    }

    const legacyDeckIdsResult = await query(
      `
        SELECT selected_deck_ids_json
        FROM room_players
        WHERE room_id = $1 AND user_id = $2
        LIMIT 1;
      `,
      [row.room_id, row.user_id]
    );
    const deckIds = Array.isArray(legacyDeckIdsResult.rows[0]?.selected_deck_ids_json)
      ? legacyDeckIdsResult.rows[0].selected_deck_ids_json
      : [];
    if (!deckIds.length) {
      continue;
    }

    const result = await query(
      `
        SELECT id, legacy_deck_id
        FROM characters
        WHERE legacy_deck_id = ANY($1::int[]);
      `,
      [deckIds.map((value) => Number(value)).filter(Number.isInteger)]
    );
    const mapping = new Map(result.rows.map((item) => [Number(item.legacy_deck_id), Number(item.id)]));
    const characterIds = deckIds.map((deckId) => mapping.get(Number(deckId))).filter(Number.isInteger);
    if (!characterIds.length) {
      continue;
    }

    await query(
      `
        UPDATE room_players
        SET
          selected_character_id = COALESCE(selected_character_id, $3),
          selected_character_ids_json = $4::jsonb
        WHERE room_id = $1 AND user_id = $2;
      `,
      [row.room_id, row.user_id, characterIds[0], JSON.stringify(characterIds)]
    );
  }
}

async function migrateMatchParticipantsToCharacters() {
  const hasLegacySourceDeckId = await columnExists({
    tableName: 'match_participants',
    columnName: 'source_deck_id',
  });
  if (!hasLegacySourceDeckId) {
    return;
  }

  await query(`
    UPDATE match_participants mp
    SET source_character_id = c.id
    FROM characters c
    WHERE mp.source_character_id IS NULL
      AND mp.source_deck_id IS NOT NULL
      AND c.legacy_deck_id = mp.source_deck_id;
  `);
}

function extractCharacterLoadout(cardsJson) {
  const divisionIds = [];
  const imoCardIds = [];

  for (const entry of Array.isArray(cardsJson) ? cardsJson : []) {
    const cardId = String(entry?.cardId || '').trim();
    if (!cardId) {
      continue;
    }

    if (cardId.startsWith('imo:')) {
      imoCardIds.push(cardId);
      continue;
    }

    if (getDivisionActionById(cardId)) {
      divisionIds.push(cardId);
    }
  }

  return {
    divisionIds: [...new Set(divisionIds.filter((cardId) => DIVISION_ACTION_CATALOG.some((card) => card.id === cardId)))],
    imoCardIds: [...new Set(imoCardIds)],
  };
}

async function columnExists({ tableName, columnName }) {
  const result = await query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      LIMIT 1;
    `,
    [tableName, columnName]
  );

  return Boolean(result.rows[0]);
}

module.exports = { ensureSchema };
