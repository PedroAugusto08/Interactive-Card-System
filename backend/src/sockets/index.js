const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { findUserById } = require('../models/userModel');
const roomService = require('../services/roomService');
const matchService = require('../services/matchService');

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        env.clientOrigin,
      ].filter(Boolean),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
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

      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error('Falha de autenticacao.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    socket.on('room:join', async ({ code }) => {
      try {
        const { room } = await roomService.joinRoomByCode({
          code,
          userId: user.id,
        });

        const roomChannel = getRoomChannel(room.id);
        socket.join(roomChannel);
        socket.data.currentRoomId = room.id;

        await syncSocketRoomState(socket, room.id);
        await broadcastRoomOnly(io, room.id);
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('room:leave', async ({ roomId }) => {
      try {
        const targetRoomId = Number(roomId || socket.data.currentRoomId);
        const data = await roomService.leaveRoom({
          roomId: targetRoomId,
          userId: user.id,
        });

        socket.leave(getRoomChannel(targetRoomId));
        socket.data.currentRoomId = null;
        socket.emit('room:update', data);

        await broadcastRoomOnly(io, targetRoomId);
        await broadcastMatchOnly(io, targetRoomId);
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('room:selectDeck', async ({ roomId, deckId }) => {
      try {
        await roomService.selectDeckForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          deckId: Number(deckId),
        });

        await syncSocketRoomOnly(socket, Number(roomId));
        await broadcastRoomOnly(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('room:setReady', async ({ roomId, isReady }) => {
      try {
        await roomService.setPlayerReadyState({
          roomId: Number(roomId),
          userId: user.id,
          isReady: Boolean(isReady),
        });

        await syncSocketRoomOnly(socket, Number(roomId));
        await broadcastRoomOnly(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:start', async ({ roomId }) => {
      try {
        await matchService.startMatchForRoom({
          roomId: Number(roomId),
          userId: user.id,
          includeSnapshot: false,
        });

        await broadcastRoomState(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:draw', async ({ roomId }) => {
      try {
        await matchService.drawCardForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          includeSnapshot: false,
        });

        await broadcastMatchOnly(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:playCard', async ({ roomId, cardId }) => {
      try {
        await matchService.playCardForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          cardId,
          includeSnapshot: false,
        });

        await broadcastMatchOnly(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:discardCard', async ({ roomId, cardId }) => {
      try {
        await matchService.discardCardForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          cardId,
          includeSnapshot: false,
        });

        await broadcastMatchOnly(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:endTurn', async ({ roomId }) => {
      try {
        await matchService.endTurnForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          includeSnapshot: false,
        });

        await broadcastMatchOnly(io, Number(roomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:sync', async ({ roomId }) => {
      try {
        await syncSocketRoomState(socket, Number(roomId || socket.data.currentRoomId));
      } catch (error) {
        emitSocketError(socket, error.message);
      }
    });
  });

  return io;
}

async function syncSocketRoomState(socket, roomId) {
  if (!roomId) {
    return;
  }

  await syncSocketRoomOnly(socket, roomId);
  await syncSocketMatchState(socket, roomId);
}

async function syncSocketRoomOnly(socket, roomId) {
  if (!roomId) {
    return;
  }

  const roomData = await roomService.getRoomPlayers({
    roomId,
    userId: socket.data.user.id,
  });

  socket.emit('room:update', roomData);
}

async function syncSocketMatchState(socket, roomId) {
  if (!roomId) {
    return;
  }

  const matchSnapshot = await matchService.getMatchSnapshot({
    roomId,
    userId: socket.data.user.id,
  });

  socket.emit('match:sync', matchSnapshot);

  const latestLog = matchSnapshot.logs[0];
  if (latestLog) {
    socket.emit('match:log', {
      id: latestLog.id,
      type: latestLog.type,
      message: latestLog.message,
      timestamp: latestLog.timestamp,
    });
  }
}

async function broadcastRoomState(io, roomId) {
  await broadcastRoomOnly(io, roomId);
  await broadcastMatchOnly(io, roomId);
}

async function broadcastRoomOnly(io, roomId) {
  const roomChannel = getRoomChannel(roomId);
  const sockets = await io.in(roomChannel).fetchSockets();
  await Promise.all(sockets.map((socket) => syncSocketRoomOnly(socket, roomId)));
}

async function broadcastMatchOnly(io, roomId) {
  const roomChannel = getRoomChannel(roomId);
  const sockets = await io.in(roomChannel).fetchSockets();
  const { latestLog, snapshotsByUserId } = await matchService.getRealtimeMatchStatesForUsers({
    roomId,
    userIds: sockets.map((socket) => socket.data.user.id),
  });

  await Promise.all(
    sockets.map(async (socket) => {
      const snapshot = snapshotsByUserId.get(socket.data.user.id);
      if (!snapshot) {
        return;
      }

      socket.emit('match:sync', snapshot);

      if (latestLog) {
        socket.emit('match:log', {
          id: latestLog.id,
          type: latestLog.type,
          message: latestLog.message,
          timestamp: latestLog.timestamp,
        });
      }
    })
  );
}

function emitSocketError(socket, message) {
  socket.emit('match:log', {
    type: 'ERROR',
    message,
    timestamp: new Date().toISOString(),
  });
}

function extractBearerToken(authorizationHeader) {
  const [scheme, token] = String(authorizationHeader).split(' ');
  if (scheme !== 'Bearer') {
    return null;
  }

  return token;
}

function getRoomChannel(roomId) {
  return `room:${roomId}`;
}

module.exports = { createSocketServer };
