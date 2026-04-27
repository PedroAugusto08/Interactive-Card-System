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

    socket.on('match:start', async ({ roomId }, acknowledge) => {
      try {
        await matchService.startMatchForRoom({
          roomId: Number(roomId),
          userId: user.id,
          includeSnapshot: false,
        });

        await acknowledgeRealtimeState(socket, Number(roomId), acknowledge);
        await broadcastRoomState(io, Number(roomId));
      } catch (error) {
        acknowledgeSocketError(acknowledge, error.message);
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:draw', async ({ roomId }, acknowledge) => {
      try {
        const actionStartedAt = performance.now();
        const actionState = await matchService.drawCardForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          includeSnapshot: false,
        });
        const mutateMs = performance.now() - actionStartedAt;
        const acknowledgeStartedAt = performance.now();
        const ackMetrics = {
          buildAckMs: 0,
          totalMs: 0,
        };
        if (typeof acknowledge === 'function') {
          acknowledge({
            ok: true,
            snapshot: actionState?.snapshot || null,
            log: actionState?.log || null,
            metrics: ackMetrics,
          });
        }
        ackMetrics.buildAckMs = performance.now() - acknowledgeStartedAt;
        ackMetrics.totalMs = ackMetrics.buildAckMs;
        logMatchPerf('match:draw', {
          roomId: Number(roomId),
          userId: user.id,
          mutateMs,
          realtimeMetrics: ackMetrics,
          totalMs: performance.now() - actionStartedAt,
        });
        queueMatchBroadcast(io, Number(roomId), [socket.id]);
      } catch (error) {
        acknowledgeSocketError(acknowledge, error.message);
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:playCard', async ({ roomId, cardId, targetUserId, selectedExileCardId }, acknowledge) => {
      try {
        const actionStartedAt = performance.now();
        const actionState = await matchService.playCardForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          cardId,
          targetUserId: targetUserId ? Number(targetUserId) : undefined,
          selectedExileCardId,
          includeSnapshot: false,
        });
        const mutateMs = performance.now() - actionStartedAt;
        const acknowledgeStartedAt = performance.now();
        const ackMetrics = {
          buildAckMs: 0,
          totalMs: 0,
        };
        if (typeof acknowledge === 'function') {
          acknowledge({
            ok: true,
            snapshot: actionState?.snapshot || null,
            log: actionState?.log || null,
            notice: actionState?.notice || '',
            metrics: ackMetrics,
          });
        }
        ackMetrics.buildAckMs = performance.now() - acknowledgeStartedAt;
        ackMetrics.totalMs = ackMetrics.buildAckMs;
        logMatchPerf('match:playCard', {
          roomId: Number(roomId),
          userId: user.id,
          mutateMs,
          realtimeMetrics: ackMetrics,
          totalMs: performance.now() - actionStartedAt,
        });
        queueMatchBroadcast(io, Number(roomId), [socket.id]);
      } catch (error) {
        acknowledgeSocketError(acknowledge, error.message);
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:discardCard', async ({ roomId, cardId, targetUserId, selectedExileCardId }, acknowledge) => {
      try {
        const actionStartedAt = performance.now();
        const actionState = await matchService.discardCardForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          cardId,
          targetUserId: targetUserId ? Number(targetUserId) : undefined,
          selectedExileCardId,
          includeSnapshot: false,
        });
        const mutateMs = performance.now() - actionStartedAt;
        const acknowledgeStartedAt = performance.now();
        const ackMetrics = {
          buildAckMs: 0,
          totalMs: 0,
        };
        if (typeof acknowledge === 'function') {
          acknowledge({
            ok: true,
            snapshot: actionState?.snapshot || null,
            log: actionState?.log || null,
            notice: actionState?.notice || '',
            metrics: ackMetrics,
          });
        }
        ackMetrics.buildAckMs = performance.now() - acknowledgeStartedAt;
        ackMetrics.totalMs = ackMetrics.buildAckMs;
        logMatchPerf('match:discardCard', {
          roomId: Number(roomId),
          userId: user.id,
          mutateMs,
          realtimeMetrics: ackMetrics,
          totalMs: performance.now() - actionStartedAt,
        });
        queueMatchBroadcast(io, Number(roomId), [socket.id]);
      } catch (error) {
        acknowledgeSocketError(acknowledge, error.message);
        emitSocketError(socket, error.message);
      }
    });

    socket.on('match:endTurn', async ({ roomId }, acknowledge) => {
      try {
        const actionStartedAt = performance.now();
        const actionState = await matchService.endTurnForPlayer({
          roomId: Number(roomId),
          userId: user.id,
          includeSnapshot: false,
        });
        const mutateMs = performance.now() - actionStartedAt;
        const acknowledgeStartedAt = performance.now();
        const ackMetrics = {
          buildAckMs: 0,
          totalMs: 0,
        };
        if (typeof acknowledge === 'function') {
          acknowledge({
            ok: true,
            snapshot: actionState?.snapshot || null,
            log: actionState?.log || null,
            metrics: ackMetrics,
          });
        }
        ackMetrics.buildAckMs = performance.now() - acknowledgeStartedAt;
        ackMetrics.totalMs = ackMetrics.buildAckMs;
        logMatchPerf('match:endTurn', {
          roomId: Number(roomId),
          userId: user.id,
          mutateMs,
          realtimeMetrics: ackMetrics,
          totalMs: performance.now() - actionStartedAt,
        });
        queueMatchBroadcast(io, Number(roomId), [socket.id]);
      } catch (error) {
        acknowledgeSocketError(acknowledge, error.message);
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

async function broadcastMatchOnly(io, roomId, excludedSocketIds = []) {
  const roomChannel = getRoomChannel(roomId);
  const sockets = (await io.in(roomChannel).fetchSockets()).filter(
    (socket) => !excludedSocketIds.includes(socket.id)
  );
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

async function acknowledgeRealtimeState(socket, roomId, acknowledge) {
  const { latestLog, snapshotsByUserId, metrics } = await matchService.getRealtimeMatchStatesForUsers({
    roomId,
    userIds: [socket.data.user.id],
  });
  const snapshot = snapshotsByUserId.get(socket.data.user.id) || null;

  if (typeof acknowledge === 'function') {
    acknowledge({
      ok: true,
      snapshot,
      log: latestLog,
      metrics,
    });
  }

  return {
    snapshot,
    log: latestLog,
    metrics,
  };
}

function acknowledgeSocketError(acknowledge, message) {
  if (typeof acknowledge === 'function') {
    acknowledge({
      ok: false,
      error: message,
    });
  }
}

function queueMatchBroadcast(io, roomId, excludedSocketIds = []) {
  setImmediate(() => {
    broadcastMatchOnly(io, roomId, excludedSocketIds).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to broadcast match state:', error);
    });
  });
}

function logMatchPerf(action, { roomId, userId, mutateMs, realtimeMetrics, totalMs }) {
  // eslint-disable-next-line no-console
  console.info(
    `[match perf] action=${action} room=${roomId} user=${userId} mutate=${Math.round(mutateMs)}ms ` +
      `findMatch=${Math.round(realtimeMetrics?.findMatchMs || 0)}ms ` +
      `loadMatchData=${Math.round(realtimeMetrics?.loadMatchDataMs || 0)}ms ` +
      `buildState=${Math.round(realtimeMetrics?.buildSnapshotsMs || 0)}ms ` +
      `buildAck=${Math.round(realtimeMetrics?.buildAckMs || 0)}ms ` +
      `ackTotal=${Math.round(realtimeMetrics?.totalMs || 0)}ms total=${Math.round(totalMs)}ms`
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
