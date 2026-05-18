const { z } = require('zod');

const matchService = require('../services/matchService');

const roomIdParamSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const targetedActionSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  targetParticipantId: z.coerce.number().int().positive().optional(),
  generatedSourceParticipantId: z.coerce.number().int().positive().optional(),
  generatedCardId: z.string().trim().min(1).optional(),
  selectedExiledCardId: z.string().trim().min(1).optional(),
  selectedOwnHandCardId: z.string().trim().min(1).optional(),
  selectedTargetHandCardId: z.string().trim().min(1).optional(),
});

const useImoCardSchema = targetedActionSchema.extend({
  cardId: z.string().trim().min(1),
});

const generateImoSchema = z.object({
  actingParticipantId: z.coerce.number().int().positive(),
  cardId: z.string().trim().min(1).optional(),
  selectedCardIds: z.array(z.string().trim().min(1)).max(2).optional(),
});

const useDivisionActionSchema = targetedActionSchema.extend({
  divisionId: z.string().trim().min(1),
  divisionInstanceId: z.string().trim().min(1).optional(),
});

const usePassiveActionSchema = targetedActionSchema.extend({
  passiveActionId: z.string().trim().min(1),
  selectedCatalogCardId: z.string().trim().min(1).optional(),
  selectedDivisionActionId: z.string().trim().min(1).optional(),
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

const attackSchema = targetedActionSchema.extend({
  targetParticipantId: z.coerce.number().int().positive(),
  attackKind: z.enum(['standard', 'executor-extra']).optional(),
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
    selectedCardIds: payload.selectedCardIds,
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
    generatedSourceParticipantId: payload.generatedSourceParticipantId,
    generatedCardId: payload.generatedCardId,
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
    divisionInstanceId: payload.divisionInstanceId,
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

async function usePassiveAction(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = usePassiveActionSchema.parse(req.body);
  const data = await matchService.usePassiveActionForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    passiveActionId: payload.passiveActionId,
    targetParticipantId: payload.targetParticipantId,
    selectedOwnHandCardId: payload.selectedOwnHandCardId,
    selectedCatalogCardId: payload.selectedCatalogCardId,
    selectedDivisionActionId: payload.selectedDivisionActionId,
  });

  return res.status(200).json(data);
}

async function attack(req, res) {
  const { roomId } = roomIdParamSchema.parse(req.params);
  const payload = attackSchema.parse(req.body);
  const data = await matchService.attackForPlayer({
    roomId,
    userId: req.user.id,
    actingParticipantId: payload.actingParticipantId,
    targetParticipantId: payload.targetParticipantId,
    attackKind: payload.attackKind,
  });

  return res.status(200).json(data);
}

module.exports = {
  attack,
  completeOpeningHand,
  endTurn,
  exileImoCard,
  generateImo,
  getMatchSnapshot,
  startMatch,
  useDivisionAction,
  usePassiveAction,
  useImoCard,
};
