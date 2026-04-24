const { z } = require('zod');

const roomService = require('../services/roomService');

const joinRoomSchema = z.object({
  code: z.string().trim().min(4).max(8),
});

const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const leaveRoomSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const selectDeckSchema = z.object({
  deckId: z.coerce.number().int().positive(),
});

const readyStateSchema = z.object({
  isReady: z.boolean(),
});

async function createRoom(req, res) {
  const data = await roomService.createRoomForHost(req.user.id);
  return res.status(201).json(data);
}

async function joinRoom(req, res) {
  const payload = joinRoomSchema.parse(req.body);
  const data = await roomService.joinRoomByCode({
    code: payload.code,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

async function leaveRoom(req, res) {
  const payload = leaveRoomSchema.parse(req.body);
  const data = await roomService.leaveRoom({
    roomId: payload.roomId,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

async function listPlayers(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await roomService.getRoomPlayers({
    roomId,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

async function getCurrentRoom(req, res) {
  const data = await roomService.getCurrentRoomForUser(req.user.id);
  return res.status(200).json(data);
}

async function selectDeck(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = selectDeckSchema.parse(req.body);
  const data = await roomService.selectDeckForPlayer({
    roomId,
    userId: req.user.id,
    deckId: payload.deckId,
  });

  return res.status(200).json(data);
}

async function setReadyState(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = readyStateSchema.parse(req.body);
  const data = await roomService.setPlayerReadyState({
    roomId,
    userId: req.user.id,
    isReady: payload.isReady,
  });

  return res.status(200).json(data);
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  listPlayers,
  getCurrentRoom,
  selectDeck,
  setReadyState,
};
