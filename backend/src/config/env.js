const dotenv = require('dotenv');

// Carrega variaveis do arquivo .env para process.env.
dotenv.config();

// Config central da aplicacao com fallback para desenvolvimento local.
const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  port: Number(process.env.PORT || 3001),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/acedia_deck_app',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  masterAccountEmail: String(process.env.MASTER_ACCOUNT_EMAIL || '').trim().toLowerCase(),
  devAllowMasterOverrideAs: String(process.env.DEV_ALLOW_MASTER_OVERRIDE_AS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
};

module.exports = { env };
