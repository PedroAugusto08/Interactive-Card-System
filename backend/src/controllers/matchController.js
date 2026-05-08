const { z } = require('zod');

const matchService = require('../services/matchService');

const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const cardActionSchema = z.object({
  cardId: z.string().trim().min(1),
  targetUserId: z.coerce.number().int().positive().optional(),
  selectedExileCardId: z.string().trim().min(1).optional(),
  selectedTargetHandCardId: z.string().trim().min(1).optional(),
  pairedCardId: z.string().trim().min(1).optional(),
  pairedTargetUserId: z.coerce.number().int().positive().optional(),
  pairedSelectedExileCardId: z.string().trim().min(1).optional(),
  pairedSelectedTargetHandCardId: z.string().trim().min(1).optional(),
  asCounterResponse: z.coerce.boolean().optional(),
});

const revealTopDeckSchema = z.object({
  targetUserId: z.coerce.number().int().positive(),
  topDeckInstanceId: z.string().trim().min(1),
});

const reactToAttackSchema = z.object({
  reactionCardId: z.string().trim().min(1),
});

const resolveAttackSchema = z.object({
  resolution: z.enum(['skip-reaction', 'reaction-success', 'reaction-fail', 'skip-counter-response']),
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
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
    pairedCardId: payload.pairedCardId,
    pairedTargetUserId: payload.pairedTargetUserId,
    pairedSelectedExileCardId: payload.pairedSelectedExileCardId,
    pairedSelectedTargetHandCardId: payload.pairedSelectedTargetHandCardId,
    asCounterResponse: payload.asCounterResponse,
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
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
    asCounterResponse: payload.asCounterResponse,
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

async function revealTopDeck(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = revealTopDeckSchema.parse(req.body);
  const data = await matchService.revealViewedTopDeckCardForPlayer({
    roomId,
    userId: req.user.id,
    targetUserId: payload.targetUserId,
    topDeckInstanceId: payload.topDeckInstanceId,
  });

  return res.status(200).json(data);
}

async function reactToAttack(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = reactToAttackSchema.parse(req.body);
  const data = await matchService.reactToAttackForPlayer({
    roomId,
    userId: req.user.id,
    reactionCardId: payload.reactionCardId,
  });

  return res.status(200).json(data);
}

async function resolveAttack(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = resolveAttackSchema.parse(req.body);
  const data = await matchService.resolveAttackForPlayer({
    roomId,
    userId: req.user.id,
    resolution: payload.resolution,
  });

  return res.status(200).json(data);
}

module.exports = {
  getMatchSnapshot,
  startMatch,
  drawCard,
  playCard,
  discardCard,
  reactToAttack,
  resolveAttack,
  revealTopDeck,
  endTurn,
};
