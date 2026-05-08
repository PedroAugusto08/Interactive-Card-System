const { findRoomById, listRoomPlayers, updateRoomState, assignRoomPlayerTurnOrders, isPlayerInRoom } = require('../models/roomModel');
const {
  createMatch,
  findActiveMatchByRoomId,
  updateMatchState,
  updateMatchCombatState,
  upsertMatchPlayer,
  listMatchPlayers,
  findMatchPlayer,
  addMatchLog,
  listMatchLogs,
} = require('../models/matchModel');
const { AppError } = require('../utils/AppError');
const { getDeckCatalog, getResolvedDeckForUser, resolveCardById } = require('./deckService');

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

async function startMatchForRoom({ roomId, userId, includeSnapshot = true }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.host_id !== userId) {
    throw new AppError('Somente o host pode iniciar a partida.', 403);
  }

  if (room.status !== 'lobby') {
    throw new AppError('A sala nao esta em lobby para iniciar partida.', 409);
  }

  const players = await listRoomPlayers(roomId);
  if (players.length < 2) {
    throw new AppError('A partida precisa de ao menos 2 jogadores.', 409);
  }

  const playersWithoutDeck = players.filter((player) => !player.selected_deck_id);
  if (playersWithoutDeck.length) {
    throw new AppError('Todos os jogadores precisam selecionar um deck.', 409);
  }

  const playersNotReady = players.filter((player) => !player.is_ready);
  if (playersNotReady.length) {
    throw new AppError('Todos os jogadores precisam estar prontos.', 409);
  }

  const orderedUserIds = players.map((player) => player.user_id);
  await assignRoomPlayerTurnOrders({ roomId, orderedUserIds });

  const activeMatch = await findActiveMatchByRoomId(roomId);
  if (activeMatch) {
    throw new AppError('Ja existe uma partida ativa para esta sala.', 409);
  }

  const match = await createMatch({
    roomId,
    currentTurnPlayerId: orderedUserIds[0],
  });

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const { expandedCards } = await getResolvedDeckForUser({
      deckId: player.selected_deck_id,
      ownerId: player.user_id,
    });

    const normalizedDeckEntries = expandedCards.map((card) =>
      createMatchCardEntry({
        card,
        ownerId: player.user_id,
        instanceId: card.instanceId,
      })
    );
    const shuffledDeck = shuffleCards(normalizedDeckEntries);
    const handCards = shuffledDeck.splice(0, MAX_HAND_SIZE);

    await upsertMatchPlayer({
      matchId: match.id,
      userId: player.user_id,
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
  }

  await updateRoomState({
    roomId: room.id,
    hostId: room.host_id,
    status: 'in_match',
  });

  await addMatchLog({
    matchId: match.id,
    type: 'MATCH_START',
    message: 'A partida foi iniciada.',
    payload: { roomId: room.id },
  });

  return finalizeActionResponse({ roomId, userId, includeSnapshot });
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

  const context = await loadMatchSnapshotContext({ roomId, userId: requesterIds[0], skipMembershipCheck: true });
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
      metrics: {
        totalMs: 0,
      },
    };
  }

  const findMatchStartedAt = performance.now();
  const match = await findActiveMatchByRoomId(roomId);
  const findMatchMs = performance.now() - findMatchStartedAt;
  if (!match) {
    return {
      latestLog: null,
      snapshotsByUserId: new Map(),
      metrics: {
        findMatchMs,
        totalMs: performance.now() - startedAt,
      },
    };
  }

  const loadMatchDataStartedAt = performance.now();
  const [matchPlayers, latestLogs] = await Promise.all([listMatchPlayers(match.id), listMatchLogs(match.id, 1)]);
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
        matchPlayers,
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

  const [players, activeMatch] = await Promise.all([listRoomPlayers(roomId), findActiveMatchByRoomId(roomId)]);

  if (!activeMatch) {
    return {
      room,
      players,
      activeMatch: null,
      matchPlayers: [],
      logs: [],
    };
  }

  const [matchPlayers, logs] = await Promise.all([listMatchPlayers(activeMatch.id), listMatchLogs(activeMatch.id)]);

  return {
    room,
    players,
    activeMatch,
    matchPlayers,
    logs,
  };
}

async function buildMatchSnapshot({ room, players, activeMatch, matchPlayers, logs, userId }) {
  if (!activeMatch) {
    return {
      room,
      players,
      match: null,
      currentTurnPlayerId: null,
      round: null,
      currentUserState: null,
      logs: [],
    };
  }

  const cardCatalogCache = new Map();
  const hydratedPlayers = await Promise.all(
    matchPlayers.map((player) =>
      buildPlayerState({
        activeMatch,
        matchPlayer: player,
        requesterUserId: userId,
        cardCatalogCache,
      })
    )
  );

  const currentUserState = hydratedPlayers.find((player) => player.userId === userId) || null;

  return {
    room,
    players,
    match: {
      id: activeMatch.id,
      status: activeMatch.status,
      round: activeMatch.round,
      currentTurnPlayerId: activeMatch.current_turn_player_id,
      winnerUserId: activeMatch.winner_user_id,
      combatState: activeMatch.combat_state_json || null,
      startedAt: activeMatch.started_at,
      endedAt: activeMatch.ended_at,
    },
    currentTurnPlayerId: activeMatch.current_turn_player_id,
    round: activeMatch.round,
    currentUserState,
    playerStates: hydratedPlayers,
    logs: logs.map((item) => ({
      id: item.id,
      type: item.type,
      message: item.message,
      payload: item.payload_json,
      timestamp: item.created_at,
    })),
  };
}

async function buildRealtimeMatchState({ activeMatch, matchPlayers, userId, cardCatalogCache }) {
  const playerStates = await Promise.all(
    matchPlayers.map((matchPlayer) =>
      buildPlayerState({
        activeMatch,
        matchPlayer,
        requesterUserId: userId,
        cardCatalogCache,
      })
    )
  );
  const currentUserState = playerStates.find((player) => player.userId === userId) || null;

  return {
    match: {
      id: activeMatch.id,
      status: activeMatch.status,
      round: activeMatch.round,
      currentTurnPlayerId: activeMatch.current_turn_player_id,
      winnerUserId: activeMatch.winner_user_id,
      combatState: activeMatch.combat_state_json || null,
      startedAt: activeMatch.started_at,
      endedAt: activeMatch.ended_at,
    },
    currentTurnPlayerId: activeMatch.current_turn_player_id,
    round: activeMatch.round,
    currentUserState,
    playerStates,
  };
}

async function buildPlayerState({ activeMatch, matchPlayer, requesterUserId, cardCatalogCache }) {
  const isRequester = matchPlayer.user_id === requesterUserId;
  let handCards = [];
  let exileCards = [];

  if (isRequester) {
    [handCards, exileCards] = await Promise.all([
      hydrateCards({
        currentOwnerId: matchPlayer.user_id,
        cardEntries: matchPlayer.hand_cards_json || [],
        cardCatalogCache,
      }),
      hydrateCards({
        currentOwnerId: matchPlayer.user_id,
        cardEntries: matchPlayer.exile_cards_json || [],
        cardCatalogCache,
      }),
    ]);
  } else {
    handCards = buildHiddenHandCards(matchPlayer.hand_cards_json || []);
  }

  return {
    userId: matchPlayer.user_id,
    username: matchPlayer.username,
    email: matchPlayer.email,
    turnOrder: matchPlayer.turn_order,
    health: matchPlayer.health,
    imo: matchPlayer.imo,
    maxImo: matchPlayer.max_imo,
    hasDrawnThisTurn: matchPlayer.has_drawn_this_turn,
    hasUsedCardActionThisTurn: matchPlayer.has_used_card_action_this_turn,
    isDefeated: matchPlayer.is_defeated,
    zones: {
      deckCount: (matchPlayer.deck_cards_json || []).length,
      handCount: isRequester ? handCards.length : (matchPlayer.hand_cards_json || []).length,
      exileCount: isRequester ? exileCards.length : (matchPlayer.exile_cards_json || []).length,
    },
    handCards,
    exileCards: isRequester ? exileCards : [],
    availableActions: buildAvailableActions({
      activeMatch,
      matchPlayer,
      requesterUserId,
    }),
  };
}

async function buildActionRealtimeState({ activeMatch, currentUserId, log, notice = '', effectResults = [] }) {
  const matchPlayers = await listMatchPlayers(activeMatch.id);
  const cardCatalogCache = new Map();
  const playerStates = await Promise.all(
    matchPlayers.map((matchPlayer) =>
      buildPlayerState({
        activeMatch,
        matchPlayer,
        requesterUserId: currentUserId,
        cardCatalogCache,
      })
    )
  );
  const currentUserState = playerStates.find((player) => player.userId === currentUserId) || null;

  return {
    snapshot: {
      match: {
        id: activeMatch.id,
        status: activeMatch.status,
        round: activeMatch.round,
        currentTurnPlayerId: activeMatch.current_turn_player_id,
        winnerUserId: activeMatch.winner_user_id,
        combatState: activeMatch.combat_state_json || null,
        startedAt: activeMatch.started_at,
        endedAt: activeMatch.ended_at,
      },
      currentTurnPlayerId: activeMatch.current_turn_player_id,
      round: activeMatch.round,
      currentUserState,
      playerStates,
    },
    notice,
    effectResults,
    log: log
      ? {
          id: log.id,
          type: log.type,
          message: log.message,
          payload: log.payload_json,
          timestamp: log.created_at,
        }
      : null,
  };
}

async function drawCardForPlayer({ roomId, userId, includeSnapshot = true }) {
  const context = await requireActiveTurnContext({ roomId, userId, includeAllPlayers: false });
  const playerState = context.currentPlayer;
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (combatState) {
    throw new AppError('Resolva o ataque pendente antes de comprar uma carta.', 409);
  }

  if (playerState.has_drawn_this_turn) {
    throw new AppError('Voce ja comprou uma carta neste turno.', 409);
  }

  if ((playerState.hand_cards_json || []).length >= MAX_HAND_SIZE) {
    throw new AppError('Sua mao ja esta no limite de 3 cartas.', 409);
  }

  if (!(playerState.deck_cards_json || []).length) {
    throw new AppError('Nao ha mais cartas no deck para comprar.', 409);
  }

  const deckCards = [...playerState.deck_cards_json];
  const nextCard = deckCards.shift();
  const handCards = [...playerState.hand_cards_json, nextCard];

  const [updatedPlayerState, createdLog] = await Promise.all([
    upsertMatchPlayer({
      matchId: context.match.id,
      userId,
      turnOrder: playerState.turn_order,
      health: playerState.health,
      imo: playerState.imo,
      maxImo: playerState.max_imo,
      hasDrawnThisTurn: true,
      hasUsedCardActionThisTurn: playerState.has_used_card_action_this_turn,
      isDefeated: playerState.is_defeated,
      deckCards,
      handCards,
      exileCards: playerState.exile_cards_json,
    }),
    addMatchLog({
      matchId: context.match.id,
      type: 'MATCH_DRAW',
      message: `${playerState.username} comprou uma carta.`,
      payload: { userId, cardId: nextCard.cardId },
    }),
  ]);

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: context.match,
      currentUserId: userId,
      currentPlayer: {
        ...updatedPlayerState,
        username: playerState.username,
        email: playerState.email,
      },
      log: createdLog,
    }),
  });
}

async function playCardForPlayer({
  roomId,
  userId,
  cardId,
  targetUserId = null,
  selectedExileCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  pairedCardId = null,
  pairedTargetUserId = null,
  pairedSelectedExileCardId = null,
  pairedSelectedOwnHandCardId = null,
  pairedSelectedTargetHandCardId = null,
  asCounterResponse = false,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({ roomId, userId, includeAllPlayers: true });
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const isCounterResponse =
    Boolean(asCounterResponse) &&
    combatState?.type === 'attack' &&
    combatState?.status === 'awaiting-counter-response' &&
    combatState?.defenderUserId === userId;
  const originalPlayerState = context.currentPlayer;

  if (!asCounterResponse && combatState) {
    throw new AppError('Resolva o ataque pendente antes de continuar a partida.', 409);
  }

  if (!asCounterResponse && context.match.current_turn_player_id !== userId) {
    throw new AppError('Nao e o seu turno.', 409);
  }

  if (asCounterResponse && !isCounterResponse) {
    throw new AppError('Nao ha uma janela de resposta disponivel para voce agora.', 409);
  }

  if (!isCounterResponse && originalPlayerState.has_used_card_action_this_turn) {
    throw new AppError('Voce ja usou sua acao de carta neste turno.', 409);
  }

  const playerStatesByUserId = createMutableMatchPlayerMap(context.matchPlayers);
  const actingPlayerState = playerStatesByUserId.get(userId);
  const handCards = [...actingPlayerState.hand_cards_json];
  const primaryPlay = await consumeCardFromHand({
    ownerId: userId,
    handCards,
    instanceId: cardId,
    notFoundMessage: 'Carta nao encontrada na sua mao.',
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
      ownerId: userId,
      handCards,
      instanceId: pairedCardId,
      notFoundMessage: 'Carta jogada junto nao encontrada na sua mao.',
      unresolvedMessage: 'Carta jogada junto nao encontrada no catalogo.',
    });
  }

  const totalImoCost =
    Number(primaryPlay.resolvedCard.imoCost || 0) + Number(pairedPlay?.resolvedCard.imoCost || 0);
  if (actingPlayerState.imo < totalImoCost) {
    throw new AppError('Imo insuficiente para jogar esta carta.', 409);
  }

  actingPlayerState.imo -= totalImoCost;
  if (!isCounterResponse) {
    actingPlayerState.has_used_card_action_this_turn = true;
  }
  actingPlayerState.hand_cards_json = handCards;
  actingPlayerState.deck_cards_json = [...actingPlayerState.deck_cards_json, primaryPlay.cardEntry];

  const automationOutcome = createAutomationOutcome();
  mergeAutomationOutcome(
    automationOutcome,
    await applyCardAutomation({
      phase: 'play',
      ownerId: userId,
      card: primaryPlay.resolvedCard,
      currentCard: primaryPlay.cardEntry,
      actingPlayerState,
      playerStatesByUserId,
      targetUserId,
      selectedExileCardId,
      selectedOwnHandCardId,
      selectedTargetHandCardId,
    })
  );

  if (pairedPlay) {
    actingPlayerState.deck_cards_json = [...actingPlayerState.deck_cards_json, pairedPlay.cardEntry];
    mergeAutomationOutcome(
      automationOutcome,
      await applyCardAutomation({
        phase: 'play',
        ownerId: userId,
        card: pairedPlay.resolvedCard,
        currentCard: pairedPlay.cardEntry,
        actingPlayerState,
        playerStatesByUserId,
        targetUserId: pairedTargetUserId,
        selectedExileCardId: pairedSelectedExileCardId,
        selectedOwnHandCardId: pairedSelectedOwnHandCardId,
        selectedTargetHandCardId: pairedSelectedTargetHandCardId,
      })
    );
  }

  let nextCombatState = combatState;
  let attackTargetState = null;
  if (isAttackCard(primaryPlay.resolvedCard)) {
    const normalizedTargetUserId = Number(targetUserId);
    if (!Number.isInteger(normalizedTargetUserId)) {
      throw new AppError('Selecione um alvo valido para o ataque.', 400);
    }

    attackTargetState = playerStatesByUserId.get(normalizedTargetUserId);
    if (!attackTargetState || attackTargetState.user_id === userId || attackTargetState.is_defeated) {
      throw new AppError('Selecione outro jogador valido para receber o ataque.', 400);
    }

    nextCombatState = buildAttackCombatState({
      attackerState: actingPlayerState,
      defenderState: attackTargetState,
      attackCard: primaryPlay.resolvedCard,
      attackCardEntry: primaryPlay.cardEntry,
      initiatedByCounterResponse: isCounterResponse,
    });
  } else if (isCounterResponse) {
    nextCombatState = null;
  }

  const notice = automationOutcome.notices.join(' ');
  const updatedPlayerStatesByUserId = await persistMatchPlayerStates({
    matchId: context.match.id,
    playerStatesByUserId,
    originalPlayers: context.matchPlayers,
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
      ? `${originalPlayerState.username} atacou ${attackTargetState.username} com ${primaryPlay.resolvedCard.name}.`
      : isCounterResponse
        ? `${originalPlayerState.username} jogou ${primaryPlay.resolvedCard.name} em resposta ao ataque de ${combatState.attackerUsername}.`
        : pairedPlay
          ? `${originalPlayerState.username} jogou ${primaryPlay.resolvedCard.name} junto com ${pairedPlay.resolvedCard.name}.`
          : `${originalPlayerState.username} jogou ${primaryPlay.resolvedCard.name}.`,
    payload: {
      userId,
      cardId: primaryPlay.cardEntry.cardId,
      imoCost: totalImoCost,
      targetUserId: targetUserId || null,
      selectedOwnHandCardId: selectedOwnHandCardId || null,
      asCounterResponse: isCounterResponse,
      selectedTargetHandCardId: selectedTargetHandCardId || null,
      pairedCardId: pairedPlay?.cardEntry.cardId || null,
      pairedTargetUserId: pairedTargetUserId || null,
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
      currentUserId: userId,
      currentPlayer: updatedPlayerStatesByUserId.get(userId),
      log: createdLog,
      notice,
      effectResults: automationOutcome.effects,
    }),
  });
}

async function discardCardForPlayer({
  roomId,
  userId,
  cardId,
  targetUserId = null,
  selectedExileCardId = null,
  selectedOwnHandCardId = null,
  selectedTargetHandCardId = null,
  asCounterResponse = false,
  includeSnapshot = true,
}) {
  const context = await requireActiveMatchContext({ roomId, userId, includeAllPlayers: true });
  const combatState = normalizeCombatState(context.match.combat_state_json);
  const isCounterResponse =
    Boolean(asCounterResponse) &&
    combatState?.type === 'attack' &&
    combatState?.status === 'awaiting-counter-response' &&
    combatState?.defenderUserId === userId;
  const originalPlayerState = context.currentPlayer;

  if (!asCounterResponse && combatState) {
    throw new AppError('Resolva o ataque pendente antes de continuar a partida.', 409);
  }

  if (!asCounterResponse && context.match.current_turn_player_id !== userId) {
    throw new AppError('Nao e o seu turno.', 409);
  }

  if (asCounterResponse && !isCounterResponse) {
    throw new AppError('Nao ha uma janela de resposta disponivel para voce agora.', 409);
  }

  if (!isCounterResponse && originalPlayerState.has_used_card_action_this_turn) {
    throw new AppError('Voce ja usou sua acao de carta neste turno.', 409);
  }

  const playerStatesByUserId = createMutableMatchPlayerMap(context.matchPlayers);
  const actingPlayerState = playerStatesByUserId.get(userId);
  const handCards = [...actingPlayerState.hand_cards_json];
  const cardIndex = handCards.findIndex((entry) => entry.instanceId === cardId);

  if (cardIndex < 0) {
    throw new AppError('Carta nao encontrada na sua mao.', 404);
  }

  const [discardedCard] = handCards.splice(cardIndex, 1);
  const resolvedCard = await resolveMatchCardEntry({
    cardEntry: discardedCard,
    fallbackOwnerId: userId,
  });
  if (!resolvedCard) {
    throw new AppError('Carta descartada nao encontrada no catalogo.', 404);
  }

  if (resolvedCard.canDiscard === false) {
    throw new AppError(`A carta ${resolvedCard.name} nao pode ser descartada.`, 409);
  }

  if (!isCounterResponse) {
    actingPlayerState.has_used_card_action_this_turn = true;
  }
  actingPlayerState.hand_cards_json = handCards;
  actingPlayerState.exile_cards_json = [discardedCard, ...actingPlayerState.exile_cards_json];

  const automationOutcome = await applyCardAutomation({
    phase: 'discard',
    ownerId: userId,
    card: resolvedCard,
    currentCard: discardedCard,
    actingPlayerState,
    playerStatesByUserId,
    targetUserId,
    selectedExileCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
  });
  const notice = automationOutcome.notices.join(' ');

  const updatedPlayerStatesByUserId = await persistMatchPlayerStates({
    matchId: context.match.id,
    playerStatesByUserId,
    originalPlayers: context.matchPlayers,
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
      ? `${originalPlayerState.username} descartou ${resolvedCard.name} em resposta ao ataque de ${combatState.attackerUsername}.`
      : `${originalPlayerState.username} descartou ${resolvedCard.name}.`,
    payload: {
      userId,
      cardId: discardedCard.cardId,
      targetUserId: targetUserId || null,
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
      currentUserId: userId,
      currentPlayer: updatedPlayerStatesByUserId.get(userId),
      log: createdLog,
      notice,
      effectResults: automationOutcome.effects,
    }),
  });
}

async function reactToAttackForPlayer({ roomId, userId, reactionCardId, includeSnapshot = true }) {
  const context = await requireActiveMatchContext({ roomId, userId, includeAllPlayers: true });
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (
    !combatState ||
    combatState.type !== 'attack' ||
    combatState.status !== 'awaiting-reaction' ||
    combatState.defenderUserId !== userId
  ) {
    throw new AppError('Nao ha um ataque pendente aguardando sua reacao.', 409);
  }

  const playerStatesByUserId = createMutableMatchPlayerMap(context.matchPlayers);
  const defendingPlayerState = playerStatesByUserId.get(userId);
  const handCards = [...defendingPlayerState.hand_cards_json];
  const reactionPlay = await consumeCardFromHand({
    ownerId: userId,
    handCards,
    instanceId: reactionCardId,
    notFoundMessage: 'Carta de reacao nao encontrada na sua mao.',
    unresolvedMessage: 'Carta de reacao nao encontrada no catalogo.',
  });

  if (!isReactionCard(reactionPlay.resolvedCard)) {
    throw new AppError('Selecione uma carta de Reacao valida para defender esse ataque.', 400);
  }

  defendingPlayerState.hand_cards_json = handCards;
  defendingPlayerState.deck_cards_json = [...defendingPlayerState.deck_cards_json, reactionPlay.cardEntry];

  await persistMatchPlayerStates({
    matchId: context.match.id,
    playerStatesByUserId,
    originalPlayers: context.matchPlayers,
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
    message: `${context.currentPlayer.username} usou Reacao contra o ataque de ${combatState.attackerUsername}.`,
    payload: {
      attackerUserId: combatState.attackerUserId,
      defenderUserId: combatState.defenderUserId,
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
      currentUserId: userId,
      currentPlayer: playerStatesByUserId.get(userId),
      log: createdLog,
    }),
  });
}

async function resolveAttackForPlayer({ roomId, userId, resolution, includeSnapshot = true }) {
  const context = await requireActiveMatchContext({ roomId, userId, includeAllPlayers: true });
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (!combatState || combatState.type !== 'attack' || combatState.defenderUserId !== userId) {
    throw new AppError('Nao ha um ataque pendente vinculado a voce.', 409);
  }

  let nextCombatState = combatState;
  let logMessage = '';
  let logType = 'MATCH_ATTACK_RESOLUTION';

  if (resolution === 'skip-reaction') {
    if (combatState.status !== 'awaiting-reaction') {
      throw new AppError('A etapa atual do ataque nao permite pular a reacao.', 409);
    }

    nextCombatState = null;
    logMessage = `${combatState.defenderUsername} optou por nao reagir ao ataque de ${combatState.attackerUsername}.`;
  } else if (resolution === 'reaction-success') {
    if (combatState.status !== 'awaiting-reaction-result') {
      throw new AppError('Nao ha um teste de reacao pendente para resolver.', 409);
    }

    nextCombatState = {
      ...combatState,
      status: 'awaiting-counter-response',
    };
    logMessage = `${combatState.defenderUsername} superou o ataque de ${combatState.attackerUsername} e pode responder com outra carta.`;
  } else if (resolution === 'reaction-fail') {
    if (combatState.status !== 'awaiting-reaction-result') {
      throw new AppError('Nao ha um teste de reacao pendente para resolver.', 409);
    }

    nextCombatState = null;
    logMessage = `${combatState.defenderUsername} nao superou o ataque de ${combatState.attackerUsername}.`;
  } else if (resolution === 'skip-counter-response') {
    if (combatState.status !== 'awaiting-counter-response') {
      throw new AppError('Nao ha uma carta de resposta pendente para pular.', 409);
    }

    nextCombatState = null;
    logMessage = `${combatState.defenderUsername} encerrou a janela de resposta contra ${combatState.attackerUsername}.`;
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
      attackerUserId: combatState.attackerUserId,
      defenderUserId: combatState.defenderUserId,
      resolution,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: updatedMatchState || context.match,
      currentUserId: userId,
      currentPlayer: context.currentPlayer,
      log: createdLog,
    }),
  });
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
    attackerUserId: attackerState.user_id,
    attackerUsername: attackerState.username,
    defenderUserId: defenderState.user_id,
    defenderUsername: defenderState.username,
    attackCard: {
      cardId: attackCard.id,
      instanceId: attackCardEntry.instanceId,
      name: attackCard.name,
    },
    initiatedByCounterResponse,
    reactionCard: null,
  };
}

async function revealViewedTopDeckCardForPlayer({
  roomId,
  userId,
  targetUserId,
  topDeckInstanceId,
}) {
  const context = await requireActiveMatchContext({ roomId, userId, includeAllPlayers: true });
  const targetState = context.matchPlayers.find((player) => player.user_id === Number(targetUserId));

  if (!targetState) {
    throw new AppError('O alvo selecionado nao esta disponivel na partida.', 404);
  }

  if (!topDeckInstanceId) {
    throw new AppError('A carta visualizada nao foi informada para revelacao.', 400);
  }

  const currentTopDeckCard = targetState.deck_cards_json?.[0];
  if (!currentTopDeckCard) {
    throw new AppError(`O deck de ${targetState.username} esta vazio.`, 409);
  }

  if (currentTopDeckCard.instanceId !== topDeckInstanceId) {
    throw new AppError('O topo do deck mudou antes da revelacao.', 409);
  }

  const resolvedCard = await resolveMatchCardEntry({
    cardEntry: currentTopDeckCard,
    fallbackOwnerId: targetState.user_id,
  });

  if (!resolvedCard) {
    throw new AppError('A carta revelada nao foi encontrada no catalogo.', 404);
  }

  const revealEvent = {
    type: 'topDeckRevealed',
    actorUserId: context.currentPlayer.user_id,
    actorUsername: context.currentPlayer.username,
    targetUserId: targetState.user_id,
    targetUsername: targetState.username,
    card: {
      ...resolvedCard,
      instanceId: currentTopDeckCard.instanceId,
    },
  };

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_REVEAL_TOP_DECK',
    message: `${context.currentPlayer.username} revelou o topo do deck de ${targetState.username}: ${resolvedCard.name}.`,
    payload: {
      actorUserId: context.currentPlayer.user_id,
      targetUserId: targetState.user_id,
      cardId: resolvedCard.id,
      topDeckInstanceId: currentTopDeckCard.instanceId,
    },
  });

  return {
    revealEvent,
    log: createdLog
      ? {
          id: createdLog.id,
          type: createdLog.type,
          message: createdLog.message,
          payload: createdLog.payload_json,
          timestamp: createdLog.created_at,
        }
      : null,
  };
}

async function endTurnForPlayer({ roomId, userId, includeSnapshot = true }) {
  const context = await requireActiveTurnContext({ roomId, userId, includeAllPlayers: true });
  const currentPlayer = context.currentPlayer;
  const combatState = normalizeCombatState(context.match.combat_state_json);

  if (combatState) {
    throw new AppError('Resolva o ataque pendente antes de encerrar o turno.', 409);
  }

  const activePlayers = context.matchPlayers.filter((player) => !player.is_defeated);

  const nextPlayer = getNextTurnPlayer(activePlayers, currentPlayer.user_id);
  const nextRound =
    nextPlayer && nextPlayer.user_id === activePlayers[0]?.user_id
      ? context.match.round + 1
      : context.match.round;

  const [updatedNextPlayerState, updatedMatchState, createdLog] = await Promise.all([
    nextPlayer
      ? upsertMatchPlayer({
          matchId: context.match.id,
          userId: nextPlayer.user_id,
          turnOrder: nextPlayer.turn_order,
          health: nextPlayer.health,
          imo: Math.min(nextPlayer.max_imo, nextPlayer.imo + 1),
          maxImo: nextPlayer.max_imo,
          hasDrawnThisTurn: false,
          hasUsedCardActionThisTurn: false,
          isDefeated: nextPlayer.is_defeated,
          deckCards: nextPlayer.deck_cards_json,
          handCards: nextPlayer.hand_cards_json,
          exileCards: nextPlayer.exile_cards_json,
        })
      : Promise.resolve(null),
    updateMatchState({
      matchId: context.match.id,
      status: 'active',
      round: nextRound,
      currentTurnPlayerId: nextPlayer.user_id,
      winnerUserId: null,
    }),
    addMatchLog({
      matchId: context.match.id,
      type: 'MATCH_END_TURN',
      message: `${currentPlayer.username} encerrou o turno.`,
      payload: { userId },
    }),
  ]);

  const updatedCurrentPlayerState =
    updatedNextPlayerState && updatedNextPlayerState.user_id === userId
      ? {
          ...updatedNextPlayerState,
          username: currentPlayer.username,
          email: currentPlayer.email,
        }
      : currentPlayer;

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch:
        updatedMatchState || {
          ...context.match,
          round: nextRound,
          current_turn_player_id: nextPlayer.user_id,
        },
      currentUserId: userId,
      currentPlayer: updatedCurrentPlayerState,
      log: createdLog,
    }),
  });
}

async function forfeitMatchByLeavingRoom({ roomId, userId }) {
  const match = await findActiveMatchByRoomId(roomId);
  if (!match) {
    return null;
  }

  const matchPlayers = await listMatchPlayers(match.id);
  const leavingPlayer = matchPlayers.find((player) => player.user_id === userId);
  if (!leavingPlayer) {
    return null;
  }

  await upsertMatchPlayer({
    matchId: match.id,
    userId: leavingPlayer.user_id,
    turnOrder: leavingPlayer.turn_order,
    health: leavingPlayer.health,
    imo: leavingPlayer.imo,
    maxImo: leavingPlayer.max_imo,
    hasDrawnThisTurn: leavingPlayer.has_drawn_this_turn,
    hasUsedCardActionThisTurn: leavingPlayer.has_used_card_action_this_turn,
    isDefeated: true,
    deckCards: leavingPlayer.deck_cards_json,
    handCards: leavingPlayer.hand_cards_json,
    exileCards: leavingPlayer.exile_cards_json,
  });

  const remainingPlayers = matchPlayers.filter((player) => player.user_id !== userId && !player.is_defeated);
  if (remainingPlayers.length === 1) {
    await updateMatchState({
      matchId: match.id,
      status: 'finished',
      round: match.round,
      currentTurnPlayerId: null,
      winnerUserId: remainingPlayers[0].user_id,
      endedAt: new Date().toISOString(),
    });

    await updateRoomState({
      roomId,
      hostId: remainingPlayers[0].user_id,
      status: 'finished',
    });

    await addMatchLog({
      matchId: match.id,
      type: 'MATCH_FINISH',
      message: `${remainingPlayers[0].username} venceu por abandono.`,
      payload: { winnerUserId: remainingPlayers[0].user_id, leavingUserId: userId },
    });
  }

  return match.id;
}

function createMutableMatchPlayerMap(matchPlayers) {
  return new Map(matchPlayers.map((player) => [player.user_id, cloneMatchPlayerState(player)]));
}

function cloneMatchPlayerState(player) {
  return {
    ...player,
    deck_cards_json: [...(player.deck_cards_json || [])],
    hand_cards_json: [...(player.hand_cards_json || [])],
    exile_cards_json: [...(player.exile_cards_json || [])],
  };
}

async function persistMatchPlayerStates({ matchId, playerStatesByUserId, originalPlayers }) {
  const originalsByUserId = new Map(originalPlayers.map((player) => [player.user_id, player]));
  const persistedEntries = await Promise.all(
    [...playerStatesByUserId.values()].map(async (playerState) => {
      const updatedPlayer = await upsertMatchPlayer({
        matchId,
        userId: playerState.user_id,
        turnOrder: playerState.turn_order,
        health: playerState.health,
        imo: playerState.imo,
        maxImo: playerState.max_imo,
        hasDrawnThisTurn: playerState.has_drawn_this_turn,
        hasUsedCardActionThisTurn: playerState.has_used_card_action_this_turn,
        isDefeated: playerState.is_defeated,
        deckCards: playerState.deck_cards_json,
        handCards: playerState.hand_cards_json,
        exileCards: playerState.exile_cards_json,
      });

      const originalPlayer = originalsByUserId.get(playerState.user_id);
      return [
        playerState.user_id,
        {
          ...updatedPlayer,
          username: originalPlayer?.username || playerState.username,
          email: originalPlayer?.email || playerState.email,
        },
      ];
    })
  );

  return new Map(persistedEntries);
}

async function consumeCardFromHand({ ownerId, handCards, instanceId, notFoundMessage, unresolvedMessage }) {
  const cardIndex = handCards.findIndex((entry) => entry.instanceId === instanceId);
  if (cardIndex < 0) {
    throw new AppError(notFoundMessage, 404);
  }

  const [cardEntry] = handCards.splice(cardIndex, 1);
  const resolvedCard = await resolveMatchCardEntry({
    cardEntry,
    fallbackOwnerId: ownerId,
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
  ownerId,
  card,
  currentCard,
  actingPlayerState,
  playerStatesByUserId,
  targetUserId,
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
    actingPlayerState,
    playerStatesByUserId,
    targetUserId,
  });
  const outcome = createAutomationOutcome();

  for (const effect of automation.effects) {
    if (effect.type === 'gainCatalogCardToHand') {
      const generatedCard = await createGeneratedCardEntry({
        ownerId,
        cardId: effect.cardId,
      });

      actingPlayerState.hand_cards_json = [...actingPlayerState.hand_cards_json, generatedCard];
      outcome.notices.push(`Efeito resolvido: ${generatedCard.cardId} foi gerada na sua mao.`);
      continue;
    }

    if (effect.type === 'moveSelectedExileCardToHand') {
      const excludedInstanceIds = new Set(
        effect.excludeCurrentCard && currentCard?.instanceId ? [currentCard.instanceId] : []
      );
      const selectableCards = actingPlayerState.exile_cards_json.filter(
        (entry) => !excludedInstanceIds.has(entry.instanceId)
      );

      if (!selectableCards.length) {
        outcome.notices.push('Efeito sem alvo valido: nao havia carta exilada disponivel para recuperar.');
        continue;
      }

      if (!selectedExileCardId) {
        throw new AppError('Escolha uma carta do seu exilio para recuperar.', 400);
      }

      const exileIndex = actingPlayerState.exile_cards_json.findIndex(
        (entry) => entry.instanceId === selectedExileCardId && !excludedInstanceIds.has(entry.instanceId)
      );

      if (exileIndex < 0) {
        throw new AppError('A carta selecionada nao esta disponivel no seu exilio.', 400);
      }

      const [recoveredCard] = actingPlayerState.exile_cards_json.splice(exileIndex, 1);
      actingPlayerState.hand_cards_json = [...actingPlayerState.hand_cards_json, recoveredCard];
      outcome.notices.push('Efeito resolvido: uma carta do seu exilio voltou para a sua mao.');
      continue;
    }

    if (effect.type === 'drawTopDeckToHand') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.deck_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: o deck de ${targetState.username} estava vazio.`);
        continue;
      }

      const [drawnCard] = targetState.deck_cards_json.splice(0, 1);
      targetState.hand_cards_json = [...targetState.hand_cards_json, drawnCard];
      outcome.notices.push(`Efeito resolvido: ${targetState.username} comprou uma carta.`);
      continue;
    }

    if (effect.type === 'moveTopDeckToExile') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.deck_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: o deck de ${targetState.username} estava vazio.`);
        continue;
      }

      const [exiledCard] = targetState.deck_cards_json.splice(0, 1);
      targetState.exile_cards_json = [exiledCard, ...targetState.exile_cards_json];
      outcome.notices.push(`Efeito resolvido: o topo do deck de ${targetState.username} foi para o exilio.`);
      continue;
    }

    if (effect.type === 'moveTopExileToDeck') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.exile_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: o exilio de ${targetState.username} estava vazio.`);
        continue;
      }

      const [returnedCard] = targetState.exile_cards_json.splice(0, 1);
      targetState.deck_cards_json = effect.shuffleIntoDeck
        ? shuffleCardEntries([...targetState.deck_cards_json, returnedCard])
        : [returnedCard, ...targetState.deck_cards_json];
      outcome.notices.push(`Efeito resolvido: uma carta do exilio de ${targetState.username} voltou para o deck.`);
      continue;
    }

    if (effect.type === 'revealTopDeck') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.deck_cards_json.length) {
        outcome.notices.push(`O deck de ${targetState.username} estava vazio.`);
        continue;
      }

      const revealedCard = await resolveMatchCardEntry({
        cardEntry: targetState.deck_cards_json[0],
        fallbackOwnerId: targetState.user_id,
      });

      if (!revealedCard) {
        outcome.notices.push(`Voce visualizou o topo do deck de ${targetState.username}.`);
        continue;
      }

      outcome.notices.push(`Voce visualizou o topo do deck de ${targetState.username}.`);
      outcome.effects.push({
        type: 'viewTopDeck',
        actorUserId: actingPlayerState.user_id,
        targetUserId: targetState.user_id,
        targetUsername: targetState.username,
        canReveal: true,
        card: {
          ...revealedCard,
          instanceId: targetState.deck_cards_json[0].instanceId,
        },
      });
      continue;
    }

    if (effect.type === 'moveSelectedOwnHandCardToTargetHand') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!actingPlayerState.hand_cards_json.length) {
        outcome.notices.push('Efeito sem alvo valido: nao havia outra carta na sua mao para passar.');
        continue;
      }

      if (!selectedOwnHandCardId) {
        throw new AppError('Escolha uma carta da sua mao para passar ao alvo.', 400);
      }

      const ownHandIndex = actingPlayerState.hand_cards_json.findIndex(
        (entry) => entry.instanceId === selectedOwnHandCardId
      );
      if (ownHandIndex < 0) {
        throw new AppError('A carta selecionada nao esta disponivel na sua mao.', 400);
      }

      const [passedCard] = actingPlayerState.hand_cards_json.splice(ownHandIndex, 1);
      const reassignedCard = reassignMatchCardEntryOwner({
        cardEntry: passedCard,
        nextOwnerId: targetState.user_id,
      });
      targetState.hand_cards_json = [...targetState.hand_cards_json, reassignedCard];
      const passedResolvedCard = await resolveMatchCardEntry({
        cardEntry: reassignedCard,
        fallbackOwnerId: targetState.user_id,
      });
      outcome.notices.push(
        passedResolvedCard
          ? `Efeito resolvido: ${passedResolvedCard.name} foi passada para a mao de ${targetState.username}.`
          : `Efeito resolvido: uma carta da sua mao foi passada para ${targetState.username}.`
      );
      continue;
    }

    if (effect.type === 'revealRandomHandCard') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.hand_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: a mao de ${targetState.username} estava vazia.`);
        continue;
      }

      const randomIndex = Math.floor(Math.random() * targetState.hand_cards_json.length);
      const revealedHandEntry = targetState.hand_cards_json[randomIndex];
      const revealedHandCard = await resolveMatchCardEntry({
        cardEntry: revealedHandEntry,
        fallbackOwnerId: targetState.user_id,
      });

      outcome.notices.push(`Voce visualizou uma carta aleatoria da mao de ${targetState.username}.`);
      if (!revealedHandCard) {
        continue;
      }

      outcome.effects.push({
        type: 'viewRandomHandCard',
        actorUserId: actingPlayerState.user_id,
        targetUserId: targetState.user_id,
        targetUsername: targetState.username,
        canReveal: false,
        card: {
          ...revealedHandCard,
          instanceId: revealedHandEntry.instanceId,
        },
      });
      continue;
    }

    if (effect.type === 'destroySelectedHandCard') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.hand_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: a mao de ${targetState.username} estava vazia.`);
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
        fallbackOwnerId: targetState.user_id,
      });
      outcome.notices.push(
        destroyedResolvedCard
          ? `Efeito resolvido: ${destroyedResolvedCard.name} foi destruida da mao de ${targetState.username}.`
          : `Efeito resolvido: uma carta da mao de ${targetState.username} foi destruida.`
      );
      continue;
    }

    if (effect.type === 'destroyRandomHandCard') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.hand_cards_json.length) {
        outcome.notices.push(`Efeito sem alvo valido: a mao de ${targetState.username} estava vazia.`);
        continue;
      }

      const randomIndex = Math.floor(Math.random() * targetState.hand_cards_json.length);
      const [destroyedCard] = targetState.hand_cards_json.splice(randomIndex, 1);
      const destroyedResolvedCard = await resolveMatchCardEntry({
        cardEntry: destroyedCard,
        fallbackOwnerId: targetState.user_id,
      });
      outcome.notices.push(
        destroyedResolvedCard
          ? `Efeito resolvido: ${destroyedResolvedCard.name} foi destruida aleatoriamente da mao de ${targetState.username}.`
          : `Efeito resolvido: uma carta aleatoria da mao de ${targetState.username} foi destruida.`
      );
    }
  }

  return outcome;
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

function resolveAutomationTarget({ automation, actingPlayerState, playerStatesByUserId, targetUserId }) {
  if (!automation?.targetScope) {
    return null;
  }

  const normalizedTargetUserId = Number(targetUserId);
  if (!Number.isInteger(normalizedTargetUserId)) {
    throw new AppError('Esta carta exige a selecao de um alvo valido.', 400);
  }

  const targetState = playerStatesByUserId.get(normalizedTargetUserId);
  if (!targetState) {
    throw new AppError('O alvo selecionado nao esta disponivel na partida.', 404);
  }

  if (automation.targetScope === 'other-player' && targetState.user_id === actingPlayerState.user_id) {
    throw new AppError('Esta carta exige outro jogador como alvo.', 400);
  }

  return targetState;
}

function resolveEffectTargetState({ effect, actingPlayerState, selectedTargetState }) {
  if (effect.target === 'self' || !effect.target) {
    return actingPlayerState;
  }

  if (!selectedTargetState) {
    throw new AppError('O efeito da carta exige um alvo selecionado.', 400);
  }

  return selectedTargetState;
}

async function createGeneratedCardEntry({ ownerId, cardId }) {
  const generatedCard = await resolveCardById({ ownerId, cardId });
  if (!generatedCard) {
    throw new AppError(`Carta ${cardId} nao encontrada no catalogo.`, 404);
  }

  return createMatchCardEntry({
    card: generatedCard,
    ownerId,
  });
}

function createCardInstanceId(cardId) {
  return `${cardId}::generated::${Math.random().toString(36).slice(2, 10)}`;
}

function createMatchCardEntry({ card, ownerId, instanceId = null }) {
  const entry = {
    cardId: card.id,
    instanceId: instanceId || createCardInstanceId(card.id),
    ownerId,
  };
  const catalogOwnerId = Number(card?.catalogOwnerId);
  if (Number.isInteger(catalogOwnerId)) {
    entry.catalogOwnerId = catalogOwnerId;
  } else if (card?.isCustom) {
    entry.catalogOwnerId = ownerId;
  }

  return entry;
}

function reassignMatchCardEntryOwner({ cardEntry, nextOwnerId }) {
  return {
    ...cardEntry,
    ownerId: nextOwnerId,
  };
}

function getMatchCardCatalogOwnerId(cardEntry, fallbackOwnerId) {
  const normalizedCatalogOwnerId = Number(cardEntry?.catalogOwnerId);
  if (Number.isInteger(normalizedCatalogOwnerId)) {
    return normalizedCatalogOwnerId;
  }

  const normalizedOwnerId = Number(cardEntry?.ownerId);
  if (Number.isInteger(normalizedOwnerId)) {
    return normalizedOwnerId;
  }

  return fallbackOwnerId;
}

async function resolveMatchCardEntry({ cardEntry, fallbackOwnerId }) {
  if (!cardEntry?.cardId) {
    return null;
  }

  return resolveCardById({
    ownerId: getMatchCardCatalogOwnerId(cardEntry, fallbackOwnerId),
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

async function requireActiveTurnContext({ roomId, userId, includeAllPlayers = false }) {
  const context = await requireActiveMatchContext({ roomId, userId, includeAllPlayers });

  if (context.match.current_turn_player_id !== userId) {
    throw new AppError('Nao e o seu turno.', 409);
  }

  return context;
}

async function requireActiveMatchContext({ roomId, userId, includeAllPlayers = false }) {
  const match = await findActiveMatchByRoomId(roomId);
  if (!match) {
    const room = await findRoomById(roomId);
    if (!room) {
      throw new AppError('Sala nao encontrada.', 404);
    }

    throw new AppError('Nao existe partida ativa para esta sala.', 409);
  }

  const [currentPlayer, matchPlayers] = await Promise.all([
    findMatchPlayer({ matchId: match.id, userId }),
    includeAllPlayers ? listMatchPlayers(match.id) : Promise.resolve(null),
  ]);

  if (!currentPlayer) {
    const belongsToRoom = await isPlayerInRoom({ roomId, userId });
    if (!belongsToRoom) {
      throw new AppError('Voce nao pertence a esta sala.', 403);
    }

    throw new AppError('Jogador nao encontrado na partida.', 404);
  }

  if (currentPlayer.is_defeated) {
    throw new AppError('Jogador derrotado nao pode agir.', 409);
  }

  return {
    match,
    matchPlayers: matchPlayers || [currentPlayer],
    currentPlayer,
  };
}

function buildAvailableActions({ activeMatch, matchPlayer, requesterUserId }) {
  if (!activeMatch || activeMatch.status !== 'active') {
    return [];
  }

  if (matchPlayer.user_id !== requesterUserId) {
    return [];
  }

  if (matchPlayer.is_defeated) {
    return [];
  }

  const combatState = normalizeCombatState(activeMatch.combat_state_json);
  if (combatState) {
    return [];
  }

  if (activeMatch.current_turn_player_id !== requesterUserId) {
    return [];
  }

  const actions = ['endTurn'];

  if (!matchPlayer.has_used_card_action_this_turn) {
    actions.unshift('discardCard');
    actions.unshift('playCard');
  }

  if (!matchPlayer.has_drawn_this_turn && (matchPlayer.hand_cards_json || []).length < MAX_HAND_SIZE) {
    actions.unshift('drawCard');
  }

  return actions;
}

function getNextTurnPlayer(activePlayers, currentUserId) {
  const currentIndex = activePlayers.findIndex((player) => player.user_id === currentUserId);
  if (currentIndex < 0) {
    return activePlayers[0];
  }

  return activePlayers[(currentIndex + 1) % activePlayers.length];
}

function shuffleCards(cards) {
  const entries = [...cards];
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [entries[index], entries[randomIndex]] = [entries[randomIndex], entries[index]];
  }

  return entries.map((card, index) => ({
    ...card,
    instanceId: `${card.id}::${index + 1}::${Math.random().toString(36).slice(2, 8)}`,
    cardId: card.id,
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

async function hydrateCards({ currentOwnerId, cardEntries, cardCatalogCache }) {
  const hydrated = [];

  for (const entry of cardEntries || []) {
    const catalogOwnerId = getMatchCardCatalogOwnerId(entry, currentOwnerId);
    const cardCatalogMap = await getCardCatalogMapForUser(catalogOwnerId, cardCatalogCache);
    const baseCard = cardCatalogMap.get(entry.cardId);
    if (!baseCard) {
      continue;
    }

    hydrated.push({
      ...baseCard,
      instanceId: entry.instanceId,
      ownerId: Number(entry?.ownerId) || currentOwnerId,
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
  startMatchForRoom,
  getMatchSnapshot,
  getMatchSnapshotsForUsers,
  getRealtimeMatchStatesForUsers,
  drawCardForPlayer,
  playCardForPlayer,
  discardCardForPlayer,
  reactToAttackForPlayer,
  resolveAttackForPlayer,
  revealViewedTopDeckCardForPlayer,
  endTurnForPlayer,
  forfeitMatchByLeavingRoom,
};
