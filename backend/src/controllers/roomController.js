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

const selectCharacterSchema = z.object({
  characterId: z.coerce.number().int().positive(),
});

const replaceMasterCharactersSchema = z.object({
  characterIds: z.array(z.coerce.number().int().positive()).min(1),
});

const turnOrderDraftSchema = z.object({
  draftEntryIds: z.array(z.string().trim().min(1)).min(1),
});

const readyStateSchema = z.object({
  isReady: z.boolean(),
});

async function createRoom(req, res) {
  const data = await roomService.createRoomForHost({
    hostId: req.user.id,
    requesterUser: req.user,
  });
  return res.status(201).json(data);
}

async function joinRoom(req, res) {
  const payload = joinRoomSchema.parse(req.body);
  const data = await roomService.joinRoomByCode({
    code: payload.code,
    userId: req.user.id,
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

async function leaveRoom(req, res) {
  const payload = leaveRoomSchema.parse(req.body);
  const data = await roomService.leaveRoom({
    roomId: payload.roomId,
    userId: req.user.id,
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

async function listPlayers(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await roomService.getRoomPlayers({
    roomId,
    userId: req.user.id,
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

async function getCurrentRoom(req, res) {
  const data = await roomService.getCurrentRoomForUser({
    userId: req.user.id,
    requesterUser: req.user,
  });
  return res.status(200).json(data);
}

async function selectCharacter(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = selectCharacterSchema.parse(req.body);
  const data = await roomService.selectCharacterForPlayer({
    roomId,
    userId: req.user.id,
    characterId: payload.characterId,
    requesterUser: req.user,
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
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

async function replaceMasterCharacters(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = replaceMasterCharactersSchema.parse(req.body);
  const data = await roomService.replaceMasterCharacterSelection({
    roomId,
    userId: req.user.id,
    characterIds: payload.characterIds,
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

async function updateTurnOrderDraft(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = turnOrderDraftSchema.parse(req.body);
  const data = await roomService.updateTurnOrderDraftForRoom({
    roomId,
    userId: req.user.id,
    draftEntryIds: payload.draftEntryIds,
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  listPlayers,
  getCurrentRoom,
  replaceMasterCharacters,
  selectCharacter,
  setReadyState,
  updateTurnOrderDraft,
};
