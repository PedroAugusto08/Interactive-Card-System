const { Pool } = require('pg');
const { env } = require('./env');

// Pool de conexoes com Postgres para reaproveitar conexoes entre requests.
const pool = new Pool({
  connectionString: env.databaseUrl,
});

// Helper unico para executar SQL com parametros.
async function query(text, params = []) {
  return pool.query(text, params);
}

// Check simples para validar se o banco esta acessivel no startup.
async function testConnection() {
  await query('SELECT 1');
}

module.exports = {
  pool,
  query,
  testConnection,
};
