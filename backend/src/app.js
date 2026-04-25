const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { env } = require('./config/env');
const { healthRoutes } = require('./routes/healthRoutes');
const { authRoutes } = require('./routes/authRoutes');
const { roomRoutes } = require('./routes/roomRoutes');
const { deckRoutes } = require('./routes/deckRoutes');
const { matchRoutes } = require('./routes/matchRoutes');
const { notFoundHandler, errorHandler } = require('./middlewares/errorMiddleware');

// Monta e configura a aplicacao Express.
function createApp() {
  const app = express();

  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    env.clientOrigin,
  ].filter(Boolean);

  // CORS para permitir frontend local e frontend em producao chamarem a API.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`CORS bloqueado: ${origin}`));
      },
      credentials: true,
    })
  );
  // Middlewares base de seguranca, logs e parse JSON.
  app.use(
    helmet({
      // Permite que o frontend em outra origem carregue imagens estaticas de /cartas.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(morgan('dev'));
  app.use(express.json());

  // Expoe imagens das cartas armazenadas na raiz do workspace.
  app.use('/cartas', express.static(path.resolve(__dirname, '../../cartas')));

  // Rotas principais da API.
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/decks', deckRoutes);
  app.use('/api/match', matchRoutes);

  // Handlers finais (404 e erros).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
