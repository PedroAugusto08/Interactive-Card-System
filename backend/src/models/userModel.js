const { query } = require('../config/db');

// Insere novo usuario e devolve dados publicos.
async function createUser({ username, email, passwordHash }) {
  const result = await query(
    `
      INSERT INTO users (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at;
    `,
    [username, email, passwordHash]
  );

  return result.rows[0];
}

// Busca usuario por email para login.
async function findUserByEmail(email) {
  const result = await query(
    `
      SELECT id, username, email, password_hash, created_at
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [email]
  );

  return result.rows[0] || null;
}

// Busca usuario por username para evitar duplicidade.
async function findUserByUsername(username) {
  const result = await query(
    `
      SELECT id, username, email, password_hash, created_at
      FROM users
      WHERE username = $1
      LIMIT 1;
    `,
    [username]
  );

  return result.rows[0] || null;
}

// Busca usuario por id para autenticacao e contexto.
async function findUserById(id) {
  const result = await query(
    `
      SELECT id, username, email, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserByUsername,
  findUserById,
};
