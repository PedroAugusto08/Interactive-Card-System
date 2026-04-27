const { z } = require('zod');

const matchService = require('../services/matchService');

const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const cardActionSchema = z.object({
  cardId: z.string().trim().min(1),
  targetUserId: z.coerce.number().int().positive().optional(),
  selectedExileCardId: z.string().trim().min(1).optional(),
});

async function getMatchSnapshot(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await matchService.getMatchSnapshot({
    roomId,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

async function startMatch(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await matchService.startMatchForRoom({
    roomId,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

async function drawCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await matchService.drawCardForPlayer({
    roomId,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

async function playCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = cardActionSchema.parse(req.body);
  const data = await matchService.playCardForPlayer({
    roomId,
    userId: req.user.id,
    cardId: payload.cardId,
    targetUserId: payload.targetUserId,
    selectedExileCardId: payload.selectedExileCardId,
  });

  return res.status(200).json(data);
}

async function discardCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = cardActionSchema.parse(req.body);
  const data = await matchService.discardCardForPlayer({
    roomId,
    userId: req.user.id,
    cardId: payload.cardId,
    targetUserId: payload.targetUserId,
    selectedExileCardId: payload.selectedExileCardId,
  });

  return res.status(200).json(data);
}

async function endTurn(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const data = await matchService.endTurnForPlayer({
    roomId,
    userId: req.user.id,
  });

  return res.status(200).json(data);
}

module.exports = {
  getMatchSnapshot,
  startMatch,
  drawCard,
  playCard,
  discardCard,
  endTurn,
};
