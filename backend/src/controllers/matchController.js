const { z } = require('zod');

const matchService = require('../services/matchService');

const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const cardActionSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  cardId: z.string().trim().min(1),
  targetParticipantId: z.coerce.number().int().positive().optional(),
  selectedExileCardId: z.string().trim().min(1).optional(),
  selectedOwnHandCardId: z.string().trim().min(1).optional(),
  selectedTargetHandCardId: z.string().trim().min(1).optional(),
  pairedCardId: z.string().trim().min(1).optional(),
  pairedTargetParticipantId: z.coerce.number().int().positive().optional(),
  pairedSelectedExileCardId: z.string().trim().min(1).optional(),
  pairedSelectedOwnHandCardId: z.string().trim().min(1).optional(),
  pairedSelectedTargetHandCardId: z.string().trim().min(1).optional(),
  asCounterResponse: z.coerce.boolean().optional(),
});

const actingParticipantSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
});

const revealTopDeckSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  targetParticipantId: z.coerce.number().int().positive(),
  topDeckInstanceId: z.string().trim().min(1),
});

const reactToAttackSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  reactionCardId: z.string().trim().min(1),
});

const resolveAttackSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
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
    requesterUser: req.user,
  });

  return res.status(200).json(data);
}

async function drawCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = actingParticipantSchema.parse(req.body);
  const data = await matchService.drawCardForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
  });

  return res.status(200).json(data);
}

async function playCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = cardActionSchema.parse(req.body);
  const data = await matchService.playCardForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    cardId: payload.cardId,
    targetParticipantId: payload.targetParticipantId,
    selectedExileCardId: payload.selectedExileCardId,
    selectedOwnHandCardId: payload.selectedOwnHandCardId,
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
    pairedCardId: payload.pairedCardId,
    pairedTargetParticipantId: payload.pairedTargetParticipantId,
    pairedSelectedExileCardId: payload.pairedSelectedExileCardId,
    pairedSelectedOwnHandCardId: payload.pairedSelectedOwnHandCardId,
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
    actingParticipantId: payload.actingParticipantId,
    cardId: payload.cardId,
    targetParticipantId: payload.targetParticipantId,
    selectedExileCardId: payload.selectedExileCardId,
    selectedOwnHandCardId: payload.selectedOwnHandCardId,
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
    asCounterResponse: payload.asCounterResponse,
  });

  return res.status(200).json(data);
}

async function endTurn(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = actingParticipantSchema.parse(req.body);
  const data = await matchService.endTurnForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
  });

  return res.status(200).json(data);
}

async function revealTopDeck(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = revealTopDeckSchema.parse(req.body);
  const data = await matchService.revealViewedTopDeckCardForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    targetParticipantId: payload.targetParticipantId,
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
    actingParticipantId: payload.actingParticipantId,
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
    actingParticipantId: payload.actingParticipantId,
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
