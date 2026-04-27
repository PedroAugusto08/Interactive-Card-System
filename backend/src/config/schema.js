const { query } = require('./db');

// Cria as tabelas basicas do projeto se ainda nao existirem.
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
    CREATE TABLE IF NOT EXISTS room_players (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      selected_deck_id INTEGER REFERENCES decks(id) ON DELETE SET NULL,
      is_ready BOOLEAN NOT NULL DEFAULT FALSE,
      turn_order INTEGER,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
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
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      round INTEGER NOT NULL DEFAULT 1,
      current_turn_player_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS matches_room_active_idx
    ON matches (room_id)
    WHERE status = 'active';
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS match_players (
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      turn_order INTEGER NOT NULL,
      health INTEGER NOT NULL DEFAULT 10,
      imo INTEGER NOT NULL DEFAULT 3,
      max_imo INTEGER NOT NULL DEFAULT 10,
      has_drawn_this_turn BOOLEAN NOT NULL DEFAULT FALSE,
      has_used_card_action_this_turn BOOLEAN NOT NULL DEFAULT FALSE,
      is_defeated BOOLEAN NOT NULL DEFAULT FALSE,
      deck_cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      hand_cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      exile_cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (match_id, user_id)
    );
  `);

  await query(`
    ALTER TABLE match_players
    ADD COLUMN IF NOT EXISTS has_used_card_action_this_turn BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE match_players
    DROP COLUMN IF EXISTS discard_cards_json;
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
}

module.exports = { ensureSchema };
