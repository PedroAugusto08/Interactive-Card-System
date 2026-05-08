const { z } = require('zod');

const AUTOMATION_TARGET_SCOPES = ['selected-player', 'other-player'];
const AUTOMATION_SELECTIONS = ['own-exile-card', 'own-hand-card', 'target-hand-card'];
const AUTOMATION_EFFECT_TARGETS = ['self', 'selected-player'];

const gainCatalogCardToHandEffectSchema = z.object({
  type: z.literal('gainCatalogCardToHand'),
  cardId: z.string().trim().min(1),
});

const moveSelectedExileCardToHandEffectSchema = z.object({
  type: z.literal('moveSelectedExileCardToHand'),
  excludeCurrentCard: z.boolean().optional(),
});

const drawTopDeckToHandEffectSchema = z.object({
  type: z.literal('drawTopDeckToHand'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const moveTopDeckToExileEffectSchema = z.object({
  type: z.literal('moveTopDeckToExile'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const moveTopExileToDeckEffectSchema = z.object({
  type: z.literal('moveTopExileToDeck'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
  shuffleIntoDeck: z.boolean().optional(),
});

const revealTopDeckEffectSchema = z.object({
  type: z.literal('revealTopDeck'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const moveSelectedOwnHandCardToTargetHandEffectSchema = z.object({
  type: z.literal('moveSelectedOwnHandCardToTargetHand'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const revealRandomHandCardEffectSchema = z.object({
  type: z.literal('revealRandomHandCard'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const destroySelectedHandCardEffectSchema = z.object({
  type: z.literal('destroySelectedHandCard'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const destroyRandomHandCardEffectSchema = z.object({
  type: z.literal('destroyRandomHandCard'),
  target: z.enum(AUTOMATION_EFFECT_TARGETS).optional(),
});

const cardAutomationEffectSchema = z.discriminatedUnion('type', [
  gainCatalogCardToHandEffectSchema,
  moveSelectedExileCardToHandEffectSchema,
  drawTopDeckToHandEffectSchema,
  moveTopDeckToExileEffectSchema,
  moveTopExileToDeckEffectSchema,
  revealTopDeckEffectSchema,
  moveSelectedOwnHandCardToTargetHandEffectSchema,
  revealRandomHandCardEffectSchema,
  destroySelectedHandCardEffectSchema,
  destroyRandomHandCardEffectSchema,
]);

const automationPhaseSchema = z.object({
  targetScope: z.enum(AUTOMATION_TARGET_SCOPES).optional(),
  selection: z.enum(AUTOMATION_SELECTIONS).optional(),
  effects: z.array(cardAutomationEffectSchema).min(1),
});

const cardAutomationConfigSchema = z.object({
  canDiscard: z.boolean().optional(),
  canPlayTogether: z.boolean().optional(),
  playAutomation: automationPhaseSchema.nullish(),
  discardAutomation: automationPhaseSchema.nullish(),
});

function normalizeCardAutomationConfig(input) {
  const parsed = cardAutomationConfigSchema.parse(input || {});

  return {
    canDiscard: parsed.canDiscard ?? true,
    canPlayTogether: parsed.canPlayTogether ?? false,
    playAutomation: parsed.playAutomation ?? null,
    discardAutomation: parsed.canDiscard === false ? null : parsed.discardAutomation ?? null,
  };
}

module.exports = {
  AUTOMATION_EFFECT_TARGETS,
  AUTOMATION_SELECTIONS,
  AUTOMATION_TARGET_SCOPES,
  automationPhaseSchema,
  cardAutomationConfigSchema,
  cardAutomationEffectSchema,
  normalizeCardAutomationConfig,
};
