CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  code VARCHAR(8) NOT NULL UNIQUE,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'lobby',
  turn_order_draft_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decks (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  description TEXT,
  cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legacy_deck_id INTEGER UNIQUE REFERENCES decks(id) ON DELETE SET NULL,
  name VARCHAR(80) NOT NULL,
  description TEXT,
  division_id VARCHAR(80),
  base_carne INTEGER NOT NULL DEFAULT 5,
  base_imo INTEGER NOT NULL DEFAULT 5,
  combate INTEGER NOT NULL DEFAULT 0,
  pontaria INTEGER NOT NULL DEFAULT 0,
  resistencia INTEGER NOT NULL DEFAULT 0,
  furor INTEGER NOT NULL DEFAULT 0,
  percepcao INTEGER NOT NULL DEFAULT 0,
  conhecimento INTEGER NOT NULL DEFAULT 0,
  medicina INTEGER NOT NULL DEFAULT 0,
  furtividade INTEGER NOT NULL DEFAULT 0,
  improviso INTEGER NOT NULL DEFAULT 0,
  mobilidade INTEGER NOT NULL DEFAULT 0,
  division_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  imo_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE UNIQUE INDEX IF NOT EXISTS matches_room_active_idx
ON matches (room_id)
WHERE status IN ('opening', 'active');

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
  current_carne INTEGER NOT NULL DEFAULT 10,
  current_imo INTEGER NOT NULL DEFAULT 3,
  has_generated_imo_this_turn BOOLEAN NOT NULL DEFAULT FALSE,
  standard_action_used BOOLEAN NOT NULL DEFAULT FALSE,
  complementary_action_used BOOLEAN NOT NULL DEFAULT FALSE,
  has_exiled_imo_this_turn BOOLEAN NOT NULL DEFAULT FALSE,
  opening_hand_ready BOOLEAN NOT NULL DEFAULT FALSE,
  is_defeated BOOLEAN NOT NULL DEFAULT FALSE,
  hand_cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  exiled_imo_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_ally_imo_card_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS match_participants_match_idx
ON match_participants (match_id, turn_order);

CREATE INDEX IF NOT EXISTS match_participants_controller_idx
ON match_participants (match_id, controller_user_id);

CREATE TABLE IF NOT EXISTS match_logs (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
