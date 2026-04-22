const http = require('http');

const { env } = require('./config/env');
const { testConnection } = require('./config/db');
const { ensureSchema } = require('./config/schema');
const { createApp } = require('./app');
const { createSocketServer } = require('./sockets');

// Sobe toda a stack: banco, schema, HTTP e Socket.IO.
async function bootstrap() {
  try {
    // Valida acesso ao banco e garante tabelas minimas.
    await testConnection();
    await ensureSchema();

    // Cria app HTTP e acopla Socket.IO no mesmo servidor.
    const app = createApp();
    const httpServer = http.createServer(app);

    createSocketServer(httpServer);

    // Inicia escuta da aplicacao.
    httpServer.listen(env.port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on port ${env.port}`);
    });
  } catch (error) {
    // Falha no bootstrap encerra processo para nao subir quebrado.
    // eslint-disable-next-line no-console
    console.error('Failed to bootstrap server:', error);
    process.exit(1);
  }
}

bootstrap();
