const { z } = require('zod');

const matchService = require('../services/matchService');

const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const targetedActionSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  targetParticipantId: z.coerce.number().int().positive().optional(),
  selectedExiledCardId: z.string().trim().min(1).optional(),
  selectedOwnHandCardId: z.string().trim().min(1).optional(),
  selectedTargetHandCardId: z.string().trim().min(1).optional(),
});

const useImoCardSchema = targetedActionSchema.extend({
  cardId: z.string().trim().min(1),
});

const generateImoSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  cardId: z.string().trim().min(1),
});

const useDivisionActionSchema = targetedActionSchema.extend({
  divisionId: z.string().trim().min(1),
});

const completeOpeningHandSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  selectedCardIds: z.array(z.string().trim().min(1)).length(2),
});

const actingParticipantSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
});

const exileImoCardSchema = targetedActionSchema.extend({
  cardId: z.string().trim().min(1),
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

async function completeOpeningHand(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = completeOpeningHandSchema.parse(req.body);
  const data = await matchService.completeOpeningHandForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    selectedCardIds: payload.selectedCardIds,
  });

  return res.status(200).json(data);
}

async function generateImo(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = generateImoSchema.parse(req.body);
  const data = await matchService.generateImoForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    cardId: payload.cardId,
  });

  return res.status(200).json(data);
}

async function useImoCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = useImoCardSchema.parse(req.body);
  const data = await matchService.useImoCardForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    cardId: payload.cardId,
    targetParticipantId: payload.targetParticipantId,
    selectedExiledCardId: payload.selectedExiledCardId,
    selectedOwnHandCardId: payload.selectedOwnHandCardId,
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
  });

  return res.status(200).json(data);
}

async function exileImoCard(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = exileImoCardSchema.parse(req.body);
  const data = await matchService.exileImoCardForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    cardId: payload.cardId,
    targetParticipantId: payload.targetParticipantId,
    selectedExiledCardId: payload.selectedExiledCardId,
    selectedOwnHandCardId: payload.selectedOwnHandCardId,
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
  });

  return res.status(200).json(data);
}

async function useDivisionAction(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = useDivisionActionSchema.parse(req.body);
  const data = await matchService.useDivisionActionForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    divisionId: payload.divisionId,
    targetParticipantId: payload.targetParticipantId,
    selectedExiledCardId: payload.selectedExiledCardId,
    selectedOwnHandCardId: payload.selectedOwnHandCardId,
    selectedTargetHandCardId: payload.selectedTargetHandCardId,
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

module.exports = {
  completeOpeningHand,
  endTurn,
  exileImoCard,
  generateImo,
  getMatchSnapshot,
  startMatch,
  useDivisionAction,
  useImoCard,
};
