const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { findUserById } = require('../models/userModel');
const roomService = require('../services/roomService');

// Configura servidor Socket.IO com autenticacao por JWT.
function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true,
    },
  });

  // Middleware de autenticacao para toda conexao websocket.
  io.use(async (socket, next) => {
    try {
      // Token pode vir no auth do handshake ou no header Authorization.
      const token =
        socket.handshake.auth?.token ||
        extractBearerToken(socket.handshake.headers?.authorization || '');

      if (!token) {
        return next(new Error('Token ausente.'));
      }

      const payload = jwt.verify(token, env.jwtSecret);
      const userId = Number(payload.sub);

      if (!Number.isInteger(userId)) {
        return next(new Error('Token invalido.'));
      }

      const user = await findUserById(userId);
      if (!user) {
        return next(new Error('Usuario nao encontrado.'));
      }

      // Salva usuario autenticado no contexto do socket.
      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error('Falha de autenticacao.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    // Entra em sala e sincroniza estado para todos os jogadores da sala.
    socket.on('room:join', async ({ code }) => {
      try {
        const { room, players } = await roomService.joinRoomByCode({
          code,
          userId: user.id,
        });

        const roomChannel = getRoomChannel(room.id);
        socket.join(roomChannel);
        socket.data.currentRoomId = room.id;

        // Atualiza dados de lobby/sala para todos no canal.
        io.to(roomChannel).emit('room:update', {
          room,
          players,
        });

        // Estado inicial da partida (base para evoluir depois).
        io.to(roomChannel).emit('match:updateState', {
          roomId: room.id,
          currentTurnPlayerId: null,
          round: 1,
          players,
        });

        // Log de evento para feed da partida.
        io.to(roomChannel).emit('match:log', {
          type: 'ROOM_JOIN',
          roomId: room.id,
          userId: user.id,
          username: user.username,
          message: `${user.username} entrou na sala.`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // Retorna erro para o proprio cliente.
        socket.emit('match:log', {
          type: 'ERROR',
          message: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Sai da sala e publica novo estado para quem permaneceu no canal.
    socket.on('room:leave', async ({ roomId }) => {
      try {
        const targetRoomId = Number(roomId || socket.data.currentRoomId);
        if (!Number.isInteger(targetRoomId) || targetRoomId <= 0) {
          throw new Error('roomId invalido.');
        }

        const { room, players } = await roomService.leaveRoom({
          roomId: targetRoomId,
          userId: user.id,
        });

        const roomChannel = getRoomChannel(room.id);
        socket.leave(roomChannel);
        socket.data.currentRoomId = null;

        // Atualiza dados de lobby/sala para todos no canal.
        io.to(roomChannel).emit('room:update', {
          room,
          players,
        });

        // Estado inicial da partida (base para evoluir depois).
        io.to(roomChannel).emit('match:updateState', {
          roomId: room.id,
          currentTurnPlayerId: null,
          round: 1,
          players,
        });

        // Log de evento para feed da partida.
        io.to(roomChannel).emit('match:log', {
          type: 'ROOM_LEAVE',
          roomId: room.id,
          userId: user.id,
          username: user.username,
          message: `${user.username} saiu da sala.`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // Retorna erro para o proprio cliente.
        socket.emit('match:log', {
          type: 'ERROR',
          message: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  return io;
}

// Extrai token quando Authorization vem no formato Bearer <token>.
function extractBearerToken(authorizationHeader) {
  const [scheme, token] = String(authorizationHeader).split(' ');
  if (scheme !== 'Bearer') {
    return null;
  }

  return token;
}

// Nome padrao de canal para cada sala.
function getRoomChannel(roomId) {
  return `room:${roomId}`;
}

module.exports = { createSocketServer };
