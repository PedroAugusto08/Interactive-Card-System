const { findRoomById, isPlayerInRoom, listRoomPlayers, updateRoomState } = require('../models/roomModel');
const {
  addMatchLog,
  createMatch,
  createMatchParticipant,
  findActiveMatchByRoomId,
  findMatchParticipantById,
  listMatchLogs,
  listMatchParticipants,
  listMatchParticipantsByController,
  updateMatchParticipant,
  updateMatchState,
} = require('../models/matchModel');
const { listCharactersByIds } = require('../models/characterModel');
const { DIVISION_ACTION_CATALOG, getDivisionActionById } = require('../config/cardsCatalog');
const { getDivisionById } = require('../config/divisionCatalog');
const { AppError } = require('../utils/AppError');
const { getResolvedCharacterForUser, resolveCardById } = require('./characterService');
const { resolveRoomMasterUserId } = require('./masterOverride');
const {
  buildLobbyParticipantEntries,
  buildViewerMetadata,
  getNextActiveParticipant,
  normalizeSelectedCharacterIds,
  shouldRevealParticipantPrivateState,
  validateTurnOrderDraft,
} = require('./participantUtils');

const MAX_HAND_SIZE = 3;
const OPENING_HAND_SIZE = 2;
const ATTACK_DAMAGE = 1;
const FLAGELADO_TEMP_IMO_GAIN = 1;
const EXECUTOR_ATTACK_COOLDOWN_TURNS = 2;
const COMBAT_STATUS = {
  ACTIVE: 'active',
  DOWN: 'down',
  REMOVED: 'removed',
};

async function startMatchForRoom({ roomId, userId, requesterUser = null, includeSnapshot = true }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala não encontrada.', 404);
  }

  const players = await listRoomPlayers(roomId);
  const masterUserId = resolveRoomMasterUserId({ room, requesterUser, players });
  if (masterUserId !== userId) {
    throw new AppError('Somente o mestre pode iniciar a partida.', 403);
  }

  if (room.status !== 'lobby') {
    throw new AppError('A sala não está em lobby para iniciar partida.', 409);
  }

  if (players.length < 2) {
    throw new AppError('A partida precisa de ao menos 2 jogadores.', 409);
  }

  const normalizedPlayers = await buildNormalizedRoomPlayers({ room, players, masterUserId });
  const masterPlayer = normalizedPlayers.find((player) => player.user_id === masterUserId);
  if (!masterPlayer?.selected_character_ids.length) {
    throw new AppError('O mestre precisa selecionar ao menos um personagem.', 409);
  }

  const playersWithoutCharacter = normalizedPlayers.filter(
    (player) => !player.is_master && !player.selected_character_id
  );
  if (playersWithoutCharacter.length) {
    throw new AppError('Todos os jogadores precisam selecionar um personagem.', 409);
  }

  const playersNotReady = normalizedPlayers.filter((player) => !player.is_ready);
  if (playersNotReady.length) {
    throw new AppError('Todos os jogadores precisam estar prontos.', 409);
  }

  const lobbyParticipants = buildLobbyParticipantEntries({
    players: normalizedPlayers,
    characterMap: buildCharacterMapFromPlayers(normalizedPlayers),
    masterUserId,
  });
  const lobbyCharacterMap = buildCharacterMapFromPlayers(normalizedPlayers);
  const validation = validateTurnOrderDraft({
    lobbyEntries: lobbyParticipants,
    draftEntryIds: room.turn_order_draft_json || [],
  });
  if (!validation.ok) {
    throw new AppError(validation.reason, 409);
  }

  const activeMatch = await findActiveMatchByRoomId(roomId);
  if (activeMatch) {
    throw new AppError('Já existe uma partida ativa para esta sala.', 409);
  }

  const match = await createMatch({
    roomId,
    currentTurnParticipantId: null,
    currentTurnPlayerId: null,
    status: 'opening',
    combatState: createEmptyCombatState(),
  });

  const lobbyParticipantsByEntryId = new Map(lobbyParticipants.map((entry) => [entry.entryId, entry]));

  for (let index = 0; index < room.turn_order_draft_json.length; index += 1) {
    const draftEntryId = room.turn_order_draft_json[index];
    const lobbyParticipant = lobbyParticipantsByEntryId.get(draftEntryId);
    if (!lobbyParticipant) {
      throw new AppError('A ordem de turno ficou inconsistente.', 409);
    }

    const sourceCharacter = lobbyCharacterMap.get(lobbyParticipant.sourceCharacterId);
    const initialCarne = Number(sourceCharacter?.base_carne || 5);
    const initialImo = Number(sourceCharacter?.base_imo || 5);

    await createMatchParticipant({
      matchId: match.id,
      controllerUserId: lobbyParticipant.controllerUserId,
      participantType: lobbyParticipant.participantType,
      sourceCharacterId: lobbyParticipant.sourceCharacterId,
      displayName: lobbyParticipant.displayName,
      turnOrder: index + 1,
      health: initialCarne,
      imo: initialImo,
      maxImo: initialImo,
      currentCarne: initialCarne,
      currentImo: initialImo,
      hasGeneratedImoThisTurn: false,
      standardActionUsed: false,
      complementaryActionUsed: false,
      hasExiledImoThisTurn: false,
      openingHandReady: false,
      isDefeated: false,
      handCards: [],
      exiledImoCardIds: [],
      generatedAllyImoCardKeys: [],
    });
  }

  await updateRoomState({
    roomId: room.id,
    hostId: room.host_id,
    status: 'in_match',
    turnOrderDraft: room.turn_order_draft_json || [],
  });

  await addMatchLog({
    matchId: match.id,
    type: 'MATCH_START',
    message: 'A partida foi iniciada. Cada participante deve escolher 2 cartas iniciais de Imo.',
    payload: { roomId: room.id },
  });

  if (!includeSnapshot) {
    return null;
  }

  return getMatchSnapshot({ roomId, userId });
}

async function getMatchSnapshot({ roomId, userId }) {
  const context = await loadMatchSnapshotContext({ roomId, userId });
  return buildMatchSnapshot({
    ...context,
    userId,
  });
}

async function getRealtimeMatchStatesForUsers({ roomId, userIds = [] }) {
  const requesterIds = [...new Set((userIds || []).map((value) => Number(value)).filter(Number.isInteger))];
  if (!requesterIds.length) {
    return {
      latestLog: null,
      snapshotsByUserId: new Map(),
      metrics: { totalMs: 0 },
    };
  }

  const match = await findActiveMatchByRoomId(roomId);
  if (!match) {
    return {
      latestLog: null,
      snapshotsByUserId: new Map(),
      metrics: { totalMs: 0 },
    };
  }

  const [participants, latestLogs] = await Promise.all([listMatchParticipants(match.id), listMatchLogs(match.id, 1)]);
  const latestLog = latestLogs[0] ? mapLogRecord(latestLogs[0]) : null;
  const characterCache = new Map();

  const snapshots = await Promise.all(
    requesterIds.map(async (requesterUserId) => [
      requesterUserId,
      await buildRealtimeMatchState({
        activeMatch: match,
        participants,
        userId: requesterUserId,
        characterCache,
      }),
    ])
  );

  return {
    latestLog,
    snapshotsByUserId: new Map(snapshots),
    metrics: { totalMs: 0 },
  };
}

async function completeOpeningHandForPlayer({
  roomId,
  userId,
  actingParticipantId,
  selectedCardIds,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  if (context.match.status !== 'opening') {
    throw new AppError('A abertura inicial já foi concluída.', 409);
  }

  if (context.currentParticipant.opening_hand_ready) {
    throw new AppError('Essa criatura já concluiu a escolha inicial.', 409);
  }

  const normalizedIds = Array.isArray(selectedCardIds) ? selectedCardIds.map((value) => String(value || '').trim()) : [];
  if (normalizedIds.length !== OPENING_HAND_SIZE) {
    throw new AppError('Escolha exatamente 2 cartas de Imo para a abertura.', 400);
  }

  const { imoCards } = await getResolvedCharacterForUser({
    characterId: context.currentParticipant.source_character_id,
    ownerId: context.currentParticipant.controller_user_id,
  });
  const catalogMap = new Map(imoCards.map((card) => [card.id, card]));

  const handCards = normalizedIds.map((cardId) => {
    if (!catalogMap.has(cardId)) {
      throw new AppError(`Carta inicial inválida: ${cardId}.`, 400);
    }

    return createMatchCardEntry({
      cardId,
      ownerParticipantId: context.currentParticipant.id,
      catalogOwnerId: context.currentParticipant.controller_user_id,
    });
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  actingParticipant.hand_cards_json = handCards;
  actingParticipant.opening_hand_ready = true;

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });

  let updatedMatch = context.match;
  let logMessage = `${context.currentParticipant.display_name} escolheu a mão inicial de Imo.`;

  if ([...updatedParticipantsById.values()].every((participant) => participant.opening_hand_ready)) {
    const orderedParticipants = [...updatedParticipantsById.values()]
      .filter((participant) => !participant.is_defeated)
      .sort((left, right) => left.turn_order - right.turn_order);
    const firstParticipant = orderedParticipants[0] || null;

    updatedMatch = await updateMatchState({
      matchId: context.match.id,
      status: 'active',
      round: 1,
      currentTurnPlayerId: firstParticipant?.controller_user_id || null,
      currentTurnParticipantId: firstParticipant?.id || null,
      winnerUserId: null,
      winnerParticipantId: null,
      combatState: normalizeCombatState(context.match.combat_state_json),
    });
    logMessage = 'Todos os participantes concluíram a abertura. A rodada 1 começou.';
  }

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: updatedMatch.status === 'active' ? 'MATCH_OPENING_COMPLETE' : 'MATCH_OPENING_PICK',
    message: logMessage,
    payload: {
      actingParticipantId: context.currentParticipant.id,
      selectedCardIds: normalizedIds,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatch,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
    }),
  });
}

async function generateImoForPlayer({
  roomId,
  userId,
  actingParticipantId,
  cardId,
  selectedCardIds = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const actingParticipantCombatState = getParticipantCombatState(combatState, actingParticipant.id);
  const { imoCards, division } = await getResolvedCharacterForUser({
    characterId: actingParticipant.source_character_id,
    ownerId: actingParticipant.controller_user_id,
  });
  const requestedCardIds = Array.isArray(selectedCardIds) && selectedCardIds.length
    ? selectedCardIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [String(cardId || '').trim()].filter(Boolean);
  const canUseRuinRatGeneration = division?.id === 'rato-de-ruina';

  if (actingParticipant.has_generated_imo_this_turn) {
    throw new AppError('Essa criatura já gerou uma carta de Imo neste turno.', 409);
  }

  if ((actingParticipant.hand_cards_json || []).length >= MAX_HAND_SIZE) {
    throw new AppError('A mão já está no limite de 3 cartas.', 409);
  }

  if (!requestedCardIds.length) {
    throw new AppError('Escolha ao menos uma carta de Imo para gerar.', 400);
  }

  const availableHandSpace = MAX_HAND_SIZE - (actingParticipant.hand_cards_json || []).length;
  if (requestedCardIds.length > availableHandSpace) {
    throw new AppError(
      availableHandSpace <= 1
        ? 'Essa criatura só pode gerar 1 carta porque resta apenas 1 espaço na mão.'
        : 'A mão não comporta todas as cartas de Imo escolhidas.',
      409
    );
  }

  if (!canUseRuinRatGeneration && requestedCardIds.length !== 1) {
    throw new AppError('Essa criatura só pode gerar 1 carta de Imo por vez.', 409);
  }

  if (canUseRuinRatGeneration && requestedCardIds.length > 2) {
    throw new AppError('Rato de Ruína pode gerar no máximo 2 cartas por turno.', 409);
  }

  const catalogMap = new Map(imoCards.map((item) => [item.id, item]));
  const cardsToGenerate = requestedCardIds.map((requestedCardId) => {
    if ((actingParticipant.exiled_imo_card_ids_json || []).includes(requestedCardId)) {
      throw new AppError('Uma das cartas escolhidas está exilada para essa criatura.', 409);
    }

    const catalogCard = catalogMap.get(requestedCardId);
    if (!catalogCard) {
      throw new AppError('Uma das cartas escolhidas não pertence ao conjunto de Imo do personagem.', 404);
    }

    return catalogCard;
  });

  const totalImoCost = cardsToGenerate.reduce((sum, currentCard) => sum + Number(currentCard.imoCost || 0), 0);
  if (getSpendableImo(actingParticipant, actingParticipantCombatState) < totalImoCost) {
    throw new AppError('Imo insuficiente para gerar as cartas escolhidas.', 409);
  }

  consumeActionSlot({ participant: actingParticipant, actionSlot: 'complementary' });
  spendImo({
    participant: actingParticipant,
    participantCombatState: actingParticipantCombatState,
    amount: totalImoCost,
  });
  actingParticipant.has_generated_imo_this_turn = true;
  actingParticipant.hand_cards_json = [
    ...actingParticipant.hand_cards_json,
    ...cardsToGenerate.map((generatedCard) =>
      createMatchCardEntry({
        cardId: generatedCard.id,
        ownerParticipantId: actingParticipant.id,
        catalogOwnerId: actingParticipant.controller_user_id,
      })
    ),
  ];

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });
  const updatedMatch = await updateMatchState({
    matchId: context.match.id,
    status: context.match.status,
    round: context.match.round,
    currentTurnPlayerId: context.match.current_turn_player_id,
    currentTurnParticipantId: context.match.current_turn_participant_id,
    winnerUserId: context.match.winner_user_id,
    winnerParticipantId: context.match.winner_participant_id,
    combatState,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_GENERATE_IMO',
    message: `${actingParticipant.display_name} gerou ${cardsToGenerate.map((item) => item.name).join(' e ')}.`,
    payload: {
      actingParticipantId: actingParticipant.id,
      cardIds: cardsToGenerate.map((item) => item.id),
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatch,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice:
        cardsToGenerate.length > 1
          ? `${actingParticipant.display_name} gerou ${cardsToGenerate.length} cartas de Imo usando a passiva de Rato de Ruína.`
          : '',
    }),
  });
}

async function useImoCardForPlayer({
  roomId,
  userId,
  actingParticipantId,
  cardId,
  targetParticipantId = null,
  selectedExiledCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const handCards = [...actingParticipant.hand_cards_json];
  const cardIndex = handCards.findIndex((entry) => entry.instanceId === cardId);
  if (cardIndex < 0) {
    throw new AppError('Carta de Imo não encontrada na mão.', 404);
  }

  const [usedCard] = handCards.splice(cardIndex, 1);
  const resolvedCard = await resolveMatchCardEntry({
    cardEntry: usedCard,
    fallbackOwnerUserId: actingParticipant.controller_user_id,
  });
  if (!resolvedCard) {
    throw new AppError('Carta de Imo não encontrada no catálogo.', 404);
  }

  consumeActionSlot({ participant: actingParticipant, actionSlot: resolvedCard.actionSlot || 'standard' });
  actingParticipant.hand_cards_json = handCards;

  const automationOutcome = await applyAutomation({
    ownerUserId: actingParticipant.controller_user_id,
    automation: resolvedCard.useAutomation,
    actingParticipant,
    participantsById,
    targetParticipantId,
    selectedExiledCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
  });
  const passiveOutcome = await applyPostUseImoPassives({
    actingParticipant,
    participantsById,
    combatState,
  });

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });
  const updatedMatch = await buildUpdatedMatchStateAfterAction({
    match: context.match,
    participantsById: updatedParticipantsById,
    combatState,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_USE_IMO',
    message: `${actingParticipant.display_name} usou ${resolvedCard.name}.`,
    payload: {
      actingParticipantId,
      cardId: usedCard.cardId,
      targetParticipantId,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatch,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice: automationOutcome.notices.join(' '),
      effectResults: [...automationOutcome.effects, ...passiveOutcome.effectResults],
      privateEffectsByUserId: passiveOutcome.privateEffectsByUserId,
    }),
  });
}

async function exileImoCardForPlayer({
  roomId,
  userId,
  actingParticipantId,
  cardId,
  generatedSourceParticipantId = null,
  generatedCardId = null,
  targetParticipantId = null,
  selectedExiledCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const handCards = [...actingParticipant.hand_cards_json];
  const cardIndex = handCards.findIndex((entry) => entry.instanceId === cardId);
  if (cardIndex < 0) {
    throw new AppError('Carta de Imo não encontrada na mão.', 404);
  }

  const [exiledCard] = handCards.splice(cardIndex, 1);
  const resolvedCard = await resolveMatchCardEntry({
    cardEntry: exiledCard,
    fallbackOwnerUserId: actingParticipant.controller_user_id,
  });
  if (!resolvedCard) {
    throw new AppError('Carta de Imo não encontrada no catálogo.', 404);
  }

  if (resolvedCard.canExile === false) {
    throw new AppError(`A carta ${resolvedCard.name} não pode ser exilada manualmente.`, 409);
  }

  consumeActionSlot({ participant: actingParticipant, actionSlot: 'standard' });
  actingParticipant.hand_cards_json = handCards;
  actingParticipant.exiled_imo_card_ids_json = addUniqueCardId(actingParticipant.exiled_imo_card_ids_json, exiledCard.cardId);
  actingParticipant.has_exiled_imo_this_turn = true;

  let generatedCardNotice = '';
  const normalizedGeneratedCardId = String(generatedCardId || '').trim();
  if (normalizedGeneratedCardId) {
    const generatedOutcome = await generateFreeImoFromExile({
      participantsById,
      actingParticipant,
      sourceParticipantId: generatedSourceParticipantId,
      cardId: normalizedGeneratedCardId,
    });
    actingParticipant.hand_cards_json = [
      ...actingParticipant.hand_cards_json,
      createMatchCardEntry(generatedOutcome.cardEntry),
    ];
    if (generatedOutcome.generatedAllyCardKey) {
      actingParticipant.generated_ally_imo_card_keys_json = addUniqueCardId(
        actingParticipant.generated_ally_imo_card_keys_json,
        generatedOutcome.generatedAllyCardKey
      );
    }
    generatedCardNotice = generatedOutcome.notice;
  }

  const automationOutcome = await applyAutomation({
    ownerUserId: actingParticipant.controller_user_id,
    automation: resolvedCard.exileAutomation,
    actingParticipant,
    participantsById,
    targetParticipantId,
    selectedExiledCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
  });

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });
  const updatedMatch = await updateMatchState({
    matchId: context.match.id,
    status: context.match.status,
    round: context.match.round,
    currentTurnPlayerId: context.match.current_turn_player_id,
    currentTurnParticipantId: context.match.current_turn_participant_id,
    winnerUserId: context.match.winner_user_id,
    winnerParticipantId: context.match.winner_participant_id,
    combatState,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_EXILE_IMO',
    message: `${actingParticipant.display_name} exilou ${resolvedCard.name}.`,
    payload: {
      actingParticipantId,
      cardId: exiledCard.cardId,
      targetParticipantId,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatch,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice: [generatedCardNotice, ...automationOutcome.notices].filter(Boolean).join(' '),
      effectResults: automationOutcome.effects,
    }),
  });
}

async function useDivisionActionForPlayer({
  roomId,
  userId,
  actingParticipantId,
  divisionId,
  divisionInstanceId = null,
  targetParticipantId = null,
  selectedExiledCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const resolvedDivisionActions = await resolveParticipantDivisionActions({
    actingParticipant,
    combatState,
  });
  const normalizedDivisionInstanceId = String(divisionInstanceId || '').trim();
  const divisionAction =
    resolvedDivisionActions.find((item) => normalizedDivisionInstanceId && item.instanceId === normalizedDivisionInstanceId) ||
    resolvedDivisionActions.find((item) => item.id === divisionId && !item.isTemporary);
  if (!divisionAction) {
    throw new AppError('Essa ação de Divisão não pertence ao personagem.', 404);
  }

  if (getSpendableImo(actingParticipant, getParticipantCombatState(combatState, actingParticipant.id)) < Number(divisionAction.imoCost || 0)) {
    throw new AppError('Imo insuficiente para usar essa ação de Divisão.', 409);
  }

  assertDivisionActionCanBeUsed({ actingParticipant, divisionCard: divisionAction });
  consumeActionSlot({ participant: actingParticipant, actionSlot: divisionAction.actionSlot || 'complementary' });
  spendImo({
    participant: actingParticipant,
    participantCombatState: getParticipantCombatState(combatState, actingParticipant.id),
    amount: Number(divisionAction.imoCost || 0),
  });

  const automationOutcome = await applyAutomation({
    ownerUserId: actingParticipant.controller_user_id,
    automation: divisionAction.useAutomation,
    actingParticipant,
    participantsById,
    targetParticipantId,
    selectedExiledCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
  });
  if (divisionAction.isTemporary) {
    removeTemporaryDivisionAction({
      combatState,
      participantId: actingParticipant.id,
      divisionInstanceId: divisionAction.instanceId,
    });
  }

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });
  const updatedMatch = await buildUpdatedMatchStateAfterAction({
    match: context.match,
    participantsById: updatedParticipantsById,
    combatState,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_USE_DIVISION',
    message: `${actingParticipant.display_name} usou ${divisionAction.name}.`,
    payload: {
      actingParticipantId,
      divisionId,
      divisionInstanceId: divisionAction.instanceId,
      targetParticipantId,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatch,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice: buildDivisionActionNotice({ divisionCard: divisionAction, automationOutcome }),
      effectResults: automationOutcome.effects,
    }),
  });
}

async function usePassiveActionForPlayer({
  roomId,
  userId,
  actingParticipantId,
  passiveActionId,
  targetParticipantId = null,
  selectedOwnHandCardId = null,
  selectedCatalogCardId = null,
  selectedDivisionActionId = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const { division, imoCards } = await getResolvedCharacterForUser({
    characterId: actingParticipant.source_character_id,
    ownerId: actingParticipant.controller_user_id,
  });
  const passiveConfig = division?.passiveConfig || null;
  if (!passiveConfig || passiveConfig.id !== passiveActionId || passiveConfig.type !== 'active') {
    throw new AppError('Essa criatura não possui essa ação passiva.', 404);
  }

  if (passiveConfig.actionSlot && passiveConfig.actionSlot !== 'free') {
    consumeActionSlot({ participant: actingParticipant, actionSlot: passiveConfig.actionSlot });
  }

  if (getSpendableImo(actingParticipant, getParticipantCombatState(combatState, actingParticipant.id)) < Number(passiveConfig.imoCost || 0)) {
    throw new AppError('Imo insuficiente para usar essa passiva.', 409);
  }

  if (passiveConfig.id === 'condutor-share-imo') {
    const targetState = resolvePassiveTargetState({
      actingParticipant,
      participantsById,
      targetParticipantId,
      targetScope: passiveConfig.targetScope,
    });
    if (!selectedOwnHandCardId) {
      throw new AppError('Escolha uma carta da mão do Condutor para consumir.', 400);
    }
    if (!selectedCatalogCardId) {
      throw new AppError('Escolha uma carta do catálogo do Condutor para entregar ao aliado.', 400);
    }

    const ownHandIndex = actingParticipant.hand_cards_json.findIndex((entry) => entry.instanceId === selectedOwnHandCardId);
    if (ownHandIndex < 0) {
      throw new AppError('A carta escolhida não está na mão do Condutor.', 404);
    }
    if ((targetState.hand_cards_json || []).length >= MAX_HAND_SIZE) {
      throw new AppError('A mão do aliado já está cheia.', 409);
    }

    const [consumedEntry] = actingParticipant.hand_cards_json.splice(ownHandIndex, 1);
    const consumedCard = await resolveMatchCardEntry({
      cardEntry: consumedEntry,
      fallbackOwnerUserId: actingParticipant.controller_user_id,
    });
    const catalogCard = imoCards.find((item) => item.id === selectedCatalogCardId);
    if (!consumedCard || !catalogCard) {
      throw new AppError('A combinação escolhida para a passiva do Condutor é inválida.', 404);
    }
    if (Number(consumedCard.imoCost || 0) !== Number(catalogCard.imoCost || 0)) {
      throw new AppError('A carta entregue ao aliado precisa ter o mesmo custo da carta consumida.', 409);
    }

    spendImo({
      participant: actingParticipant,
      participantCombatState: getParticipantCombatState(combatState, actingParticipant.id),
      amount: Number(passiveConfig.imoCost || 0),
    });
    targetState.hand_cards_json = [
      ...(targetState.hand_cards_json || []),
      createMatchCardEntry({
        cardId: catalogCard.id,
        ownerParticipantId: targetState.id,
        catalogOwnerId: actingParticipant.controller_user_id,
      }),
    ];

    const updatedParticipantsById = await persistParticipantStates({
      participantsById,
      originalParticipants: context.participants,
    });
    const updatedMatch = await buildUpdatedMatchStateAfterAction({
      match: context.match,
      participantsById: updatedParticipantsById,
      combatState,
    });
    const createdLog = await addMatchLog({
      matchId: context.match.id,
      type: 'MATCH_USE_PASSIVE',
      message: `${actingParticipant.display_name} usou a passiva de Condutor de Ecos.`,
      payload: {
        actingParticipantId,
        passiveActionId,
        targetParticipantId: targetState.id,
        selectedCatalogCardId,
      },
    });

    return finalizeActionResponse({
      roomId,
      userId,
      includeSnapshot,
      actionState: await buildActionRealtimeState({
        activeMatch: updatedMatch,
        participants: [...updatedParticipantsById.values()],
        currentUserId: userId,
        log: createdLog,
        notice: `${targetState.display_name} recebeu ${catalogCard.name} pela passiva de Condutor de Ecos.`,
      }),
    });
  }

  if (passiveConfig.id === 'remendador-borrow-division') {
    if (!selectedDivisionActionId) {
      throw new AppError('Escolha uma carta de Divisão para preparar no arsenal.', 400);
    }
    const divisionAction = getDivisionActionById(selectedDivisionActionId);
    if (!divisionAction) {
      throw new AppError('A carta de Divisão escolhida é inválida.', 404);
    }

    spendImo({
      participant: actingParticipant,
      participantCombatState: getParticipantCombatState(combatState, actingParticipant.id),
      amount: Number(passiveConfig.imoCost || 0),
    });
    addTemporaryDivisionAction({
      combatState,
      participantId: actingParticipant.id,
      actionId: divisionAction.id,
    });

    const updatedParticipantsById = await persistParticipantStates({
      participantsById,
      originalParticipants: context.participants,
    });
    const updatedMatch = await buildUpdatedMatchStateAfterAction({
      match: context.match,
      participantsById: updatedParticipantsById,
      combatState,
    });
    const createdLog = await addMatchLog({
      matchId: context.match.id,
      type: 'MATCH_USE_PASSIVE',
      message: `${actingParticipant.display_name} preparou ${divisionAction.name} com a passiva de Remendador.`,
      payload: {
        actingParticipantId,
        passiveActionId,
        selectedDivisionActionId,
      },
    });

    return finalizeActionResponse({
      roomId,
      userId,
      includeSnapshot,
      actionState: await buildActionRealtimeState({
        activeMatch: updatedMatch,
        participants: [...updatedParticipantsById.values()],
        currentUserId: userId,
        log: createdLog,
        notice: `${divisionAction.name} foi adicionada ao arsenal como ação temporária de uso único.`,
      }),
    });
  }

  if (passiveConfig.id === 'executor-extra-attack') {
    return attackForPlayer({
      roomId,
      userId,
      actingParticipantId,
      targetParticipantId,
      attackKind: 'executor-extra',
      includeSnapshot,
    });
  }

  throw new AppError('Essa passiva ainda não possui resolução automática.', 409);
}

async function attackForPlayer({
  roomId,
  userId,
  actingParticipantId,
  targetParticipantId,
  attackKind = 'standard',
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(context.currentParticipant.id);
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const targetState = resolvePassiveTargetState({
    actingParticipant,
    participantsById,
    targetParticipantId,
    targetScope: 'selected-enemy',
  });

  if (attackKind === 'standard') {
    consumeActionSlot({ participant: actingParticipant, actionSlot: 'standard' });
  } else if (attackKind === 'executor-extra') {
    const actingDivision = getDivisionById((await getResolvedCharacterForUser({
      characterId: actingParticipant.source_character_id,
      ownerId: actingParticipant.controller_user_id,
    })).division?.id);
    if (actingDivision?.id !== 'executor-desgastado') {
      throw new AppError('Essa criatura não pode usar ataque extra de Executor.', 403);
    }

    const participantCombatState = getParticipantCombatState(combatState, actingParticipant.id);
    if (Number(participantCombatState.executorCooldownTurns || 0) > 0) {
      throw new AppError('O ataque extra do Executor ainda está em recarga.', 409);
    }
    participantCombatState.executorCooldownTurns = EXECUTOR_ATTACK_COOLDOWN_TURNS;
  } else {
    throw new AppError('Tipo de ataque inválido.', 400);
  }

  const attackSuccess = rollAttackOutcome();
  const damageNotices = [];
  if (attackSuccess) {
    damageNotices.push(
      ...(await applyDamageToParticipant({
        targetParticipantId: targetState.id,
        damageAmount: ATTACK_DAMAGE,
        participantsById,
        combatState,
      }))
    );
  } else if (attackKind === 'executor-extra') {
    damageNotices.push(
      ...(await applyDamageToParticipant({
        targetParticipantId: actingParticipant.id,
        damageAmount: 1,
        participantsById,
        combatState,
      }))
    );
  }

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });
  const updatedMatch = await buildUpdatedMatchStateAfterAction({
    match: context.match,
    participantsById: updatedParticipantsById,
    combatState,
  });
  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_ATTACK',
    message: `${actingParticipant.display_name} realizou ${attackKind === 'executor-extra' ? 'um ataque extra' : 'um ataque'} contra ${targetState.display_name}.`,
    payload: {
      actingParticipantId,
      targetParticipantId: targetState.id,
      attackKind,
      attackSuccess,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatch,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice: [
        attackSuccess
          ? `${actingParticipant.display_name} acertou o ataque em ${targetState.display_name}.`
          : `${actingParticipant.display_name} falhou o ataque.`,
        ...damageNotices,
      ].filter(Boolean).join(' '),
    }),
  });
}

async function endTurnForPlayer({ roomId, userId, actingParticipantId, includeSnapshot = true }) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });

  const combatState = normalizeCombatState(context.match.combat_state_json);
  const activeParticipants = context.participants.filter(
    (participant) =>
      getCombatStatus(participant, getParticipantCombatState(combatState, participant.id)) === COMBAT_STATUS.ACTIVE
  );
  const nextParticipant = getNextActiveParticipant(activeParticipants, context.currentParticipant.id);
  const nextRound =
    nextParticipant && nextParticipant.id === activeParticipants[0]?.id
      ? context.match.round + 1
      : context.match.round;

  const participantsById = createMutableParticipantMap(context.participants);
  const mutableCurrentParticipant = participantsById.get(context.currentParticipant.id);
  const mutableNextParticipant = participantsById.get(nextParticipant.id);
  mutableCurrentParticipant.has_exiled_imo_this_turn = false;
  const nextParticipantCombatState = getParticipantCombatState(combatState, mutableNextParticipant.id);
  mutableNextParticipant.current_imo = Math.min(
    mutableNextParticipant.max_imo,
    Number(mutableNextParticipant.current_imo ?? mutableNextParticipant.imo ?? 0) + 1
  );
  mutableNextParticipant.imo = mutableNextParticipant.current_imo;
  mutableNextParticipant.has_generated_imo_this_turn = false;
  mutableNextParticipant.standard_action_used = false;
  mutableNextParticipant.complementary_action_used = false;
  mutableNextParticipant.has_exiled_imo_this_turn = false;
  const currentParticipantCombatState = getParticipantCombatState(combatState, mutableCurrentParticipant.id);
  currentParticipantCombatState.temporaryCarne = 0;
  currentParticipantCombatState.temporaryImo = 0;
  currentParticipantCombatState.flageladoTriggered = false;
  if (Number(currentParticipantCombatState.executorCooldownTurns || 0) > 0) {
    currentParticipantCombatState.executorCooldownTurns -= 1;
  }
  nextParticipantCombatState.flageladoTriggered = false;
  updateCombatStatus({ participant: mutableCurrentParticipant, participantCombatState: currentParticipantCombatState });
  updateCombatStatus({ participant: mutableNextParticipant, participantCombatState: nextParticipantCombatState });

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });

  const updatedMatchState = await updateMatchState({
    matchId: context.match.id,
    status: 'active',
    round: nextRound,
    currentTurnPlayerId: nextParticipant.controller_user_id,
    currentTurnParticipantId: nextParticipant.id,
    winnerUserId: null,
    winnerParticipantId: null,
    combatState,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_END_TURN',
    message: `${context.currentParticipant.display_name} encerrou o turno.`,
    payload: { actingParticipantId },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
    }),
  });
}

async function forfeitMatchByLeavingRoom({ roomId, userId, closeRoom = false }) {
  const match = await findActiveMatchByRoomId(roomId);
  if (!match) {
    return null;
  }

  const controlledParticipants = await listMatchParticipantsByController({
    matchId: match.id,
    controllerUserId: userId,
  });
  if (!controlledParticipants.length) {
    return null;
  }

  const participants = await listMatchParticipants(match.id);
  const participantsById = createMutableParticipantMap(participants);
  const combatState = normalizeCombatState(match.combat_state_json);
  for (const participant of controlledParticipants) {
    const mutableParticipant = participantsById.get(participant.id);
    mutableParticipant.is_defeated = true;
    updateCombatStatus({
      participant: mutableParticipant,
      participantCombatState: getParticipantCombatState(combatState, mutableParticipant.id),
    });
  }

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: participants,
  });

  const activeParticipants = [...updatedParticipantsById.values()].filter(
    (participant) =>
      getCombatStatus(participant, getParticipantCombatState(combatState, participant.id)) === COMBAT_STATUS.ACTIVE
  );
  if (closeRoom || activeParticipants.length <= 1) {
    const winner = activeParticipants[0] || null;
    await updateMatchState({
      matchId: match.id,
      status: 'finished',
      round: match.round,
      currentTurnPlayerId: winner?.controller_user_id || null,
      currentTurnParticipantId: winner?.id || null,
      winnerUserId: winner?.controller_user_id || null,
      winnerParticipantId: winner?.id || null,
      combatState,
      endedAt: new Date(),
    });
    if (closeRoom) {
      await updateRoomState({
        roomId,
        hostId: null,
        status: 'finished',
        turnOrderDraft: undefined,
      });
    }
  }

  await addMatchLog({
    matchId: match.id,
    type: 'MATCH_FORFEIT',
    message: 'Um jogador deixou a partida e suas criaturas foram derrotadas.',
    payload: { userId },
  });

  return {
    matchId: match.id,
  };
}

async function loadMatchSnapshotContext({ roomId, userId, skipMembershipCheck = false }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala não encontrada.', 404);
  }

  if (!skipMembershipCheck) {
    const belongsToRoom = await isPlayerInRoom({ roomId, userId });
    if (!belongsToRoom) {
      throw new AppError('Você não pertence a esta sala.', 403);
    }
  }

  const players = await buildNormalizedRoomPlayers({
    room,
    players: await listRoomPlayers(roomId),
  });
  const activeMatch = await findActiveMatchByRoomId(roomId);

  if (!activeMatch) {
    return {
      room,
      players,
      activeMatch: null,
      participants: [],
      logs: [],
    };
  }

  const [participants, logs] = await Promise.all([listMatchParticipants(activeMatch.id), listMatchLogs(activeMatch.id)]);
  return {
    room,
    players,
    activeMatch,
    participants,
    logs,
  };
}

async function buildMatchSnapshot({ room, players, activeMatch, participants, logs, userId }) {
  if (!activeMatch) {
    return {
      room,
      players,
      match: null,
      currentTurnParticipantId: null,
      round: null,
      viewer: {
        userId,
        role: 'player',
        controlledParticipantIds: [],
        focusedParticipantId: null,
      },
      participantStates: [],
      logs: [],
    };
  }

  const characterCache = new Map();
  const participantStates = await buildParticipantStates({
    activeMatch,
    participants,
    requesterUserId: userId,
    characterCache,
  });

  const openingParticipant = participantStates.find(
    (participant) => participant.isControlledByViewer && participant.openingHandPending
  );
  const viewer = buildViewerMetadata({
    requesterUserId: userId,
    participantStates,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    openingParticipantId: openingParticipant?.participantId || null,
  });

  return {
    room,
    players,
    match: buildMatchState(activeMatch),
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    round: activeMatch.round,
    viewer,
    participantStates,
    logs: logs.map(mapLogRecord),
  };
}

async function buildRealtimeMatchState({ activeMatch, participants, userId, characterCache }) {
  const participantStates = await buildParticipantStates({
    activeMatch,
    participants,
    requesterUserId: userId,
    characterCache,
  });
  const openingParticipant = participantStates.find(
    (participant) => participant.isControlledByViewer && participant.openingHandPending
  );
  const viewer = buildViewerMetadata({
    requesterUserId: userId,
    participantStates,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    openingParticipantId: openingParticipant?.participantId || null,
  });

  return {
    match: buildMatchState(activeMatch),
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    round: activeMatch.round,
    viewer,
    participantStates,
  };
}

async function buildParticipantStates({ activeMatch, participants, requesterUserId, characterCache }) {
  return Promise.all(
    participants.map((participant) =>
      buildParticipantState({
        activeMatch,
        matchParticipant: participant,
        allParticipants: participants,
        requesterUserId,
        characterCache,
      })
    )
  );
}

async function buildParticipantState({ activeMatch, matchParticipant, allParticipants, requesterUserId, characterCache }) {
  const canRevealPrivateState = shouldRevealParticipantPrivateState({
    requesterUserId,
    participant: {
      controllerUserId: matchParticipant.controller_user_id,
    },
  });

  const resolvedCharacter = await getCharacterStateForParticipant({
    matchParticipant,
    characterCache,
  });
  const combatState = normalizeCombatState(activeMatch.combat_state_json);
  const participantCombatState = getParticipantCombatState(combatState, matchParticipant.id);
  const handCards = canRevealPrivateState
    ? await hydrateCards({
        fallbackOwnerUserId: matchParticipant.controller_user_id,
        cardEntries: matchParticipant.hand_cards_json || [],
      })
    : buildHiddenHandCards(matchParticipant.hand_cards_json || []);
  const availableImoCatalog = canRevealPrivateState
    ? (resolvedCharacter.imoCards || []).filter(
        (card) => !(matchParticipant.exiled_imo_card_ids_json || []).includes(card.id)
      )
    : [];
  const availableAllyImoSources = canRevealPrivateState
    ? await buildAvailableAllyImoSources({
        actingParticipant: matchParticipant,
        allParticipants,
        characterCache,
        combatState,
      })
    : [];
  const divisionActions = await resolveParticipantDivisionActions({
    actingParticipant: matchParticipant,
    combatState,
    resolvedCharacter,
  });
  const passiveState = buildParticipantPassiveState({
    matchParticipant,
    participantCombatState,
    division: resolvedCharacter.division,
  });
  const passiveActions = buildParticipantPassiveActions({
    matchParticipant,
    participantCombatState,
    division: resolvedCharacter.division,
    availableImoCatalog,
    handCards,
  });
  const combatStatus = getCombatStatus(matchParticipant, participantCombatState);
  const canTakeTurnAction =
    activeMatch.status === 'active' &&
    activeMatch.current_turn_participant_id === matchParticipant.id &&
    combatStatus === COMBAT_STATUS.ACTIVE;
  const baseCarne = Number(resolvedCharacter.character?.base_carne || 0);
  const baseImo = Number(resolvedCharacter.character?.base_imo || 0);
  const currentCarne = Number(matchParticipant.current_carne ?? matchParticipant.health ?? 0);
  const currentImo = Number(matchParticipant.current_imo ?? matchParticipant.imo ?? 0);
  const temporaryCarne = Number(participantCombatState.temporaryCarne || 0);
  const temporaryImo = Number(participantCombatState.temporaryImo || 0);
  const effectiveCarne = getEffectiveCarne(matchParticipant, participantCombatState);
  const effectiveImo = getEffectiveImo(matchParticipant, participantCombatState);

  return {
    participantId: matchParticipant.id,
    controllerUserId: matchParticipant.controller_user_id,
    controllerUsername: matchParticipant.controller_username,
    displayName: matchParticipant.display_name,
    participantType: matchParticipant.participant_type,
    sourceCharacterId: matchParticipant.source_character_id,
    turnOrder: matchParticipant.turn_order,
    baseCarne,
    baseImo,
    currentCarne,
    currentImo,
    temporaryCarne,
    temporaryImo,
    effectiveCarne,
    effectiveImo,
    combatStatus,
    health: currentCarne,
    imo: currentImo,
    maxImo: baseImo,
    hasGeneratedImoThisTurn: matchParticipant.has_generated_imo_this_turn,
    hasExiledImoThisTurn: matchParticipant.has_exiled_imo_this_turn,
    standardActionUsed: matchParticipant.standard_action_used,
    complementaryActionUsed: matchParticipant.complementary_action_used,
    openingHandReady: matchParticipant.opening_hand_ready,
    openingHandPending: !matchParticipant.opening_hand_ready,
    isDefeated: combatStatus === COMBAT_STATUS.REMOVED,
    isControlledByViewer: canRevealPrivateState,
    isCurrentTurn: activeMatch.current_turn_participant_id === matchParticipant.id,
    zones: {
      handCount: (matchParticipant.hand_cards_json || []).length,
      exileCount: (matchParticipant.exiled_imo_card_ids_json || []).length,
    },
    handCards,
    exiledImoCardIds: canRevealPrivateState ? matchParticipant.exiled_imo_card_ids_json || [] : [],
    availableImoCatalog,
    availableAllyImoSources,
    division: resolvedCharacter.division || null,
    fragments: resolvedCharacter.character?.fragments || {},
    divisionActions,
    passiveState,
    passiveActions,
    turnActions: {
      openingHandPending: !matchParticipant.opening_hand_ready,
      canGenerateImo:
        canTakeTurnAction &&
        !matchParticipant.complementary_action_used &&
        !matchParticipant.has_generated_imo_this_turn &&
        (matchParticipant.hand_cards_json || []).length < MAX_HAND_SIZE,
      canUseLoucura:
        canTakeTurnAction &&
        !matchParticipant.complementary_action_used &&
        Boolean(matchParticipant.has_exiled_imo_this_turn),
      standardAvailable: canTakeTurnAction && !matchParticipant.standard_action_used,
      complementaryAvailable: canTakeTurnAction && !matchParticipant.complementary_action_used,
      canAttack: canTakeTurnAction && !matchParticipant.standard_action_used,
      canEndTurn: canTakeTurnAction,
    },
  };
}

async function requireActiveTurnContext({ roomId, userId, actingParticipantId, includeAllParticipants = false }) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants,
  });

  if (context.match.status !== 'active') {
    throw new AppError('A partida ainda está na etapa de abertura.', 409);
  }

  if (!context.currentParticipant.opening_hand_ready) {
    throw new AppError('Essa criatura ainda não concluiu a mão inicial.', 409);
  }

  if (context.match.current_turn_participant_id !== context.currentParticipant.id) {
    throw new AppError('Não é o turno dessa criatura.', 409);
  }

  const combatState = normalizeCombatState(context.match.combat_state_json);
  assertParticipantCanAct({
    participant: context.currentParticipant,
    participantCombatState: getParticipantCombatState(combatState, context.currentParticipant.id),
  });

  return context;
}

async function requireActiveMatchContext({ roomId, userId, actingParticipantId, includeAllParticipants = false }) {
  const match = await findActiveMatchByRoomId(roomId);
  if (!match) {
    const room = await findRoomById(roomId);
    if (!room) {
      throw new AppError('Sala não encontrada.', 404);
    }

    throw new AppError('Não existe partida ativa para esta sala.', 409);
  }

  let currentParticipant = null;
  if (Number.isInteger(Number(actingParticipantId)) && Number(actingParticipantId) > 0) {
    currentParticipant = await findMatchParticipantById({
      matchId: match.id,
      participantId: Number(actingParticipantId),
    });
  } else {
    const controlledParticipants = await listMatchParticipantsByController({
      matchId: match.id,
      controllerUserId: userId,
    });
    currentParticipant = controlledParticipants.length === 1 ? controlledParticipants[0] : null;
  }

  if (!currentParticipant) {
    const belongsToRoom = await isPlayerInRoom({ roomId, userId });
    if (!belongsToRoom) {
      throw new AppError('Você não pertence a esta sala.', 403);
    }

    throw new AppError('Participante não encontrado na partida.', 404);
  }

  if (currentParticipant.controller_user_id !== userId) {
    throw new AppError('Você não controla essa criatura.', 403);
  }

  return {
    match,
    currentParticipant,
    participants: includeAllParticipants ? await listMatchParticipants(match.id) : [currentParticipant],
  };
}

function buildMatchState(activeMatch) {
  return {
    id: activeMatch.id,
    status: activeMatch.status,
    round: activeMatch.round,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    winnerParticipantId: activeMatch.winner_participant_id,
    combatState: null,
    startedAt: activeMatch.started_at,
    endedAt: activeMatch.ended_at,
  };
}

function mapLogRecord(item) {
  return {
    id: item.id,
    type: item.type,
    message: item.message,
    payload: item.payload_json,
    timestamp: item.created_at,
  };
}

async function buildNormalizedRoomPlayers({ room, players, masterUserId = null }) {
  const allSelectedCharacterIds = players.flatMap((player) => normalizeSelectedCharacterIds(player));
  const selectedCharacters = await listCharactersByIds(allSelectedCharacterIds);
  const characterMap = new Map(selectedCharacters.map((character) => [character.id, character]));
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0 ? Number(masterUserId) : null;

  return players.map((player) => {
    const selectedCharacterIds = normalizeSelectedCharacterIds(player);
    return {
      ...player,
      role: player.user_id === resolvedMasterUserId ? 'master' : 'player',
      is_master: player.user_id === resolvedMasterUserId,
      selected_character_id: selectedCharacterIds[0] || null,
      selected_character_ids: selectedCharacterIds,
      selected_characters: selectedCharacterIds
        .map((characterId) => characterMap.get(characterId))
        .filter(Boolean)
        .map((character) => ({
          id: character.id,
          name: character.name,
          owner_id: character.owner_id,
          base_carne: character.base_carne,
          base_imo: character.base_imo,
          fragments: character.fragments || null,
          division: character.division || null,
        })),
    };
  });
}

function buildCharacterMapFromPlayers(players) {
  const map = new Map();
  for (const player of players) {
    for (const character of player.selected_characters || []) {
      map.set(character.id, character);
    }
  }
  return map;
}

function createMutableParticipantMap(participants) {
  return new Map(
    participants.map((participant) => [
      participant.id,
      {
        ...participant,
        hand_cards_json: [...(participant.hand_cards_json || [])],
        exiled_imo_card_ids_json: [...(participant.exiled_imo_card_ids_json || [])],
        generated_ally_imo_card_keys_json: [...(participant.generated_ally_imo_card_keys_json || [])],
        has_exiled_imo_this_turn: Boolean(participant.has_exiled_imo_this_turn),
        current_carne: Number(participant.current_carne ?? participant.health ?? 0),
        current_imo: Number(participant.current_imo ?? participant.imo ?? 0),
      },
    ])
  );
}

async function persistParticipantStates({ participantsById, originalParticipants }) {
  const updatedEntries = [];

  for (const originalParticipant of originalParticipants) {
    const participantState = participantsById.get(originalParticipant.id);
    if (!participantState) {
      continue;
    }

    const updatedParticipant = await updateMatchParticipant({
      participantId: participantState.id,
      turnOrder: participantState.turn_order,
      health: participantState.current_carne,
      imo: participantState.current_imo,
      maxImo: participantState.max_imo,
      currentCarne: participantState.current_carne,
      currentImo: participantState.current_imo,
      hasGeneratedImoThisTurn: participantState.has_generated_imo_this_turn,
      hasExiledImoThisTurn: participantState.has_exiled_imo_this_turn,
      standardActionUsed: participantState.standard_action_used,
      complementaryActionUsed: participantState.complementary_action_used,
      openingHandReady: participantState.opening_hand_ready,
      isDefeated: participantState.is_defeated,
      handCards: participantState.hand_cards_json,
      exiledImoCardIds: participantState.exiled_imo_card_ids_json,
      generatedAllyImoCardKeys: participantState.generated_ally_imo_card_keys_json,
    });
    updatedEntries.push([
      participantState.id,
      {
        ...updatedParticipant,
        controller_username: originalParticipant.controller_username,
      },
    ]);
  }

  return new Map(updatedEntries);
}

async function buildActionRealtimeState({
  activeMatch,
  participants,
  currentUserId,
  log = null,
  notice = '',
  effectResults = [],
  privateEffectsByUserId = {},
}) {
  const characterCache = new Map();
  const participantStates = await buildParticipantStates({
    activeMatch,
    participants,
    requesterUserId: currentUserId,
    characterCache,
  });
  const openingParticipant = participantStates.find(
    (participant) => participant.isControlledByViewer && participant.openingHandPending
  );
  const viewer = buildViewerMetadata({
    requesterUserId: currentUserId,
    participantStates,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    openingParticipantId: openingParticipant?.participantId || null,
  });

  return {
    snapshot: {
      match: buildMatchState(activeMatch),
      currentTurnParticipantId: activeMatch.current_turn_participant_id,
      round: activeMatch.round,
      viewer,
      participantStates,
    },
    notice,
    effectResults,
    privateEffectsByUserId,
    log: log ? mapLogRecord(log) : null,
  };
}

async function getCharacterStateForParticipant({ matchParticipant, characterCache }) {
  if (characterCache.has(matchParticipant.id)) {
    return characterCache.get(matchParticipant.id);
  }

  const resolved = await getResolvedCharacterForUser({
    characterId: matchParticipant.source_character_id,
    ownerId: matchParticipant.controller_user_id,
  });
  characterCache.set(matchParticipant.id, resolved);
  return resolved;
}

async function buildAvailableAllyImoSources({ actingParticipant, allParticipants, characterCache, combatState }) {
  const generatedAllyKeys = new Set(actingParticipant.generated_ally_imo_card_keys_json || []);
  const allies = (allParticipants || []).filter(
    (participant) =>
      participant.id !== actingParticipant.id &&
      getCombatStatus(participant, getParticipantCombatState(combatState, participant.id)) === COMBAT_STATUS.ACTIVE &&
      isAlliedParticipant(actingParticipant, participant)
  );
  const sources = [];

  for (const allyParticipant of allies) {
    const allyCharacter = await getCharacterStateForParticipant({
      matchParticipant: allyParticipant,
      characterCache,
    });
    const availableCards = (allyCharacter.imoCards || []).filter((card) => {
      if ((allyParticipant.exiled_imo_card_ids_json || []).includes(card.id)) {
        return false;
      }

      return !generatedAllyKeys.has(buildGeneratedAllyImoCardKey({
        catalogOwnerId: allyParticipant.controller_user_id,
        cardId: card.id,
      }));
    });

    if (!availableCards.length) {
      continue;
    }

    sources.push({
      participantId: allyParticipant.id,
      displayName: allyParticipant.display_name,
      cards: availableCards,
    });
  }

  return sources;
}

async function generateFreeImoFromExile({ participantsById, actingParticipant, sourceParticipantId, cardId }) {
  if ((actingParticipant.hand_cards_json || []).length >= MAX_HAND_SIZE) {
    throw new AppError('A mÃ£o jÃ¡ estÃ¡ no limite de 3 cartas.', 409);
  }

  const normalizedSourceParticipantId = Number(sourceParticipantId);
  const sourceParticipant =
    Number.isInteger(normalizedSourceParticipantId) && normalizedSourceParticipantId > 0
      ? participantsById.get(normalizedSourceParticipantId) || null
      : actingParticipant;
  if (!sourceParticipant) {
    throw new AppError('O aliado escolhido para gerar Imo nÃ£o estÃ¡ disponÃ­vel.', 404);
  }

  const isOwnGeneration = sourceParticipant.id === actingParticipant.id;
  if (!isOwnGeneration && !isAlliedParticipant(actingParticipant, sourceParticipant)) {
    throw new AppError('A geraÃ§Ã£o gratuita por exÃ­lio sÃ³ pode usar cartas prÃ³prias ou de aliados.', 403);
  }

  const { imoCards } = await getResolvedCharacterForUser({
    characterId: sourceParticipant.source_character_id,
    ownerId: sourceParticipant.controller_user_id,
  });
  const catalogCard = imoCards.find((item) => item.id === cardId);
  if (!catalogCard) {
    throw new AppError('A carta escolhida nÃ£o pertence ao conjunto de Imo disponÃ­vel.', 404);
  }

  if ((sourceParticipant.exiled_imo_card_ids_json || []).includes(cardId)) {
    throw new AppError('Essa carta estÃ¡ exilada para o personagem escolhido.', 409);
  }

  if (isOwnGeneration) {
    if ((actingParticipant.exiled_imo_card_ids_json || []).includes(cardId)) {
      throw new AppError('Essa carta estÃ¡ exilada para essa criatura.', 409);
    }

    return {
      notice: `${actingParticipant.display_name} gerou ${catalogCard.name} sem custo ao exilar uma carta.`,
      cardEntry: {
        cardId,
        ownerParticipantId: actingParticipant.id,
        catalogOwnerId: actingParticipant.controller_user_id,
      },
      generatedAllyCardKey: '',
    };
  }

  const generatedAllyCardKey = buildGeneratedAllyImoCardKey({
    catalogOwnerId: sourceParticipant.controller_user_id,
    cardId,
  });
  if ((actingParticipant.generated_ally_imo_card_keys_json || []).includes(generatedAllyCardKey)) {
    throw new AppError('Essa carta de aliado jÃ¡ foi gerada por essa criatura e nÃ£o pode ser recebida novamente.', 409);
  }

  return {
    notice: `${actingParticipant.display_name} gerou ${catalogCard.name} de ${sourceParticipant.display_name} sem custo ao exilar uma carta.`,
    cardEntry: {
      cardId,
      ownerParticipantId: actingParticipant.id,
      catalogOwnerId: sourceParticipant.controller_user_id,
      borrowedFromParticipantId: sourceParticipant.id,
      borrowedFromDisplayName: sourceParticipant.display_name,
      generatedAllyCardKey,
    },
    generatedAllyCardKey,
  };
}

function isAlliedParticipant(leftParticipant, rightParticipant) {
  const leftType = String(leftParticipant?.participant_type || '');
  const rightType = String(rightParticipant?.participant_type || '');

  if (!leftType || !rightType) {
    return false;
  }

  if (leftType === 'player') {
    return rightType === 'player';
  }

  return rightType === 'master-creature';
}

function buildGeneratedAllyImoCardKey({ catalogOwnerId, cardId }) {
  return `${Number(catalogOwnerId)}::${String(cardId || '').trim()}`;
}

function createMatchCardEntry({
  cardId,
  ownerParticipantId,
  catalogOwnerId,
  borrowedFromParticipantId = null,
  borrowedFromDisplayName = '',
  generatedAllyCardKey = '',
}) {
  const entry = {
    cardId,
    instanceId: `${cardId}::${Math.random().toString(36).slice(2, 10)}`,
    ownerId: ownerParticipantId,
    catalogOwnerId,
  };

  if (Number.isInteger(Number(borrowedFromParticipantId)) && Number(borrowedFromParticipantId) > 0) {
    entry.borrowedFromParticipantId = Number(borrowedFromParticipantId);
  }
  if (borrowedFromDisplayName) {
    entry.borrowedFromDisplayName = borrowedFromDisplayName;
  }
  if (generatedAllyCardKey) {
    entry.generatedAllyCardKey = generatedAllyCardKey;
  }

  return entry;
}

async function resolveMatchCardEntry({ cardEntry, fallbackOwnerUserId }) {
  if (!cardEntry?.cardId) {
    return null;
  }

  const ownerId = Number(cardEntry.catalogOwnerId) || fallbackOwnerUserId;
  return resolveCardById({
    ownerId,
    cardId: cardEntry.cardId,
  });
}

async function hydrateCards({ fallbackOwnerUserId, cardEntries }) {
  const hydrated = [];

  for (const entry of cardEntries || []) {
    const baseCard = await resolveCardById({
      ownerId: Number(entry.catalogOwnerId) || fallbackOwnerUserId,
      cardId: entry.cardId,
    });
    if (!baseCard) {
      continue;
    }

    hydrated.push({
      ...baseCard,
      instanceId: entry.instanceId,
      ownerId: Number(entry?.ownerId) || null,
      catalogOwnerId: Number(entry.catalogOwnerId) || fallbackOwnerUserId,
      borrowedFromParticipantId: Number(entry?.borrowedFromParticipantId) || null,
      borrowedFromDisplayName: entry?.borrowedFromDisplayName || '',
      generatedAllyCardKey: entry?.generatedAllyCardKey || '',
      isBorrowedAllyCard: Boolean(entry?.generatedAllyCardKey),
    });
  }

  return hydrated;
}

function buildHiddenHandCards(handEntries) {
  return (handEntries || []).map((entry, index) => ({
    instanceId: entry.instanceId,
    cardId: null,
    name: `Carta oculta ${index + 1}`,
    category: 'hidden',
    effect: 'Carta oculta na mão do alvo.',
    imagePath: '',
    isHidden: true,
  }));
}

async function applyAutomation({
  ownerUserId,
  automation,
  actingParticipant,
  participantsById,
  targetParticipantId,
  selectedExiledCardId,
  selectedOwnHandCardId,
  selectedTargetHandCardId,
}) {
  const outcome = createAutomationOutcome();
  if (!automation?.effects?.length) {
    return outcome;
  }

  const selectedTargetState = resolveAutomationTarget({
    automation,
    actingParticipant,
    participantsById,
    targetParticipantId,
  });

  for (const effect of automation.effects) {
    if (effect.type === 'gainCatalogCardToHand') {
      if ((actingParticipant.hand_cards_json || []).length >= MAX_HAND_SIZE) {
        outcome.notices.push('A mão estava cheia e a geração extra de Imo foi ignorada.');
        continue;
      }

      const generatedCard = await resolveCardById({
        ownerId: ownerUserId,
        cardId: effect.cardId,
      });
      if (!generatedCard || generatedCard.category !== 'imo') {
        outcome.notices.push('Uma geração automática de Imo foi ignorada por estar inválida.');
        continue;
      }

      actingParticipant.hand_cards_json = [
        ...actingParticipant.hand_cards_json,
        createMatchCardEntry({
          cardId: effect.cardId,
          ownerParticipantId: actingParticipant.id,
          catalogOwnerId: ownerUserId,
        }),
      ];
      outcome.notices.push(`Efeito resolvido: ${generatedCard.name} foi adicionada à mão.`);
      continue;
    }

    if (effect.type === 'restoreSelectedExiledCardId') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!selectedExiledCardId) {
        throw new AppError('Escolha uma carta do exílio para remover.', 400);
      }

      const normalizedExileId = String(selectedExiledCardId).trim();
      if (!(targetState.exiled_imo_card_ids_json || []).includes(normalizedExileId)) {
        throw new AppError('A carta escolhida não está no exílio desse participante.', 404);
      }

      targetState.exiled_imo_card_ids_json = (targetState.exiled_imo_card_ids_json || []).filter(
        (item) => item !== normalizedExileId
      );
      outcome.notices.push('Efeito resolvido: uma carta foi liberada do exílio.');
      continue;
    }

    if (effect.type === 'moveSelectedOwnHandCardToTargetHand') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!selectedOwnHandCardId) {
        throw new AppError('Escolha uma carta da própria mão para transferir.', 400);
      }

      const ownHandIndex = actingParticipant.hand_cards_json.findIndex(
        (entry) => entry.instanceId === selectedOwnHandCardId
      );
      if (ownHandIndex < 0) {
        throw new AppError('A carta escolhida não está disponível na sua mão.', 404);
      }

      if ((targetState.hand_cards_json || []).length >= MAX_HAND_SIZE) {
        throw new AppError('A mão do alvo já está cheia.', 409);
      }

      const [passedCard] = actingParticipant.hand_cards_json.splice(ownHandIndex, 1);
      targetState.hand_cards_json = [
        ...(targetState.hand_cards_json || []),
        {
          ...passedCard,
          ownerId: targetState.id,
        },
      ];
      outcome.notices.push(`Efeito resolvido: uma carta foi passada para ${targetState.display_name}.`);
      continue;
    }

    if (effect.type === 'revealRandomHandCard') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!(targetState.hand_cards_json || []).length) {
        outcome.notices.push(`A mão de ${targetState.display_name} estava vazia.`);
        continue;
      }

      const randomIndex = Math.floor(Math.random() * targetState.hand_cards_json.length);
      const revealedEntry = targetState.hand_cards_json[randomIndex];
      const revealedCard = await resolveMatchCardEntry({
        cardEntry: revealedEntry,
        fallbackOwnerUserId: targetState.controller_user_id,
      });
      if (!revealedCard) {
        continue;
      }

      outcome.notices.push(`Você visualizou uma carta aleatória da mão de ${targetState.display_name}.`);
      outcome.effects.push({
        type: 'viewRandomHandCard',
        actorParticipantId: actingParticipant.id,
        targetParticipantId: targetState.id,
        targetDisplayName: targetState.display_name,
        card: {
          ...revealedCard,
          instanceId: revealedEntry.instanceId,
        },
      });
      continue;
    }

    if (effect.type === 'destroySelectedHandCard') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!selectedTargetHandCardId) {
        throw new AppError('Escolha uma carta da mão do alvo para destruir.', 400);
      }

      const targetHandIndex = targetState.hand_cards_json.findIndex(
        (entry) => entry.instanceId === selectedTargetHandCardId
      );
      if (targetHandIndex < 0) {
        throw new AppError('A carta escolhida não está disponível na mão do alvo.', 404);
      }

      targetState.hand_cards_json.splice(targetHandIndex, 1);
      outcome.notices.push(`Efeito resolvido: uma carta foi destruída da mão de ${targetState.display_name}.`);
      continue;
    }

    if (effect.type === 'cancelComplementaryAction') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (targetState.complementary_action_used) {
        outcome.notices.push(
          `A ação complementar de ${targetState.display_name} já estava indisponível neste turno.`
        );
        continue;
      }

      targetState.complementary_action_used = true;
      outcome.notices.push(`Efeito resolvido: a ação complementar de ${targetState.display_name} foi anulada.`);
    }
  }

  return outcome;
}

function resolveAutomationTarget({ automation, actingParticipant, participantsById, targetParticipantId }) {
  if (!automation?.targetScope) {
    return null;
  }

  const normalizedTargetParticipantId = Number(targetParticipantId);
  if (!Number.isInteger(normalizedTargetParticipantId)) {
    throw new AppError('Essa ação exige um alvo válido.', 400);
  }

  const targetState = participantsById.get(normalizedTargetParticipantId);
  if (!targetState) {
    throw new AppError('O alvo selecionado não está disponível na partida.', 404);
  }

  if (automation.targetScope === 'other-player' && targetState.id === actingParticipant.id) {
    throw new AppError('Essa ação exige outro participante como alvo.', 400);
  }

  if (automation.targetScope === 'selected-enemy' && isAlliedParticipant(actingParticipant, targetState)) {
    throw new AppError('Essa ação exige um inimigo como alvo.', 400);
  }

  if (automation.targetScope === 'selected-ally' && !isAlliedParticipant(actingParticipant, targetState)) {
    throw new AppError('Essa ação exige um aliado como alvo.', 400);
  }

  if (automation.targetScope === 'selected-ally' && targetState.id === actingParticipant.id) {
    throw new AppError('Essa ação exige outro participante aliado como alvo.', 400);
  }

  return targetState;
}

function resolveEffectTargetState({ effect, actingParticipant, selectedTargetState }) {
  if (effect.target === 'self' || !effect.target) {
    return actingParticipant;
  }

  if (!selectedTargetState) {
    throw new AppError('O efeito exige um alvo selecionado.', 400);
  }

  return selectedTargetState;
}

function createEmptyCombatState() {
  return {
    participants: {},
  };
}

function normalizeCombatState(rawCombatState) {
  const source = rawCombatState && typeof rawCombatState === 'object' ? rawCombatState : {};
  const participants = source.participants && typeof source.participants === 'object' ? source.participants : {};

  return {
    participants: Object.fromEntries(
      Object.entries(participants).map(([participantId, state]) => [
        participantId,
        {
          temporaryCarne: Number(state?.temporaryCarne || 0),
          temporaryImo: Number(state?.temporaryImo || 0),
          combatStatus: normalizeCombatStatus(state?.combatStatus),
          flageladoTriggered: Boolean(state?.flageladoTriggered),
          executorCooldownTurns: Number(state?.executorCooldownTurns || 0),
          temporaryDivisionActions: Array.isArray(state?.temporaryDivisionActions)
            ? state.temporaryDivisionActions.map((entry) => ({
                instanceId: String(entry?.instanceId || '').trim(),
                actionId: String(entry?.actionId || '').trim(),
              })).filter((entry) => entry.instanceId && entry.actionId)
            : [],
        },
      ])
    ),
  };
}

function getParticipantCombatState(combatState, participantId) {
  const key = String(Number(participantId));
  if (!combatState.participants[key]) {
    combatState.participants[key] = {
      temporaryCarne: 0,
      temporaryImo: 0,
      combatStatus: COMBAT_STATUS.ACTIVE,
      flageladoTriggered: false,
      executorCooldownTurns: 0,
      temporaryDivisionActions: [],
    };
  }

  return combatState.participants[key];
}

async function resolveParticipantDivisionActions({ actingParticipant, combatState, resolvedCharacter = null }) {
  const resolved =
    resolvedCharacter ||
    (await getResolvedCharacterForUser({
      characterId: actingParticipant.source_character_id,
      ownerId: actingParticipant.controller_user_id,
    }));
  const baseActions = (resolved.divisionCards || []).map((card) => ({
    ...card,
    instanceId: `base::${card.id}`,
    isTemporary: false,
  }));
  const participantCombatState = getParticipantCombatState(combatState, actingParticipant.id);
  const temporaryActions = (participantCombatState.temporaryDivisionActions || [])
    .map((entry) => {
      const baseCard = getDivisionActionById(entry.actionId);
      if (!baseCard) {
        return null;
      }

      return {
        ...baseCard,
        instanceId: entry.instanceId,
        isTemporary: true,
      };
    })
    .filter(Boolean);

  return [...baseActions, ...temporaryActions];
}

function addTemporaryDivisionAction({ combatState, participantId, actionId }) {
  const participantCombatState = getParticipantCombatState(combatState, participantId);
  participantCombatState.temporaryDivisionActions = [
    ...(participantCombatState.temporaryDivisionActions || []),
    {
      instanceId: `temp::${actionId}::${Math.random().toString(36).slice(2, 10)}`,
      actionId,
    },
  ];
}

function removeTemporaryDivisionAction({ combatState, participantId, divisionInstanceId }) {
  const participantCombatState = getParticipantCombatState(combatState, participantId);
  participantCombatState.temporaryDivisionActions = (participantCombatState.temporaryDivisionActions || []).filter(
    (entry) => entry.instanceId !== divisionInstanceId
  );
}

function buildParticipantPassiveState({ matchParticipant, participantCombatState, division }) {
  return {
    temporaryCarne: participantCombatState.temporaryCarne || 0,
    temporaryImo: participantCombatState.temporaryImo || 0,
    combatStatus: getCombatStatus(matchParticipant, participantCombatState),
    generateImoLimit: division?.id === 'rato-de-ruina' ? 2 : 1,
    executorCooldownTurns: participantCombatState.executorCooldownTurns || 0,
    executorExtraAttackReady:
      division?.id === 'executor-desgastado' && Number(participantCombatState.executorCooldownTurns || 0) <= 0,
    temporaryDivisionActionsCount: (participantCombatState.temporaryDivisionActions || []).length,
    hasFlageladoTriggeredThisTurn: Boolean(participantCombatState.flageladoTriggered),
    hasGeneratedImoThisTurn: Boolean(matchParticipant.has_generated_imo_this_turn),
  };
}

function normalizeCombatStatus(rawStatus) {
  return Object.values(COMBAT_STATUS).includes(rawStatus) ? rawStatus : COMBAT_STATUS.ACTIVE;
}

function getCombatStatus(participant, participantCombatState) {
  if (participant?.is_defeated) {
    return COMBAT_STATUS.REMOVED;
  }

  const storedStatus = normalizeCombatStatus(participantCombatState?.combatStatus);
  if (storedStatus === COMBAT_STATUS.REMOVED) {
    return COMBAT_STATUS.REMOVED;
  }

  const hasKnownCarne = participant?.current_carne != null || participant?.health != null;
  const hasKnownImo = participant?.current_imo != null || participant?.imo != null;
  if (!hasKnownCarne || !hasKnownImo) {
    return storedStatus === COMBAT_STATUS.DOWN ? COMBAT_STATUS.ACTIVE : storedStatus;
  }

  if (getEffectiveCarne(participant, participantCombatState) <= 0 || getEffectiveImo(participant, participantCombatState) <= 0) {
    return COMBAT_STATUS.DOWN;
  }

  return storedStatus === COMBAT_STATUS.DOWN ? COMBAT_STATUS.ACTIVE : storedStatus;
}

function getEffectiveCarne(participant, participantCombatState) {
  return Number(participant?.current_carne ?? participant?.health ?? 0) + Number(participantCombatState?.temporaryCarne || 0);
}

function getEffectiveImo(participant, participantCombatState) {
  return Number(participant?.current_imo ?? participant?.imo ?? 0) + Number(participantCombatState?.temporaryImo || 0);
}

function updateCombatStatus({ participant, participantCombatState }) {
  if (participant.is_defeated) {
    participantCombatState.combatStatus = COMBAT_STATUS.REMOVED;
    return participantCombatState.combatStatus;
  }

  if (getEffectiveCarne(participant, participantCombatState) <= 0 || getEffectiveImo(participant, participantCombatState) <= 0) {
    participantCombatState.combatStatus = COMBAT_STATUS.DOWN;
    return participantCombatState.combatStatus;
  }

  participantCombatState.combatStatus = COMBAT_STATUS.ACTIVE;
  return participantCombatState.combatStatus;
}

function assertParticipantCanAct({ participant, participantCombatState }) {
  if (getCombatStatus(participant, participantCombatState) !== COMBAT_STATUS.ACTIVE) {
    throw new AppError('Essa criatura esta fora de combate e nao pode agir agora.', 409);
  }
}

function buildParticipantPassiveActions({ matchParticipant, participantCombatState, division, availableImoCatalog, handCards }) {
  if (!division?.passiveConfig) {
    return [];
  }

  if (division.id === 'condutor-de-ecos') {
    const costOptions = [...new Set((handCards || []).filter((card) => card.category === 'imo').map((card) => Number(card.imoCost || 0)))];
    const ownCatalogByCost = Object.fromEntries(
      costOptions.map((cost) => [
        String(cost),
        (availableImoCatalog || []).filter((card) => Number(card.imoCost || 0) === Number(cost)),
      ])
    );

    return [
      {
        id: division.passiveConfig.id,
        name: 'Compartilhar Eco',
        description: division.passive,
        actionSlot: division.passiveConfig.actionSlot,
        imoCost: division.passiveConfig.imoCost || 0,
        targetScope: division.passiveConfig.targetScope,
        selection: division.passiveConfig.selection,
        extraSelection: division.passiveConfig.extraSelection,
        ownCatalogByCost,
      },
    ];
  }

  if (division.id === 'remendador') {
    return [
      {
        id: division.passiveConfig.id,
        name: 'Montar Divisão',
        description: division.passive,
        actionSlot: division.passiveConfig.actionSlot,
        imoCost: division.passiveConfig.imoCost || 0,
        selection: division.passiveConfig.selection,
        divisionCatalogOptions: DIVISION_ACTION_CATALOG.map((card) => ({
          id: card.id,
          name: card.name,
          description: card.effect,
        })),
      },
    ];
  }

  if (division.id === 'executor-desgastado') {
    return [
      {
        id: division.passiveConfig.id,
        name: 'Ataque Extra',
        description: division.passive,
        actionSlot: division.passiveConfig.actionSlot,
        targetScope: division.passiveConfig.targetScope,
        cooldownTurns: participantCombatState.executorCooldownTurns || 0,
      },
    ];
  }

  return [];
}

function getSpendableImo(participant, participantCombatState) {
  return getEffectiveImo(participant, participantCombatState);
}

function spendImo({ participant, participantCombatState, amount }) {
  const numericAmount = Number(amount || 0);
  if (numericAmount <= 0) {
    return;
  }

  const temporaryImo = Number(participantCombatState.temporaryImo || 0);
  const consumedTemporary = Math.min(temporaryImo, numericAmount);
  participantCombatState.temporaryImo = temporaryImo - consumedTemporary;
  participant.current_imo = Math.max(0, Number(participant.current_imo ?? participant.imo ?? 0) - (numericAmount - consumedTemporary));
  participant.imo = participant.current_imo;
  updateCombatStatus({ participant, participantCombatState });
}

async function buildUpdatedMatchStateAfterAction({ match, participantsById, combatState }) {
  const participants = [...participantsById.values()];
  const resolution = resolveMatchProgressAfterDamage({
    match,
    participants,
    combatState,
  });

  return updateMatchState({
    matchId: match.id,
    status: resolution.status,
    round: resolution.round,
    currentTurnPlayerId: resolution.currentTurnPlayerId,
    currentTurnParticipantId: resolution.currentTurnParticipantId,
    winnerUserId: resolution.winnerUserId,
    winnerParticipantId: resolution.winnerParticipantId,
    combatState,
    endedAt: resolution.status === 'finished' ? new Date() : null,
  });
}

function resolveMatchProgressAfterDamage({ match, participants, combatState = createEmptyCombatState() }) {
  const normalizedCombatState = normalizeCombatState(combatState);
  const activeParticipants = participants.filter(
    (participant) =>
      getCombatStatus(participant, getParticipantCombatState(normalizedCombatState, participant.id)) ===
      COMBAT_STATUS.ACTIVE
  );
  if (!activeParticipants.length) {
    return {
      status: 'finished',
      round: match.round,
      currentTurnPlayerId: null,
      currentTurnParticipantId: null,
      winnerUserId: null,
      winnerParticipantId: null,
    };
  }

  const firstAlive = activeParticipants[0];
  const hasOpposingTeamAlive = activeParticipants.some(
    (participant) => !isAlliedParticipant(firstAlive, participant)
  );
  if (!hasOpposingTeamAlive) {
    return {
      status: 'finished',
      round: match.round,
      currentTurnPlayerId: firstAlive.controller_user_id,
      currentTurnParticipantId: firstAlive.id,
      winnerUserId: firstAlive.controller_user_id,
      winnerParticipantId: firstAlive.id,
    };
  }

  const currentTurnAlive = activeParticipants.some(
    (participant) => participant.id === match.current_turn_participant_id
  );
  if (!currentTurnAlive) {
    const nextParticipant = getNextActiveParticipant(activeParticipants, match.current_turn_participant_id);
    return {
      status: 'active',
      round: match.round,
      currentTurnPlayerId: nextParticipant?.controller_user_id || match.current_turn_player_id,
      currentTurnParticipantId: nextParticipant?.id || match.current_turn_participant_id,
      winnerUserId: null,
      winnerParticipantId: null,
    };
  }

  return {
    status: match.status,
    round: match.round,
    currentTurnPlayerId: match.current_turn_player_id,
    currentTurnParticipantId: match.current_turn_participant_id,
    winnerUserId: match.winner_user_id,
    winnerParticipantId: match.winner_participant_id,
  };
}

async function applyDamageToParticipant({ targetParticipantId, damageAmount, participantsById, combatState }) {
  const targetState = participantsById.get(Number(targetParticipantId));
  if (!targetState || targetState.is_defeated) {
    return [];
  }

  const participantCombatState = getParticipantCombatState(combatState, targetState.id);
  applyCarneDamage({
    participant: targetState,
    participantCombatState,
    amount: damageAmount,
  });

  const passiveNotices = await applyTakeDamagePassives({
    targetState,
    combatState,
  });
  const notices = [...passiveNotices];
  if (getCombatStatus(targetState, participantCombatState) === COMBAT_STATUS.DOWN) {
    notices.push(`${targetState.display_name} caiu em combate.`);
  }

  return notices;
}

function applyCarneDamage({ participant, participantCombatState, amount }) {
  const numericAmount = Number(amount || 0);
  if (numericAmount <= 0) {
    return;
  }

  const temporaryCarne = Number(participantCombatState.temporaryCarne || 0);
  const consumedTemporary = Math.min(temporaryCarne, numericAmount);
  participantCombatState.temporaryCarne = temporaryCarne - consumedTemporary;
  participant.current_carne = Math.max(0, Number(participant.current_carne ?? participant.health ?? 0) - (numericAmount - consumedTemporary));
  participant.health = participant.current_carne;
  updateCombatStatus({ participant, participantCombatState });
}

async function applyTakeDamagePassives({ targetState, combatState }) {
  const { division } = await getResolvedCharacterForUser({
    characterId: targetState.source_character_id,
    ownerId: targetState.controller_user_id,
  });
  if (division?.id !== 'flagelado-voluntario') {
    return [];
  }

  const participantCombatState = getParticipantCombatState(combatState, targetState.id);
  if (participantCombatState.flageladoTriggered) {
    return [];
  }

  participantCombatState.flageladoTriggered = true;
  participantCombatState.temporaryImo += FLAGELADO_TEMP_IMO_GAIN;
  return [`A passiva de ${targetState.display_name} gerou 1 Imo Temporário.`];
}

function resolvePassiveTargetState({ actingParticipant, participantsById, targetParticipantId, targetScope }) {
  const targetState = participantsById.get(Number(targetParticipantId));
  if (!targetState) {
    throw new AppError('Escolha um alvo válido.', 404);
  }

  if (targetScope === 'selected-enemy' && isAlliedParticipant(actingParticipant, targetState)) {
    throw new AppError('Essa ação exige um inimigo como alvo.', 400);
  }

  if (targetScope === 'selected-ally' && !isAlliedParticipant(actingParticipant, targetState)) {
    throw new AppError('Essa ação exige um aliado como alvo.', 400);
  }

  if (targetState.id === actingParticipant.id) {
    throw new AppError('Essa ação exige outro participante como alvo.', 400);
  }

  return targetState;
}

async function applyPostUseImoPassives({ actingParticipant, participantsById, combatState }) {
  const privateEffectsByUserId = {};
  const effectResults = [];

  for (const participant of participantsById.values()) {
    if (
      participant.id === actingParticipant.id ||
      getCombatStatus(participant, getParticipantCombatState(combatState, participant.id)) !== COMBAT_STATUS.ACTIVE
    ) {
      continue;
    }

    if (isAlliedParticipant(actingParticipant, participant)) {
      continue;
    }

    const { division } = await getResolvedCharacterForUser({
      characterId: participant.source_character_id,
      ownerId: participant.controller_user_id,
    });
    if (division?.id !== 'arquivista-do-vazio') {
      continue;
    }

    if (!(actingParticipant.hand_cards_json || []).length) {
      continue;
    }

    const randomIndex = Math.floor(Math.random() * actingParticipant.hand_cards_json.length);
    const revealedEntry = actingParticipant.hand_cards_json[randomIndex];
    const revealedCard = await resolveMatchCardEntry({
      cardEntry: revealedEntry,
      fallbackOwnerUserId: actingParticipant.controller_user_id,
    });
    if (!revealedCard) {
      continue;
    }

    const effect = {
      type: 'viewRandomHandCard',
      actorParticipantId: participant.id,
      targetParticipantId: actingParticipant.id,
      targetDisplayName: actingParticipant.display_name,
      card: {
        ...revealedCard,
        instanceId: revealedEntry.instanceId,
      },
      notice: `${participant.display_name} visualizou uma carta da mão de ${actingParticipant.display_name} pela passiva de Arquivista do Vazio.`,
    };
    if (!privateEffectsByUserId[participant.controller_user_id]) {
      privateEffectsByUserId[participant.controller_user_id] = [];
    }
    privateEffectsByUserId[participant.controller_user_id].push(effect);
    if (participant.controller_user_id === actingParticipant.controller_user_id) {
      effectResults.push(effect);
    }
  }

  return {
    effectResults,
    privateEffectsByUserId,
  };
}

function rollAttackOutcome(randomFn = Math.random) {
  return Number(randomFn()) >= 0.5;
}

function consumeActionSlot({ participant, actionSlot }) {
  if (actionSlot === 'complementary') {
    if (participant.complementary_action_used) {
      throw new AppError('A ação complementar dessa criatura já foi usada neste turno.', 409);
    }
    participant.complementary_action_used = true;
    return;
  }

  if (participant.standard_action_used) {
    throw new AppError('A ação padrão dessa criatura já foi usada neste turno.', 409);
  }
  participant.standard_action_used = true;
}

function assertDivisionActionCanBeUsed({ actingParticipant, divisionCard }) {
  if (divisionCard?.id === 'loucura' && !actingParticipant?.has_exiled_imo_this_turn) {
    throw new AppError('Loucura exige que essa criatura tenha exilado uma carta de Imo neste turno.', 409);
  }
}

function addUniqueCardId(currentIds, cardId) {
  const next = new Set(Array.isArray(currentIds) ? currentIds : []);
  next.add(cardId);
  return [...next];
}

function buildDivisionActionNotice({ divisionCard, automationOutcome }) {
  const notices = [...(automationOutcome?.notices || [])];

  if (divisionCard?.id === 'loucura') {
    notices.unshift('Condicao de Loucura atendida. A recuperacao total de Imo ainda segue resolucao manual.');
  }

  return notices.filter(Boolean).join(' ');
}

function createAutomationOutcome() {
  return {
    notices: [],
    effects: [],
  };
}

async function finalizeActionResponse({ roomId, userId, includeSnapshot, actionState = null }) {
  if (!includeSnapshot) {
    return actionState;
  }

  const snapshot = await getMatchSnapshot({ roomId, userId });
  if (
    !actionState?.notice &&
    !actionState?.effectResults?.length &&
    !Object.keys(actionState?.privateEffectsByUserId || {}).length
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    actionNotice: actionState.notice,
    actionEffects: actionState.effectResults || [],
    privateEffectsByUserId: actionState.privateEffectsByUserId || {},
  };
}

module.exports = {
  __testables: {
    addUniqueCardId,
    applyAutomation,
    applyDamageToParticipant,
    buildParticipantPassiveActions,
    buildParticipantPassiveState,
    buildUpdatedMatchStateAfterAction,
    createEmptyCombatState,
    assertDivisionActionCanBeUsed,
    buildGeneratedAllyImoCardKey,
    buildDivisionActionNotice,
    consumeActionSlot,
    getCombatStatus,
    getEffectiveCarne,
    getEffectiveImo,
    getParticipantCombatState,
    getSpendableImo,
    isAlliedParticipant,
    normalizeCombatState,
    applyCarneDamage,
    resolveMatchProgressAfterDamage,
    resolveParticipantDivisionActions,
    resolvePassiveTargetState,
    resolveAutomationTarget,
    rollAttackOutcome,
    spendImo,
    updateCombatStatus,
  },
  attackForPlayer,
  completeOpeningHandForPlayer,
  endTurnForPlayer,
  exileImoCardForPlayer,
  forfeitMatchByLeavingRoom,
  generateImoForPlayer,
  getMatchSnapshot,
  getRealtimeMatchStatesForUsers,
  startMatchForRoom,
  useDivisionActionForPlayer,
  usePassiveActionForPlayer,
  useImoCardForPlayer,
};
