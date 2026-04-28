const AUTOMATION_TEMPLATES = [
  {
    id: 'none',
    label: 'Manual ou sem automacao',
    description: 'Mantem o efeito apenas no texto da carta, sem resolucao automatica.',
    phases: ['play', 'discard'],
    build: () => null,
  },
  {
    id: 'gainCatalogCardToHand',
    label: 'Gerar carta na mao',
    description: 'Cria uma copia de uma carta do catalogo diretamente na sua mao.',
    phases: ['play', 'discard'],
    requiresCatalogCardId: true,
    build: ({ generatedCardId }) =>
      generatedCardId
        ? {
            effects: [
              {
                type: 'gainCatalogCardToHand',
                cardId: generatedCardId,
              },
            ],
          }
        : null,
  },
  {
    id: 'recoverOwnExileToHand',
    label: 'Recuperar carta do exilio',
    description: 'Escolhe uma carta do seu exilio e a devolve para a sua mao.',
    phases: ['play', 'discard'],
    build: () => ({
      selection: 'own-exile-card',
      effects: [
        {
          type: 'moveSelectedExileCardToHand',
        },
      ],
    }),
  },
  {
    id: 'drawTopDeckToHandSelf',
    label: 'Comprar uma carta',
    description: 'Compra o topo do proprio deck para a mao.',
    phases: ['play', 'discard'],
    build: () => ({
      effects: [
        {
          type: 'drawTopDeckToHand',
          target: 'self',
        },
      ],
    }),
  },
  {
    id: 'drawTopDeckToHandOther',
    label: 'Outro jogador compra',
    description: 'Escolhe outro jogador para comprar o topo do deck.',
    phases: ['play', 'discard'],
    build: () => ({
      targetScope: 'other-player',
      effects: [
        {
          type: 'drawTopDeckToHand',
          target: 'selected-player',
        },
      ],
    }),
  },
  {
    id: 'moveTopDeckToExileSelf',
    label: 'Exilar topo do proprio deck',
    description: 'Move o topo do seu deck para o exilio.',
    phases: ['play', 'discard'],
    build: () => ({
      effects: [
        {
          type: 'moveTopDeckToExile',
          target: 'self',
        },
      ],
    }),
  },
  {
    id: 'moveTopDeckToExileOther',
    label: 'Exilar topo do deck de um alvo',
    description: 'Escolhe um jogador e exila a carta no topo do deck dele.',
    phases: ['play', 'discard'],
    build: () => ({
      targetScope: 'selected-player',
      effects: [
        {
          type: 'moveTopDeckToExile',
          target: 'selected-player',
        },
      ],
    }),
  },
  {
    id: 'moveTopExileToDeckSelfShuffle',
    label: 'Voltar exilio proprio ao deck',
    description: 'Retorna o topo do seu exilio para o deck embaralhando.',
    phases: ['play', 'discard'],
    build: () => ({
      effects: [
        {
          type: 'moveTopExileToDeck',
          target: 'self',
          shuffleIntoDeck: true,
        },
      ],
    }),
  },
  {
    id: 'moveTopExileToDeckOtherShuffle',
    label: 'Voltar exilio de outro jogador',
    description: 'Escolhe outro jogador e devolve o topo do exilio dele para o deck embaralhando.',
    phases: ['play', 'discard'],
    build: () => ({
      targetScope: 'other-player',
      effects: [
        {
          type: 'moveTopExileToDeck',
          target: 'selected-player',
          shuffleIntoDeck: true,
        },
      ],
    }),
  },
  {
    id: 'revealTopDeckOther',
    label: 'Revelar topo do deck de um alvo',
    description: 'Escolhe um jogador e revela o topo do deck dele para quem jogou.',
    phases: ['play', 'discard'],
    build: () => ({
      targetScope: 'selected-player',
      effects: [
        {
          type: 'revealTopDeck',
          target: 'selected-player',
        },
      ],
    }),
  },
];

const TEMPLATE_BY_ID = new Map(AUTOMATION_TEMPLATES.map((template) => [template.id, template]));

export function buildDefaultImoForm() {
  return {
    name: '',
    description: '',
    maxCopies: 1,
    imoCost: 1,
    imagePath: '',
    canDiscard: true,
    canPlayTogether: false,
    playTemplateId: 'none',
    discardTemplateId: 'none',
    playGeneratedCardId: '',
    discardGeneratedCardId: '',
  };
}

export function getImoAutomationTemplateOptions(phase) {
  return AUTOMATION_TEMPLATES.filter((template) => template.phases.includes(phase));
}

export function buildImoAutomationPayload(form) {
  const playTemplate = TEMPLATE_BY_ID.get(form.playTemplateId) || TEMPLATE_BY_ID.get('none');
  const discardTemplate = TEMPLATE_BY_ID.get(form.discardTemplateId) || TEMPLATE_BY_ID.get('none');
  const canDiscard = form.canDiscard !== false;

  return {
    canDiscard,
    canPlayTogether: Boolean(form.canPlayTogether),
    playAutomation:
      playTemplate?.build({
        generatedCardId: form.playGeneratedCardId,
      }) || null,
    discardAutomation: canDiscard
      ? discardTemplate?.build({
          generatedCardId: form.discardGeneratedCardId,
        }) || null
      : null,
  };
}

export function templateRequiresGeneratedCardSelection(templateId) {
  return Boolean(TEMPLATE_BY_ID.get(templateId)?.requiresCatalogCardId);
}

export function buildImoAutomationSummary({
  canDiscard,
  canPlayTogether,
  playTemplateId,
  discardTemplateId,
  playGeneratedCardId,
  discardGeneratedCardId,
  catalogMap,
}) {
  const items = [];
  const resolvedCanDiscard = canDiscard !== false;

  if (!resolvedCanDiscard) {
    items.push('Nao pode ser descartada.');
  }

  if (canPlayTogether) {
    items.push('Pode ser jogada junto com outra carta.');
  }

  const playSummary = describeTemplateSelection(playTemplateId, playGeneratedCardId, catalogMap);
  if (playSummary) {
    items.push(`Ao jogar: ${playSummary}.`);
  }

  if (resolvedCanDiscard) {
    const discardSummary = describeTemplateSelection(
      discardTemplateId,
      discardGeneratedCardId,
      catalogMap
    );
    if (discardSummary) {
      items.push(`Ao descartar: ${discardSummary}.`);
    }
  }

  return items;
}

function describeTemplateSelection(templateId, generatedCardId, catalogMap) {
  if (!templateId || templateId === 'none') {
    return '';
  }

  const template = TEMPLATE_BY_ID.get(templateId);
  if (!template) {
    return '';
  }

  if (template.id === 'gainCatalogCardToHand') {
    const cardName = catalogMap?.get(generatedCardId)?.name || 'carta selecionada';
    return `gera ${cardName} na mao`;
  }

  return template.label.charAt(0).toLowerCase() + template.label.slice(1);
}
