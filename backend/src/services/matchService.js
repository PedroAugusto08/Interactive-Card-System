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
  updateMatchCombatState,
  updateMatchParticipant,
  updateMatchState,
} = require('../models/matchModel');
const { listDecksByIds } = require('../models/deckModel');
const { AppError } = require('../utils/AppError');
const { getDeckCatalog, getResolvedDeckForUser, resolveCardById } = require('./deckService');
const { resolveRoomMasterUserId } = require('./masterOverride');
const {
  buildLobbyParticipantEntries,
  buildViewerMetadata,
  getNextActiveParticipant,
  normalizeSelectedDeckIds,
  shouldRevealParticipantPrivateState,
  validateTurnOrderDraft,
} = require('./participantUtils');

const INITIAL_HEALTH = 10;
const INITIAL_IMO = 3;
const MAX_IMO = 10;
const MAX_HAND_SIZE = 3;

function isAttackCard(card) {
  return card?.combatRole === 'attack';
}

function isReactionCard(card) {
  return card?.combatRole === 'reaction';
}

function normalizeCombatState(combatState) {
  return combatState && typeof combatState === 'object' && Object.keys(combatState).length ? combatState : null;
}

async function startMatchForRoom({ roomId, userId, requesterUser = null, includeSnapshot = true }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const players = await listRoomPlayers(roomId);
  const masterUserId = resolveRoomMasterUserId({ room, requesterUser, players });
  if (masterUserId !== userId) {
    throw new AppError('Somente o mestre pode iniciar a partida.', 403);
  }

  if (room.status !== 'lobby') {
    throw new AppError('A sala nao esta em lobby para iniciar partida.', 409);
  }

  if (players.length < 2) {
    throw new AppError('A partida precisa de ao menos 2 jogadores.', 409);
  }

  const normalizedPlayers = await buildNormalizedRoomPlayers({ room, players, masterUserId });
  const masterPlayer = normalizedPlayers.find((player) => player.user_id === masterUserId);
  if (!masterPlayer?.selected_deck_ids.length) {
    throw new AppError('O mestre precisa selecionar ao menos um deck.', 409);
  }

  const playersWithoutDeck = normalizedPlayers.filter(
    (player) => !player.is_master && !player.selected_deck_id
  );
  if (playersWithoutDeck.length) {
    throw new AppError('Todos os jogadores precisam selecionar um deck.', 409);
  }

  const playersNotReady = normalizedPlayers.filter((player) => !player.is_ready);
  if (playersNotReady.length) {
    throw new AppError('Todos os jogadores precisam estar prontos.', 409);
  }

  const lobbyParticipants = buildLobbyParticipantEntries({
    room,
    players: normalizedPlayers,
    deckMap: buildDeckMapFromPlayers(normalizedPlayers),
    masterUserId,
  });
  const validation = validateTurnOrderDraft({
    lobbyEntries: lobbyParticipants,
    draftEntryIds: room.turn_order_draft_json || [],
  });
  if (!validation.ok) {
    throw new AppError(validation.reason, 409);
  }

  const activeMatch = await findActiveMatchByRoomId(roomId);
  if (activeMatch) {
    throw new AppError('Ja existe uma partida ativa para esta sala.', 409);
  }

  const match = await createMatch({
    roomId,
    currentTurnParticipantId: null,
    currentTurnPlayerId: null,
  });

  const lobbyParticipantsByEntryId = new Map(lobbyParticipants.map((entry) => [entry.entryId, entry]));
  const createdParticipants = [];

  for (let index = 0; index < room.turn_order_draft_json.length; index += 1) {
    const draftEntryId = room.turn_order_draft_json[index];
    const lobbyParticipant = lobbyParticipantsByEntryId.get(draftEntryId);
    if (!lobbyParticipant) {
      throw new AppError('A ordem de turno ficou inconsistente.', 409);
    }

    const { expandedCards } = await getResolvedDeckForUser({
      deckId: lobbyParticipant.sourceDeckId,
      ownerId: lobbyParticipant.controllerUserId,
    });

    const normalizedDeckEntries = expandedCards.map((card) =>
      createMatchCardEntry({
        card,
        ownerParticipantId: null,
        catalogOwnerId: lobbyParticipant.controllerUserId,
        instanceId: card.instanceId,
      })
    );
    const shuffledDeck = shuffleCards(normalizedDeckEntries);
    const handCards = shuffledDeck.splice(0, MAX_HAND_SIZE);

    const createdParticipant = await createMatchParticipant({
      matchId: match.id,
      controllerUserId: lobbyParticipant.controllerUserId,
      participantType: lobbyParticipant.participantType,
      sourceDeckId: lobbyParticipant.sourceDeckId,
      displayName: lobbyParticipant.displayName,
      turnOrder: index + 1,
      health: INITIAL_HEALTH,
      imo: INITIAL_IMO,
      maxImo: MAX_IMO,
      hasDrawnThisTurn: false,
      hasUsedCardActionThisTurn: false,
      isDefeated: false,
      deckCards: shuffledDeck,
      handCards,
      exileCards: [],
    });

    createdParticipant.deck_cards_json = reassignCardEntriesToParticipant(shuffledDeck, createdParticipant.id);
    createdParticipant.hand_cards_json = reassignCardEntriesToParticipant(handCards, createdParticipant.id);
    createdParticipant.exile_cards_json = [];

    const persistedParticipant = await updateMatchParticipant({
      participantId: createdParticipant.id,
      turnOrder: createdParticipant.turn_order,
      health: createdParticipant.health,
      imo: createdParticipant.imo,
      maxImo: createdParticipant.max_imo,
      hasDrawnThisTurn: createdParticipant.has_drawn_this_turn,
      hasUsedCardActionThisTurn: createdParticipant.has_used_card_action_this_turn,
      isDefeated: createdParticipant.is_defeated,
      deckCards: createdParticipant.deck_cards_json,
      handCards: createdParticipant.hand_cards_json,
      exileCards: [],
    });

    createdParticipants.push({
      ...persistedParticipant,
      display_name: lobbyParticipant.displayName,
      controller_username: lobbyParticipant.username,
    });
  }

  const firstParticipant = createdParticipants[0];
  await updateMatchState({
    matchId: match.id,
    status: 'active',
    round: 1,
    currentTurnPlayerId: firstParticipant?.controller_user_id || null,
    currentTurnParticipantId: firstParticipant?.id || null,
    winnerUserId: null,
    winnerParticipantId: null,
  });

  await updateRoomState({
    roomId: room.id,
    hostId: room.host_id,
    status: 'in_match',
    turnOrderDraft: room.turn_order_draft_json || [],
  });

  await addMatchLog({
    matchId: match.id,
    type: 'MATCH_START',
    message: 'A partida foi iniciada.',
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

async function getMatchSnapshotsForUsers({ roomId, userIds = [] }) {
  const requesterIds = [...new Set((userIds || []).map((value) => Number(value)).filter(Number.isInteger))];
  if (!requesterIds.length) {
    return new Map();
  }

  const context = await loadMatchSnapshotContext({
    roomId,
    userId: requesterIds[0],
    skipMembershipCheck: true,
  });

  const snapshots = await Promise.all(
    requesterIds.map(async (requesterUserId) => [
      requesterUserId,
      await buildMatchSnapshot({
        ...context,
        userId: requesterUserId,
      }),
    ])
  );

  return new Map(snapshots);
}

async function getRealtimeMatchStatesForUsers({ roomId, userIds = [] }) {
  const startedAt = performance.now();
  const requesterIds = [...new Set((userIds || []).map((value) => Number(value)).filter(Number.isInteger))];
  if (!requesterIds.length) {
    return {
      latestLog: null,
      snapshotsByUserId: new Map(),
      metrics: { totalMs: 0 },
    };
  }

  const findMatchStartedAt = performance.now();
  const match = await findActiveMatchByRoomId(roomId);
  const findMatchMs = performance.now() - findMatchStartedAt;

  if (!match) {
    return {
      latestLog: null,
      snapshotsByUserId: new Map(),
      metrics: { findMatchMs, totalMs: performance.now() - startedAt },
    };
  }

  const loadMatchDataStartedAt = performance.now();
  const [participants, latestLogs] = await Promise.all([listMatchParticipants(match.id), listMatchLogs(match.id, 1)]);
  const loadMatchDataMs = performance.now() - loadMatchDataStartedAt;
  const latestLog = latestLogs[0]
    ? {
        id: latestLogs[0].id,
        type: latestLogs[0].type,
        message: latestLogs[0].message,
        payload: latestLogs[0].payload_json,
        timestamp: latestLogs[0].created_at,
      }
    : null;

  const cardCatalogCache = new Map();
  const buildSnapshotsStartedAt = performance.now();
  const snapshots = await Promise.all(
    requesterIds.map(async (requesterUserId) => [
      requesterUserId,
      await buildRealtimeMatchState({
        activeMatch: match,
        participants,
        userId: requesterUserId,
        cardCatalogCache,
      }),
    ])
  );
  const buildSnapshotsMs = performance.now() - buildSnapshotsStartedAt;

  return {
    latestLog,
    snapshotsByUserId: new Map(snapshots),
    metrics: {
      findMatchMs,
      loadMatchDataMs,
      buildSnapshotsMs,
      totalMs: performance.now() - startedAt,
    },
  };
}

async function loadMatchSnapshotContext({ roomId, userId, skipMembershipCheck = false }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (!skipMembershipCheck) {
    const belongsToRoom = await isPlayerInRoom({ roomId, userId });
    if (!belongsToRoom) {
      throw new AppError('Voce nao pertence a esta sala.', 403);
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

  const cardCatalogCache = new Map();
  const participantStates = await buildParticipantStates({
    activeMatch,
    participants,
    requesterUserId: userId,
    cardCatalogCache,
  });

  const viewer = buildViewerMetadata({
    requesterUserId: userId,
    participantStates,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    combatState: activeMatch.combat_state_json || null,
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

async function buildRealtimeMatchState({ activeMatch, participants, userId, cardCatalogCache }) {
  const participantStates = await buildParticipantStates({
    activeMatch,
    participants,
    requesterUserId: userId,
    cardCatalogCache,
  });
  const viewer = buildViewerMetadata({
    requesterUserId: userId,
    participantStates,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    combatState: activeMatch.combat_state_json || null,
  });

  return {
    match: buildMatchState(activeMatch),
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    round: activeMatch.round,
    viewer,
    participantStates,
  };
}

async function drawCardForPlayer({ roomId, userId, actingParticipantId, includeSnapshot = true }) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const participantState = context.currentParticipant;
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (combatState) {
    throw new AppError('Resolva o ataque pendente antes de comprar uma carta.', 409);
  }

  if (participantState.has_drawn_this_turn) {
    throw new AppError('Voce ja comprou uma carta neste turno.', 409);
  }

  if ((participantState.hand_cards_json || []).length >= MAX_HAND_SIZE) {
    throw new AppError('Sua mao ja esta no limite de 3 cartas.', 409);
  }

  if (!(participantState.deck_cards_json || []).length) {
    throw new AppError('Nao ha mais cartas no deck para comprar.', 409);
  }

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(participantState.id);
  const deckCards = [...actingParticipant.deck_cards_json];
  const nextCard = deckCards.shift();
  const handCards = [...actingParticipant.hand_cards_json, nextCard];

  actingParticipant.deck_cards_json = deckCards;
  actingParticipant.hand_cards_json = handCards;
  actingParticipant.has_drawn_this_turn = true;

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_DRAW',
    message: `${participantState.display_name} comprou uma carta.`,
    payload: {
      actingParticipantId: participantState.id,
      cardId: nextCard.cardId,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: context.match,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
    }),
  });
}

async function playCardForPlayer({
  roomId,
  userId,
  actingParticipantId,
  cardId,
  targetParticipantId = null,
  selectedExileCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  pairedCardId = null,
  pairedTargetParticipantId = null,
  pairedSelectedExileCardId = null,
  pairedSelectedOwnHandCardId = null,
  pairedSelectedTargetHandCardId = null,
  asCounterResponse = false,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const isCounterResponse =
    Boolean(asCounterResponse) &&
    combatState?.type === 'attack' &&
    combatState?.status === 'awaiting-counter-response' &&
    combatState?.defenderParticipantId === actingParticipantId;
  const originalParticipant = context.currentParticipant;

  if (!asCounterResponse && combatState) {
    throw new AppError('Resolva o ataque pendente antes de continuar a partida.', 409);
  }

  if (!asCounterResponse && context.match.current_turn_participant_id !== actingParticipantId) {
    throw new AppError('Nao e o turno dessa criatura.', 409);
  }

  if (asCounterResponse && !isCounterResponse) {
    throw new AppError('Nao ha uma janela de resposta disponivel para essa criatura agora.', 409);
  }

  if (!isCounterResponse && originalParticipant.has_used_card_action_this_turn) {
    throw new AppError('Essa criatura ja usou sua acao de carta neste turno.', 409);
  }

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(actingParticipantId);
  const handCards = [...actingParticipant.hand_cards_json];
  const primaryPlay = await consumeCardFromHand({
    fallbackOwnerUserId: actingParticipant.controller_user_id,
    handCards,
    instanceId: cardId,
    notFoundMessage: 'Carta nao encontrada na mao dessa criatura.',
    unresolvedMessage: 'Carta jogada nao encontrada no catalogo.',
  });

  if (isReactionCard(primaryPlay.resolvedCard)) {
    throw new AppError('A carta Reacao so pode ser usada para reagir a um ataque.', 409);
  }

  let pairedPlay = null;
  if (pairedCardId) {
    if (isCounterResponse) {
      throw new AppError('A carta de resposta nao pode ser jogada junto com outra carta.', 409);
    }

    if (!primaryPlay.resolvedCard.canPlayTogether) {
      throw new AppError(
        `A carta ${primaryPlay.resolvedCard.name} nao permite ser jogada junto com outra carta.`,
        409
      );
    }

    if (pairedCardId === cardId) {
      throw new AppError('A carta jogada junto precisa ser diferente da carta principal.', 400);
    }

    pairedPlay = await consumeCardFromHand({
      fallbackOwnerUserId: actingParticipant.controller_user_id,
      handCards,
      instanceId: pairedCardId,
      notFoundMessage: 'Carta jogada junto nao encontrada na mao.',
      unresolvedMessage: 'Carta jogada junto nao encontrada no catalogo.',
    });
  }

  const totalImoCost =
    Number(primaryPlay.resolvedCard.imoCost || 0) + Number(pairedPlay?.resolvedCard.imoCost || 0);
  if (actingParticipant.imo < totalImoCost) {
    throw new AppError('Imo insuficiente para jogar esta carta.', 409);
  }

  actingParticipant.imo -= totalImoCost;
  if (!isCounterResponse) {
    actingParticipant.has_used_card_action_this_turn = true;
  }
  actingParticipant.hand_cards_json = handCards;
  actingParticipant.deck_cards_json = [...actingParticipant.deck_cards_json, primaryPlay.cardEntry];

  const automationOutcome = createAutomationOutcome();
  mergeAutomationOutcome(
    automationOutcome,
    await applyCardAutomation({
      phase: 'play',
      ownerUserId: actingParticipant.controller_user_id,
      card: primaryPlay.resolvedCard,
      currentCard: primaryPlay.cardEntry,
      actingParticipant,
      participantsById,
      targetParticipantId,
      selectedExileCardId,
      selectedOwnHandCardId,
      selectedTargetHandCardId,
    })
  );

  if (pairedPlay) {
    actingParticipant.deck_cards_json = [...actingParticipant.deck_cards_json, pairedPlay.cardEntry];
    mergeAutomationOutcome(
      automationOutcome,
      await applyCardAutomation({
        phase: 'play',
        ownerUserId: actingParticipant.controller_user_id,
        card: pairedPlay.resolvedCard,
        currentCard: pairedPlay.cardEntry,
        actingParticipant,
        participantsById,
        targetParticipantId: pairedTargetParticipantId,
        selectedExileCardId: pairedSelectedExileCardId,
        selectedOwnHandCardId: pairedSelectedOwnHandCardId,
        selectedTargetHandCardId: pairedSelectedTargetHandCardId,
      })
    );
  }

  let nextCombatState = combatState;
  let attackTargetState = null;
  if (isAttackCard(primaryPlay.resolvedCard)) {
    const normalizedTargetParticipantId = Number(targetParticipantId);
    if (!Number.isInteger(normalizedTargetParticipantId)) {
      throw new AppError('Selecione um alvo valido para o ataque.', 400);
    }

    attackTargetState = participantsById.get(normalizedTargetParticipantId);
    if (
      !attackTargetState ||
      attackTargetState.id === actingParticipantId ||
      attackTargetState.is_defeated
    ) {
      throw new AppError('Selecione outro participante valido para receber o ataque.', 400);
    }

    nextCombatState = buildAttackCombatState({
      attackerState: actingParticipant,
      defenderState: attackTargetState,
      attackCard: primaryPlay.resolvedCard,
      attackCardEntry: primaryPlay.cardEntry,
      initiatedByCounterResponse: isCounterResponse,
    });
  } else if (isCounterResponse) {
    nextCombatState = null;
  }

  const notice = automationOutcome.notices.join(' ');
  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });

  const updatedMatchState =
    combatState !== nextCombatState || isAttackCard(primaryPlay.resolvedCard) || isCounterResponse
      ? await updateMatchCombatState({
          matchId: context.match.id,
          combatState: normalizeCombatState(nextCombatState),
        })
      : null;

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_PLAY_CARD',
    message: isAttackCard(primaryPlay.resolvedCard) && attackTargetState
      ? `${originalParticipant.display_name} atacou ${attackTargetState.display_name} com ${primaryPlay.resolvedCard.name}.`
      : isCounterResponse
        ? `${originalParticipant.display_name} jogou ${primaryPlay.resolvedCard.name} em resposta ao ataque de ${combatState.attackerDisplayName}.`
        : pairedPlay
          ? `${originalParticipant.display_name} jogou ${primaryPlay.resolvedCard.name} junto com ${pairedPlay.resolvedCard.name}.`
          : `${originalParticipant.display_name} jogou ${primaryPlay.resolvedCard.name}.`,
    payload: {
      actingParticipantId,
      cardId: primaryPlay.cardEntry.cardId,
      imoCost: totalImoCost,
      targetParticipantId: targetParticipantId || null,
      selectedOwnHandCardId: selectedOwnHandCardId || null,
      asCounterResponse: isCounterResponse,
      selectedTargetHandCardId: selectedTargetHandCardId || null,
      pairedCardId: pairedPlay?.cardEntry.cardId || null,
      pairedTargetParticipantId: pairedTargetParticipantId || null,
      pairedSelectedOwnHandCardId: pairedSelectedOwnHandCardId || null,
      pairedSelectedTargetHandCardId: pairedSelectedTargetHandCardId || null,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState || context.match,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice,
      effectResults: automationOutcome.effects,
    }),
  });
}

async function discardCardForPlayer({
  roomId,
  userId,
  actingParticipantId,
  cardId,
  targetParticipantId = null,
  selectedExileCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  asCounterResponse = false,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const isCounterResponse =
    Boolean(asCounterResponse) &&
    combatState?.type === 'attack' &&
    combatState?.status === 'awaiting-counter-response' &&
    combatState?.defenderParticipantId === actingParticipantId;
  const originalParticipant = context.currentParticipant;

  if (!asCounterResponse && combatState) {
    throw new AppError('Resolva o ataque pendente antes de continuar a partida.', 409);
  }

  if (!asCounterResponse && context.match.current_turn_participant_id !== actingParticipantId) {
    throw new AppError('Nao e o turno dessa criatura.', 409);
  }

  if (asCounterResponse && !isCounterResponse) {
    throw new AppError('Nao ha uma janela de resposta disponivel para essa criatura agora.', 409);
  }

  if (!isCounterResponse && originalParticipant.has_used_card_action_this_turn) {
    throw new AppError('Essa criatura ja usou sua acao de carta neste turno.', 409);
  }

  const participantsById = createMutableParticipantMap(context.participants);
  const actingParticipant = participantsById.get(actingParticipantId);
  const handCards = [...actingParticipant.hand_cards_json];
  const cardIndex = handCards.findIndex((entry) => entry.instanceId === cardId);
  if (cardIndex < 0) {
    throw new AppError('Carta nao encontrada na sua mao.', 404);
  }

  const [discardedCard] = handCards.splice(cardIndex, 1);
  const resolvedCard = await resolveMatchCardEntry({
    cardEntry: discardedCard,
    fallbackOwnerUserId: actingParticipant.controller_user_id,
  });
  if (!resolvedCard) {
    throw new AppError('Carta descartada nao encontrada no catalogo.', 404);
  }

  if (resolvedCard.canDiscard === false) {
    throw new AppError(`A carta ${resolvedCard.name} nao pode ser descartada.`, 409);
  }

  if (!isCounterResponse) {
    actingParticipant.has_used_card_action_this_turn = true;
  }
  actingParticipant.hand_cards_json = handCards;
  actingParticipant.exile_cards_json = [discardedCard, ...actingParticipant.exile_cards_json];

  const automationOutcome = await applyCardAutomation({
    phase: 'discard',
    ownerUserId: actingParticipant.controller_user_id,
    card: resolvedCard,
    currentCard: discardedCard,
    actingParticipant,
    participantsById,
    targetParticipantId,
    selectedExileCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
  });
  const notice = automationOutcome.notices.join(' ');

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });

  const updatedMatchState = isCounterResponse
    ? await updateMatchCombatState({
        matchId: context.match.id,
        combatState: null,
      })
    : null;

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_DISCARD_CARD',
    message: isCounterResponse
      ? `${originalParticipant.display_name} descartou ${resolvedCard.name} em resposta ao ataque de ${combatState.attackerDisplayName}.`
      : `${originalParticipant.display_name} descartou ${resolvedCard.name}.`,
    payload: {
      actingParticipantId,
      cardId: discardedCard.cardId,
      targetParticipantId: targetParticipantId || null,
      selectedOwnHandCardId: selectedOwnHandCardId || null,
      asCounterResponse: isCounterResponse,
      selectedTargetHandCardId: selectedTargetHandCardId || null,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState || context.match,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
      notice,
      effectResults: automationOutcome.effects,
    }),
  });
}

async function reactToAttackForPlayer({
  roomId,
  userId,
  actingParticipantId,
  reactionCardId,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (
    !combatState ||
    combatState.type !== 'attack' ||
    combatState.status !== 'awaiting-reaction' ||
    combatState.defenderParticipantId !== actingParticipantId
  ) {
    throw new AppError('Nao ha um ataque pendente aguardando a reacao dessa criatura.', 409);
  }

  const participantsById = createMutableParticipantMap(context.participants);
  const defendingParticipant = participantsById.get(actingParticipantId);
  const handCards = [...defendingParticipant.hand_cards_json];
  const reactionPlay = await consumeCardFromHand({
    fallbackOwnerUserId: defendingParticipant.controller_user_id,
    handCards,
    instanceId: reactionCardId,
    notFoundMessage: 'Carta de reacao nao encontrada na mao dessa criatura.',
    unresolvedMessage: 'Carta de reacao nao encontrada no catalogo.',
  });

  if (!isReactionCard(reactionPlay.resolvedCard)) {
    throw new AppError('Selecione uma carta de Reacao valida para defender esse ataque.', 400);
  }

  defendingParticipant.hand_cards_json = handCards;
  defendingParticipant.deck_cards_json = [...defendingParticipant.deck_cards_json, reactionPlay.cardEntry];

  const updatedParticipantsById = await persistParticipantStates({
    participantsById,
    originalParticipants: context.participants,
  });

  const updatedMatchState = await updateMatchCombatState({
    matchId: context.match.id,
    combatState: {
      ...combatState,
      status: 'awaiting-reaction-result',
      reactionCard: {
        cardId: reactionPlay.resolvedCard.id,
        instanceId: reactionPlay.cardEntry.instanceId,
        name: reactionPlay.resolvedCard.name,
      },
    },
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_ATTACK_REACTION',
    message: `${context.currentParticipant.display_name} usou Reacao contra o ataque de ${combatState.attackerDisplayName}.`,
    payload: {
      attackerParticipantId: combatState.attackerParticipantId,
      defenderParticipantId: combatState.defenderParticipantId,
      reactionCardId: reactionPlay.resolvedCard.id,
      reactionCardInstanceId: reactionPlay.cardEntry.instanceId,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState || context.match,
      participants: [...updatedParticipantsById.values()],
      currentUserId: userId,
      log: createdLog,
    }),
  });
}

async function resolveAttackForPlayer({
  roomId,
  userId,
  actingParticipantId,
  resolution,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (
    !combatState ||
    combatState.type !== 'attack' ||
    combatState.defenderParticipantId !== actingParticipantId
  ) {
    throw new AppError('Nao ha um ataque pendente vinculado a essa criatura.', 409);
  }

  let nextCombatState = combatState;
  let logMessage = '';
  const logType = 'MATCH_ATTACK_RESOLUTION';

  if (resolution === 'skip-reaction') {
    if (combatState.status !== 'awaiting-reaction') {
      throw new AppError('A etapa atual do ataque nao permite pular a reacao.', 409);
    }

    nextCombatState = null;
    logMessage = `${combatState.defenderDisplayName} optou por nao reagir ao ataque de ${combatState.attackerDisplayName}.`;
  } else if (resolution === 'reaction-success') {
    if (combatState.status !== 'awaiting-reaction-result') {
      throw new AppError('Nao ha um teste de reacao pendente para resolver.', 409);
    }

    nextCombatState = {
      ...combatState,
      status: 'awaiting-counter-response',
    };
    logMessage = `${combatState.defenderDisplayName} superou o ataque de ${combatState.attackerDisplayName} e pode responder com outra carta.`;
  } else if (resolution === 'reaction-fail') {
    if (combatState.status !== 'awaiting-reaction-result') {
      throw new AppError('Nao ha um teste de reacao pendente para resolver.', 409);
    }

    nextCombatState = null;
    logMessage = `${combatState.defenderDisplayName} nao superou o ataque de ${combatState.attackerDisplayName}.`;
  } else if (resolution === 'skip-counter-response') {
    if (combatState.status !== 'awaiting-counter-response') {
      throw new AppError('Nao ha uma carta de resposta pendente para pular.', 409);
    }

    nextCombatState = null;
    logMessage = `${combatState.defenderDisplayName} encerrou a janela de resposta contra ${combatState.attackerDisplayName}.`;
  } else {
    throw new AppError('Resolucao de ataque invalida.', 400);
  }

  const updatedMatchState = await updateMatchCombatState({
    matchId: context.match.id,
    combatState: normalizeCombatState(nextCombatState),
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: logType,
    message: logMessage,
    payload: {
      attackerParticipantId: combatState.attackerParticipantId,
      defenderParticipantId: combatState.defenderParticipantId,
      resolution,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState || context.match,
      participants: context.participants,
      currentUserId: userId,
      log: createdLog,
    }),
  });
}

async function revealViewedTopDeckCardForPlayer({
  roomId,
  userId,
  actingParticipantId,
  targetParticipantId,
  topDeckInstanceId,
}) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const targetState = context.participants.find((participant) => participant.id === Number(targetParticipantId));

  if (!targetState) {
    throw new AppError('O alvo selecionado nao esta disponivel na partida.', 404);
  }

  if (!topDeckInstanceId) {
    throw new AppError('A carta visualizada nao foi informada para revelacao.', 400);
  }

  const currentTopDeckCard = targetState.deck_cards_json?.[0];
  if (!currentTopDeckCard) {
    throw new AppError(`O deck de ${targetState.display_name} esta vazio.`, 409);
  }

  if (currentTopDeckCard.instanceId !== topDeckInstanceId) {
    throw new AppError('O topo do deck mudou antes da revelacao.', 409);
  }

  const resolvedCard = await resolveMatchCardEntry({
    cardEntry: currentTopDeckCard,
    fallbackOwnerUserId: targetState.controller_user_id,
  });
  if (!resolvedCard) {
    throw new AppError('A carta revelada nao foi encontrada no catalogo.', 404);
  }

  const revealEvent = {
    type: 'topDeckRevealed',
    actorParticipantId: context.currentParticipant.id,
    actorDisplayName: context.currentParticipant.display_name,
    targetParticipantId: targetState.id,
    targetDisplayName: targetState.display_name,
    card: {
      ...resolvedCard,
      instanceId: currentTopDeckCard.instanceId,
    },
  };

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_REVEAL_TOP_DECK',
    message: `${context.currentParticipant.display_name} revelou o topo do deck de ${targetState.display_name}: ${resolvedCard.name}.`,
    payload: {
      actorParticipantId: context.currentParticipant.id,
      targetParticipantId: targetState.id,
      cardId: resolvedCard.id,
      topDeckInstanceId: currentTopDeckCard.instanceId,
    },
  });

  return {
    revealEvent,
    log: createdLog ? mapLogRecord(createdLog) : null,
  };
}

async function endTurnForPlayer({ roomId, userId, actingParticipantId, includeSnapshot = true }) {
  const context = await requireActiveTurnContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants: true,
  });
  const currentParticipant = context.currentParticipant;
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (combatState) {
    throw new AppError('Resolva o ataque pendente antes de encerrar o turno.', 409);
  }

  const activeParticipants = context.participants.filter((participant) => !participant.is_defeated);
  const nextParticipant = getNextActiveParticipant(activeParticipants, currentParticipant.id);
  const nextRound =
    nextParticipant && nextParticipant.id === activeParticipants[0]?.id
      ? context.match.round + 1
      : context.match.round;

  const participantsById = createMutableParticipantMap(context.participants);
  const mutableNextParticipant = participantsById.get(nextParticipant.id);
  mutableNextParticipant.imo = Math.min(mutableNextParticipant.max_imo, mutableNextParticipant.imo + 1);
  mutableNextParticipant.has_drawn_this_turn = false;
  mutableNextParticipant.has_used_card_action_this_turn = false;

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
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_END_TURN',
    message: `${currentParticipant.display_name} encerrou o turno.`,
    payload: { actingParticipantId },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState || { ...context.match, round: nextRound, current_turn_participant_id: nextParticipant.id },
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
  for (const participant of controlledParticipants) {
    const mutableParticipant = participantsById.get(participant.id);
    mutableParticipant.is_defeated = true;
  }

  await persistParticipantStates({
    participantsById,
    originalParticipants: participants,
  });

  const remainingParticipants = [...participantsById.values()].filter((participant) => !participant.is_defeated);
  if (closeRoom) {
    const room = await findRoomById(roomId);
    const winnerParticipant = remainingParticipants.length === 1 ? remainingParticipants[0] : null;

    await updateMatchState({
      matchId: match.id,
      status: 'finished',
      round: match.round,
      currentTurnPlayerId: null,
      currentTurnParticipantId: null,
      winnerUserId: winnerParticipant?.controller_user_id || null,
      winnerParticipantId: winnerParticipant?.id || null,
      endedAt: new Date().toISOString(),
    });

    await updateRoomState({
      roomId,
      hostId: room?.host_id || null,
      status: 'finished',
      turnOrderDraft: [],
    });

    await addMatchLog({
      matchId: match.id,
      type: 'MATCH_FINISH',
      message: winnerParticipant
        ? `${winnerParticipant.display_name} venceu porque o mestre encerrou a sala.`
        : 'A partida foi encerrada porque o mestre saiu da sala.',
      payload: {
        leavingUserId: userId,
        winnerParticipantId: winnerParticipant?.id || null,
        closedByMasterLeaving: true,
      },
    });
    return match.id;
  }

  if (remainingParticipants.length === 1) {
    await updateMatchState({
      matchId: match.id,
      status: 'finished',
      round: match.round,
      currentTurnPlayerId: null,
      currentTurnParticipantId: null,
      winnerUserId: remainingParticipants[0].controller_user_id,
      winnerParticipantId: remainingParticipants[0].id,
      endedAt: new Date().toISOString(),
    });

    const room = await findRoomById(roomId);
    await updateRoomState({
      roomId,
      hostId: room?.host_id || null,
      status: 'finished',
      turnOrderDraft: room?.turn_order_draft_json || [],
    });

    await addMatchLog({
      matchId: match.id,
      type: 'MATCH_FINISH',
      message: `${remainingParticipants[0].display_name} venceu por abandono.`,
      payload: {
        winnerParticipantId: remainingParticipants[0].id,
        leavingUserId: userId,
      },
    });
    return match.id;
  }

  const leavingParticipantIds = new Set(controlledParticipants.map((participant) => participant.id));
  const nextCurrentTurnParticipant = leavingParticipantIds.has(match.current_turn_participant_id)
    ? getNextActiveParticipant(remainingParticipants, match.current_turn_participant_id)
    : participantsById.get(match.current_turn_participant_id) || remainingParticipants[0];

  const nextCombatState = leavingParticipantIds.has(match.combat_state_json?.attackerParticipantId) ||
    leavingParticipantIds.has(match.combat_state_json?.defenderParticipantId)
    ? null
    : match.combat_state_json;

  await updateMatchState({
    matchId: match.id,
    status: 'active',
    round: match.round,
    currentTurnPlayerId: nextCurrentTurnParticipant?.controller_user_id || null,
    currentTurnParticipantId: nextCurrentTurnParticipant?.id || null,
    winnerUserId: null,
    winnerParticipantId: null,
  });
  await updateMatchCombatState({
    matchId: match.id,
    combatState: normalizeCombatState(nextCombatState),
  });

  await addMatchLog({
    matchId: match.id,
    type: 'MATCH_FORFEIT',
    message: 'Um jogador deixou a partida e suas criaturas foram derrotadas.',
    payload: {
      leavingUserId: userId,
      leavingParticipantIds: [...leavingParticipantIds],
    },
  });

  return match.id;
}

async function buildActionRealtimeState({
  activeMatch,
  participants,
  currentUserId,
  log,
  notice = '',
  effectResults = [],
}) {
  const cardCatalogCache = new Map();
  const participantStates = await buildParticipantStates({
    activeMatch,
    participants,
    requesterUserId: currentUserId,
    cardCatalogCache,
  });
  const viewer = buildViewerMetadata({
    requesterUserId: currentUserId,
    participantStates,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    combatState: activeMatch.combat_state_json || null,
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
    log: log ? mapLogRecord(log) : null,
  };
}

async function buildParticipantStates({ activeMatch, participants, requesterUserId, cardCatalogCache }) {
  return Promise.all(
    participants.map((participant) =>
      buildParticipantState({
        activeMatch,
        matchParticipant: participant,
        requesterUserId,
        cardCatalogCache,
      })
    )
  );
}

async function buildParticipantState({ activeMatch, matchParticipant, requesterUserId, cardCatalogCache }) {
  const canRevealPrivateState = shouldRevealParticipantPrivateState({
    requesterUserId,
    participant: {
      controllerUserId: matchParticipant.controller_user_id,
    },
  });

  let handCards = [];
  let exileCards = [];
  if (canRevealPrivateState) {
    [handCards, exileCards] = await Promise.all([
      hydrateCards({
        fallbackOwnerUserId: matchParticipant.controller_user_id,
        cardEntries: matchParticipant.hand_cards_json || [],
        cardCatalogCache,
      }),
      hydrateCards({
        fallbackOwnerUserId: matchParticipant.controller_user_id,
        cardEntries: matchParticipant.exile_cards_json || [],
        cardCatalogCache,
      }),
    ]);
  } else {
    handCards = buildHiddenHandCards(matchParticipant.hand_cards_json || []);
  }

  return {
    participantId: matchParticipant.id,
    controllerUserId: matchParticipant.controller_user_id,
    controllerUsername: matchParticipant.controller_username,
    displayName: matchParticipant.display_name,
    participantType: matchParticipant.participant_type,
    sourceDeckId: matchParticipant.source_deck_id,
    turnOrder: matchParticipant.turn_order,
    health: matchParticipant.health,
    imo: matchParticipant.imo,
    maxImo: matchParticipant.max_imo,
    hasDrawnThisTurn: matchParticipant.has_drawn_this_turn,
    hasUsedCardActionThisTurn: matchParticipant.has_used_card_action_this_turn,
    isDefeated: matchParticipant.is_defeated,
    isControlledByViewer: canRevealPrivateState,
    isCurrentTurn: activeMatch.current_turn_participant_id === matchParticipant.id,
    zones: {
      deckCount: (matchParticipant.deck_cards_json || []).length,
      handCount: (matchParticipant.hand_cards_json || []).length,
      exileCount: (matchParticipant.exile_cards_json || []).length,
    },
    handCards,
    exileCards: canRevealPrivateState ? exileCards : [],
    availableActions: buildAvailableActions({
      activeMatch,
      matchParticipant,
      requesterUserId,
    }),
  };
}

function buildAvailableActions({ activeMatch, matchParticipant, requesterUserId }) {
  if (!activeMatch || activeMatch.status !== 'active') {
    return [];
  }

  if (matchParticipant.controller_user_id !== requesterUserId) {
    return [];
  }

  if (matchParticipant.is_defeated) {
    return [];
  }

  const combatState = normalizeCombatState(activeMatch.combat_state_json);
  if (combatState) {
    return [];
  }

  if (activeMatch.current_turn_participant_id !== matchParticipant.id) {
    return [];
  }

  const actions = ['endTurn'];

  if (!matchParticipant.has_used_card_action_this_turn) {
    actions.unshift('discardCard');
    actions.unshift('playCard');
  }

  if (!matchParticipant.has_drawn_this_turn && (matchParticipant.hand_cards_json || []).length < MAX_HAND_SIZE) {
    actions.unshift('drawCard');
  }

  return actions;
}

async function requireActiveTurnContext({ roomId, userId, actingParticipantId, includeAllParticipants = false }) {
  const context = await requireActiveMatchContext({
    roomId,
    userId,
    actingParticipantId,
    includeAllParticipants,
  });

  if (context.match.current_turn_participant_id !== context.currentParticipant.id) {
    throw new AppError('Nao e o turno dessa criatura.', 409);
  }

  return context;
}

async function requireActiveMatchContext({ roomId, userId, actingParticipantId, includeAllParticipants = false }) {
  const match = await findActiveMatchByRoomId(roomId);
  if (!match) {
    const room = await findRoomById(roomId);
    if (!room) {
      throw new AppError('Sala nao encontrada.', 404);
    }

    throw new AppError('Nao existe partida ativa para esta sala.', 409);
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
      throw new AppError('Voce nao pertence a esta sala.', 403);
    }

    throw new AppError('Participante nao encontrado na partida.', 404);
  }

  if (currentParticipant.controller_user_id !== userId) {
    throw new AppError('Voce nao controla esse participante.', 403);
  }

  if (currentParticipant.is_defeated) {
    throw new AppError('Participante derrotado nao pode agir.', 409);
  }

  const participants = includeAllParticipants
    ? await listMatchParticipants(match.id)
    : [currentParticipant];

  return {
    match,
    participants,
    currentParticipant,
  };
}

function createMutableParticipantMap(participants) {
  return new Map(participants.map((participant) => [participant.id, cloneParticipantState(participant)]));
}

function cloneParticipantState(participant) {
  return {
    ...participant,
    deck_cards_json: [...(participant.deck_cards_json || [])],
    hand_cards_json: [...(participant.hand_cards_json || [])],
    exile_cards_json: [...(participant.exile_cards_json || [])],
  };
}

async function persistParticipantStates({ participantsById, originalParticipants }) {
  const originalsById = new Map(originalParticipants.map((participant) => [participant.id, participant]));
  const persistedEntries = await Promise.all(
    [...participantsById.values()].map(async (participantState) => {
      const updatedParticipant = await updateMatchParticipant({
        participantId: participantState.id,
        turnOrder: participantState.turn_order,
        health: participantState.health,
        imo: participantState.imo,
        maxImo: participantState.max_imo,
        hasDrawnThisTurn: participantState.has_drawn_this_turn,
        hasUsedCardActionThisTurn: participantState.has_used_card_action_this_turn,
        isDefeated: participantState.is_defeated,
        deckCards: participantState.deck_cards_json,
        handCards: participantState.hand_cards_json,
        exileCards: participantState.exile_cards_json,
      });

      const originalParticipant = originalsById.get(participantState.id);
      return [
        participantState.id,
        {
          ...updatedParticipant,
          controller_username: originalParticipant?.controller_username || participantState.controller_username,
          controller_email: originalParticipant?.controller_email || participantState.controller_email,
        },
      ];
    })
  );

  return new Map(persistedEntries);
}

async function consumeCardFromHand({
  fallbackOwnerUserId,
  handCards,
  instanceId,
  notFoundMessage,
  unresolvedMessage,
}) {
  const cardIndex = handCards.findIndex((entry) => entry.instanceId === instanceId);
  if (cardIndex < 0) {
    throw new AppError(notFoundMessage, 404);
  }

  const [cardEntry] = handCards.splice(cardIndex, 1);
  const resolvedCard = await resolveMatchCardEntry({
    cardEntry,
    fallbackOwnerUserId,
  });
  if (!resolvedCard) {
    throw new AppError(unresolvedMessage, 404);
  }

  return {
    cardEntry,
    resolvedCard,
  };
}

async function applyCardAutomation({
  phase,
  ownerUserId,
  card,
  currentCard,
  actingParticipant,
  participantsById,
  targetParticipantId,
  selectedExileCardId,
  selectedOwnHandCardId,
  selectedTargetHandCardId,
}) {
  const automation = phase === 'play' ? card.playAutomation : card.discardAutomation;
  if (!automation?.effects?.length) {
    return createAutomationOutcome();
  }

  const selectedTargetState = resolveAutomationTarget({
    automation,
    actingParticipant,
    participantsById,
    targetParticipantId,
  });
  const outcome = createAutomationOutcome();

  for (const effect of automation.effects) {
    if (effect.type === 'gainCatalogCardToHand') {
      const generatedCard = await createGeneratedCardEntry({
        ownerParticipantId: actingParticipant.id,
        ownerUserId,
        cardId: effect.cardId,
      });

      actingParticipant.hand_cards_json = [...actingParticipant.hand_cards_json, generatedCard];
      outcome.notices.push(`Efeito resolvido: ${generatedCard.cardId} foi gerada na sua mao.`);
      continue;
    }

    if (effect.type === 'moveSelectedExileCardToHand') {
      const excludedInstanceIds = new Set(
        effect.excludeCurrentCard && currentCard?.instanceId ? [currentCard.instanceId] : []
      );
      const selectableCards = actingParticipant.exile_cards_json.filter(
        (entry) => !excludedInstanceIds.has(entry.instanceId)
      );

      if (!selectableCards.length) {
        outcome.notices.push('Efeito sem alvo valido: nao havia carta exilada disponivel para recuperar.');
        continue;
      }

      if (!selectedExileCardId) {
        throw new AppError('Escolha uma carta do seu exilio para recuperar.', 400);
      }

      const exileIndex = actingParticipant.exile_cards_json.findIndex(
        (entry) => entry.instanceId === selectedExileCardId && !excludedInstanceIds.has(entry.instanceId)
      );
      if (exileIndex < 0) {
        throw new AppError('A carta selecionada nao esta disponivel no seu exilio.', 400);
      }

      const [recoveredCard] = actingParticipant.exile_cards_json.splice(exileIndex, 1);
      actingParticipant.hand_cards_json = [...actingParticipant.hand_cards_json, recoveredCard];
      outcome.notices.push('Efeito resolvido: uma carta do seu exilio voltou para a sua mao.');
      continue;
    }

    if (effect.type === 'drawTopDeckToHand') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.deck_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: o deck de ${targetState.display_name} estava vazio.`);
        continue;
      }

      const [drawnCard] = targetState.deck_cards_json.splice(0, 1);
      targetState.hand_cards_json = [...targetState.hand_cards_json, drawnCard];
      outcome.notices.push(`Efeito resolvido: ${targetState.display_name} comprou uma carta.`);
      continue;
    }

    if (effect.type === 'moveTopDeckToExile') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.deck_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: o deck de ${targetState.display_name} estava vazio.`);
        continue;
      }

      const [exiledCard] = targetState.deck_cards_json.splice(0, 1);
      targetState.exile_cards_json = [exiledCard, ...targetState.exile_cards_json];
      outcome.notices.push(`Efeito resolvido: o topo do deck de ${targetState.display_name} foi para o exilio.`);
      continue;
    }

    if (effect.type === 'moveTopExileToDeck') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.exile_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: o exilio de ${targetState.display_name} estava vazio.`);
        continue;
      }

      const [returnedCard] = targetState.exile_cards_json.splice(0, 1);
      targetState.deck_cards_json = effect.shuffleIntoDeck
        ? shuffleCardEntries([...targetState.deck_cards_json, returnedCard])
        : [returnedCard, ...targetState.deck_cards_json];
      outcome.notices.push(`Efeito resolvido: uma carta do exilio de ${targetState.display_name} voltou para o deck.`);
      continue;
    }

    if (effect.type === 'revealTopDeck') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.deck_cards_json.length) {
        outcome.notices.push(`O deck de ${targetState.display_name} estava vazio.`);
        continue;
      }

      const revealedCard = await resolveMatchCardEntry({
        cardEntry: targetState.deck_cards_json[0],
        fallbackOwnerUserId: targetState.controller_user_id,
      });

      outcome.notices.push(`Voce visualizou o topo do deck de ${targetState.display_name}.`);
      if (!revealedCard) {
        continue;
      }

      outcome.effects.push({
        type: 'viewTopDeck',
        actorParticipantId: actingParticipant.id,
        targetParticipantId: targetState.id,
        targetDisplayName: targetState.display_name,
        canReveal: true,
        card: {
          ...revealedCard,
          instanceId: targetState.deck_cards_json[0].instanceId,
        },
      });
      continue;
    }

    if (effect.type === 'moveSelectedOwnHandCardToTargetHand') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!actingParticipant.hand_cards_json.length) {
        outcome.notices.push('Efeito sem alvo valido: nao havia outra carta na sua mao para passar.');
        continue;
      }

      if (!selectedOwnHandCardId) {
        throw new AppError('Escolha uma carta da sua mao para passar ao alvo.', 400);
      }

      const ownHandIndex = actingParticipant.hand_cards_json.findIndex(
        (entry) => entry.instanceId === selectedOwnHandCardId
      );
      if (ownHandIndex < 0) {
        throw new AppError('A carta selecionada nao esta disponivel na sua mao.', 400);
      }

      const [passedCard] = actingParticipant.hand_cards_json.splice(ownHandIndex, 1);
      const reassignedCard = reassignMatchCardEntryOwner({
        cardEntry: passedCard,
        nextOwnerId: targetState.id,
      });
      targetState.hand_cards_json = [...targetState.hand_cards_json, reassignedCard];
      const passedResolvedCard = await resolveMatchCardEntry({
        cardEntry: reassignedCard,
        fallbackOwnerUserId: targetState.controller_user_id,
      });
      outcome.notices.push(
        passedResolvedCard
          ? `Efeito resolvido: ${passedResolvedCard.name} foi passada para a mao de ${targetState.display_name}.`
          : `Efeito resolvido: uma carta da sua mao foi passada para ${targetState.display_name}.`
      );
      continue;
    }

    if (effect.type === 'revealRandomHandCard') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.hand_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: a mao de ${targetState.display_name} estava vazia.`);
        continue;
      }

      const randomIndex = Math.floor(Math.random() * targetState.hand_cards_json.length);
      const revealedHandEntry = targetState.hand_cards_json[randomIndex];
      const revealedHandCard = await resolveMatchCardEntry({
        cardEntry: revealedHandEntry,
        fallbackOwnerUserId: targetState.controller_user_id,
      });

      outcome.notices.push(`Voce visualizou uma carta aleatoria da mao de ${targetState.display_name}.`);
      if (!revealedHandCard) {
        continue;
      }

      outcome.effects.push({
        type: 'viewRandomHandCard',
        actorParticipantId: actingParticipant.id,
        targetParticipantId: targetState.id,
        targetDisplayName: targetState.display_name,
        canReveal: false,
        card: {
          ...revealedHandCard,
          instanceId: revealedHandEntry.instanceId,
        },
      });
      continue;
    }

    if (effect.type === 'destroySelectedHandCard') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.hand_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: a mao de ${targetState.display_name} estava vazia.`);
        continue;
      }

      if (!selectedTargetHandCardId) {
        throw new AppError('Escolha uma carta da mao do alvo para destruir.', 400);
      }

      const targetHandIndex = targetState.hand_cards_json.findIndex(
        (entry) => entry.instanceId === selectedTargetHandCardId
      );
      if (targetHandIndex < 0) {
        throw new AppError('A carta selecionada nao esta disponivel na mao do alvo.', 400);
      }

      const [destroyedCard] = targetState.hand_cards_json.splice(targetHandIndex, 1);
      const destroyedResolvedCard = await resolveMatchCardEntry({
        cardEntry: destroyedCard,
        fallbackOwnerUserId: targetState.controller_user_id,
      });
      outcome.notices.push(
        destroyedResolvedCard
          ? `Efeito resolvido: ${destroyedResolvedCard.name} foi destruida da mao de ${targetState.display_name}.`
          : `Efeito resolvido: uma carta da mao de ${targetState.display_name} foi destruida.`
      );
      continue;
    }

    if (effect.type === 'destroyRandomHandCard') {
      const targetState = resolveEffectTargetState({ effect, actingParticipant, selectedTargetState });
      if (!targetState.hand_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: a mao de ${targetState.display_name} estava vazia.`);
        continue;
      }

      const randomIndex = Math.floor(Math.random() * targetState.hand_cards_json.length);
      const [destroyedCard] = targetState.hand_cards_json.splice(randomIndex, 1);
      const destroyedResolvedCard = await resolveMatchCardEntry({
        cardEntry: destroyedCard,
        fallbackOwnerUserId: targetState.controller_user_id,
      });
      outcome.notices.push(
        destroyedResolvedCard
          ? `Efeito resolvido: ${destroyedResolvedCard.name} foi destruida aleatoriamente da mao de ${targetState.display_name}.`
          : `Efeito resolvido: uma carta aleatoria da mao de ${targetState.display_name} foi destruida.`
      );
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
    throw new AppError('Esta carta exige a selecao de um alvo valido.', 400);
  }

  const targetState = participantsById.get(normalizedTargetParticipantId);
  if (!targetState) {
    throw new AppError('O alvo selecionado nao esta disponivel na partida.', 404);
  }

  if (automation.targetScope === 'other-player' && targetState.id === actingParticipant.id) {
    throw new AppError('Esta carta exige outro participante como alvo.', 400);
  }

  return targetState;
}

function resolveEffectTargetState({ effect, actingParticipant, selectedTargetState }) {
  if (effect.target === 'self' || !effect.target) {
    return actingParticipant;
  }

  if (!selectedTargetState) {
    throw new AppError('O efeito da carta exige um alvo selecionado.', 400);
  }

  return selectedTargetState;
}

function createAutomationOutcome() {
  return {
    notices: [],
    effects: [],
  };
}

function mergeAutomationOutcome(targetOutcome, nextOutcome) {
  if (!targetOutcome || !nextOutcome) {
    return targetOutcome;
  }

  targetOutcome.notices.push(...(nextOutcome.notices || []));
  targetOutcome.effects.push(...(nextOutcome.effects || []));
  return targetOutcome;
}

function buildAttackCombatState({
  attackerState,
  defenderState,
  attackCard,
  attackCardEntry,
  initiatedByCounterResponse = false,
}) {
  return {
    type: 'attack',
    status: 'awaiting-reaction',
    attackerParticipantId: attackerState.id,
    attackerDisplayName: attackerState.display_name,
    defenderParticipantId: defenderState.id,
    defenderDisplayName: defenderState.display_name,
    attackCard: {
      cardId: attackCard.id,
      instanceId: attackCardEntry.instanceId,
      name: attackCard.name,
    },
    initiatedByCounterResponse,
    reactionCard: null,
  };
}

function buildMatchState(activeMatch) {
  return {
    id: activeMatch.id,
    status: activeMatch.status,
    round: activeMatch.round,
    currentTurnParticipantId: activeMatch.current_turn_participant_id,
    winnerParticipantId: activeMatch.winner_participant_id,
    combatState: activeMatch.combat_state_json || null,
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
  const allSelectedDeckIds = players.flatMap((player) => normalizeSelectedDeckIds(player));
  const selectedDecks = await listDecksByIds(allSelectedDeckIds);
  const deckMap = new Map(selectedDecks.map((deck) => [deck.id, deck]));
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0 ? Number(masterUserId) : null;

  return players.map((player) => {
    const selectedDeckIds = normalizeSelectedDeckIds(player);
    return {
      ...player,
      role: player.user_id === resolvedMasterUserId ? 'master' : 'player',
      is_master: player.user_id === resolvedMasterUserId,
      selected_deck_ids: selectedDeckIds,
      selected_decks: selectedDeckIds
        .map((deckId) => deckMap.get(deckId))
        .filter(Boolean)
        .map((deck) => ({
          id: deck.id,
          name: deck.name,
          owner_id: deck.owner_id,
        })),
    };
  });
}

function buildDeckMapFromPlayers(players) {
  const map = new Map();
  for (const player of players) {
    for (const deck of player.selected_decks || []) {
      map.set(deck.id, deck);
    }
  }
  return map;
}

function createCardInstanceId(cardId) {
  return `${cardId}::generated::${Math.random().toString(36).slice(2, 10)}`;
}

function createMatchCardEntry({
  card,
  ownerParticipantId,
  catalogOwnerId,
  instanceId = null,
}) {
  const entry = {
    cardId: card.id,
    instanceId: instanceId || createCardInstanceId(card.id),
    ownerId: ownerParticipantId,
  };

  const normalizedCatalogOwnerId = Number(catalogOwnerId ?? card?.catalogOwnerId);
  if (Number.isInteger(normalizedCatalogOwnerId)) {
    entry.catalogOwnerId = normalizedCatalogOwnerId;
  }

  return entry;
}

function reassignCardEntriesToParticipant(cardEntries, participantId) {
  return (cardEntries || []).map((entry) => ({
    ...entry,
    ownerId: participantId,
  }));
}

function reassignMatchCardEntryOwner({ cardEntry, nextOwnerId }) {
  return {
    ...cardEntry,
    ownerId: nextOwnerId,
  };
}

function getMatchCardCatalogOwnerId(cardEntry, fallbackOwnerUserId) {
  const normalizedCatalogOwnerId = Number(cardEntry?.catalogOwnerId);
  if (Number.isInteger(normalizedCatalogOwnerId)) {
    return normalizedCatalogOwnerId;
  }

  return fallbackOwnerUserId;
}

async function createGeneratedCardEntry({ ownerParticipantId, ownerUserId, cardId }) {
  const generatedCard = await resolveCardById({ ownerId: ownerUserId, cardId });
  if (!generatedCard) {
    throw new AppError(`Carta ${cardId} nao encontrada no catalogo.`, 404);
  }

  return createMatchCardEntry({
    card: generatedCard,
    ownerParticipantId,
    catalogOwnerId: ownerUserId,
  });
}

async function resolveMatchCardEntry({ cardEntry, fallbackOwnerUserId }) {
  if (!cardEntry?.cardId) {
    return null;
  }

  return resolveCardById({
    ownerId: getMatchCardCatalogOwnerId(cardEntry, fallbackOwnerUserId),
    cardId: cardEntry.cardId,
  });
}

function shuffleCardEntries(cards) {
  const entries = [...cards];
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [entries[index], entries[randomIndex]] = [entries[randomIndex], entries[index]];
  }

  return entries;
}

function shuffleCards(cards) {
  const entries = shuffleCardEntries(cards);
  return entries.map((card, index) => ({
    ...card,
    instanceId: `${card.cardId || card.id}::${index + 1}::${Math.random().toString(36).slice(2, 8)}`,
    cardId: card.cardId || card.id,
  }));
}

function buildHiddenHandCards(handEntries) {
  return (handEntries || []).map((entry, index) => ({
    instanceId: entry.instanceId,
    cardId: null,
    name: `Carta oculta ${index + 1}`,
    category: 'hidden',
    effect: 'Carta oculta na mao do alvo.',
    imagePath: '',
    isHidden: true,
  }));
}

async function getCardCatalogMapForUser(ownerId, cache) {
  if (cache.has(ownerId)) {
    return cache.get(ownerId);
  }

  const catalog = await getDeckCatalog(ownerId);
  const map = new Map(catalog.map((card) => [card.id, card]));
  cache.set(ownerId, map);
  return map;
}

async function hydrateCards({ fallbackOwnerUserId, cardEntries, cardCatalogCache }) {
  const hydrated = [];

  for (const entry of cardEntries || []) {
    const catalogOwnerId = getMatchCardCatalogOwnerId(entry, fallbackOwnerUserId);
    const cardCatalogMap = await getCardCatalogMapForUser(catalogOwnerId, cardCatalogCache);
    const baseCard = cardCatalogMap.get(entry.cardId);
    if (!baseCard) {
      continue;
    }

    hydrated.push({
      ...baseCard,
      instanceId: entry.instanceId,
      ownerId: Number(entry?.ownerId) || null,
      catalogOwnerId,
    });
  }

  return hydrated;
}

async function finalizeActionResponse({ roomId, userId, includeSnapshot, actionState = null }) {
  if (!includeSnapshot) {
    return actionState;
  }

  const snapshot = await getMatchSnapshot({ roomId, userId });
  if (!actionState?.notice && !actionState?.effectResults?.length) {
    return snapshot;
  }

  return {
    ...snapshot,
    actionNotice: actionState.notice,
    actionEffects: actionState.effectResults || [],
  };
}

module.exports = {
  discardCardForPlayer,
  drawCardForPlayer,
  endTurnForPlayer,
  forfeitMatchByLeavingRoom,
  getMatchSnapshot,
  getMatchSnapshotsForUsers,
  getRealtimeMatchStatesForUsers,
  playCardForPlayer,
  reactToAttackForPlayer,
  resolveAttackForPlayer,
  revealViewedTopDeckCardForPlayer,
  startMatchForRoom,
};
