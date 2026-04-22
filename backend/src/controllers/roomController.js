const { z } = require('zod');

const roomService = require('../services/roomService');

// Valida o payload para entrar em sala por codigo.
const joinRoomSchema = z.object({
  code: z.string().trim().min(4).max(8),
});

// Valida o id da sala vindo pela URL.
const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

// Cria sala e adiciona o host como primeiro jogador.
async function createRoom(req, res) {
  const data = await roomService.createRoomForHost(req.user.id);
  return res.status(201).json(data);
}

// Entra em sala existente a partir do codigo.
async function joinRoom(req, res) {
  const payload = joinRoomSchema.parse(req.body);
  const data = await roomService.joinRoomByCode({
    code: payload.code,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

// Lista os jogadores atuais da sala.
async function listPlayers(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await roomService.getRoomPlayers(roomId);

  return res.status(200).json(data);
}

module.exports = {
  createRoom,
  joinRoom,
  listPlayers,
};
