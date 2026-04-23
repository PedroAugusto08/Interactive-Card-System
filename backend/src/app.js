const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { env } = require('./config/env');
const { healthRoutes } = require('./routes/healthRoutes');
const { authRoutes } = require('./routes/authRoutes');
const { roomRoutes } = require('./routes/roomRoutes');
const { deckRoutes } = require('./routes/deckRoutes');
const { notFoundHandler, errorHandler } = require('./middlewares/errorMiddleware');

// Monta e configura a aplicacao Express.
function createApp() {
  const app = express();

  // CORS para permitir frontend local chamar a API.
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    })
  );

  // Middlewares base de seguranca, logs e parse JSON.
  app.use(helmet());
  app.use(morgan('dev'));
  app.use(express.json());

  // Rotas principais da API.
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/decks', deckRoutes);

  // Handlers finais (404 e erros).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
