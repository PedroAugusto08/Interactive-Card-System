const { z } = require('zod');

const AUTOMATION_TARGET_SCOPES = ['selected-player', 'other-player'];
const AUTOMATION_SELECTIONS = ['own-exiled-card-id', 'own-hand-card', 'target-hand-card'];
const AUTOMATION_EFFECT_TARGETS = ['self', 'selected-player'];
const ACTION_SLOTS = ['standard', 'complementary'];

const gainCatalogCardToHandEffectSchema = z.object({
  type: z.literal('gainCatalogCardToHand'),
  cardId: z.string().trim().min(1),
});

const restoreSelectedExiledCardIdEffectSchema = z.object({
  type: z.literal('restoreSelectedExiledCardId'),
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

const cardAutomationEffectSchema = z.discriminatedUnion('type', [
  gainCatalogCardToHandEffectSchema,
  restoreSelectedExiledCardIdEffectSchema,
  moveSelectedOwnHandCardToTargetHandEffectSchema,
  revealRandomHandCardEffectSchema,
  destroySelectedHandCardEffectSchema,
]);

const automationPhaseSchema = z.object({
  targetScope: z.enum(AUTOMATION_TARGET_SCOPES).optional(),
  selection: z.enum(AUTOMATION_SELECTIONS).optional(),
  effects: z.array(cardAutomationEffectSchema).min(1),
});

const cardAutomationConfigSchema = z.object({
  actionSlot: z.enum(ACTION_SLOTS).optional(),
  canExile: z.boolean().optional(),
  useAutomation: automationPhaseSchema.nullish(),
  exileAutomation: automationPhaseSchema.nullish(),
});

function normalizeCardAutomationConfig(input) {
  const parsed = cardAutomationConfigSchema.parse(input || {});

  return {
    actionSlot: parsed.actionSlot || 'standard',
    canExile: parsed.canExile !== false,
    useAutomation: parsed.useAutomation ?? null,
    exileAutomation: parsed.canExile === false ? null : parsed.exileAutomation ?? null,
  };
}

module.exports = {
  ACTION_SLOTS,
  AUTOMATION_EFFECT_TARGETS,
  AUTOMATION_SELECTIONS,
  AUTOMATION_TARGET_SCOPES,
  automationPhaseSchema,
  cardAutomationConfigSchema,
  cardAutomationEffectSchema,
  normalizeCardAutomationConfig,
};
