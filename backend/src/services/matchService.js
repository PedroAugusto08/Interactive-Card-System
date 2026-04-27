const { findRoomById, listRoomPlayers, updateRoomState, assignRoomPlayerTurnOrders, isPlayerInRoom } = require('../models/roomModel');
const {
  createMatch,
  findActiveMatchByRoomId,
  updateMatchState,
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
const INITIAL_HAND_SIZE = 5;

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

    const shuffledDeck = shuffleCards(expandedCards);
    const handCards = shuffledDeck.splice(0, INITIAL_HAND_SIZE);

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
    matchPlayers.map(async (player) => {
      const isRequester = player.user_id === userId;
      let handCards = [];
      let exileCards = [];

      if (isRequester) {
        const cardCatalogMap = await getCardCatalogMapForUser(player.user_id, cardCatalogCache);
        [handCards, exileCards] = [
          hydrateCards(cardCatalogMap, player.hand_cards_json || []),
          hydrateCards(cardCatalogMap, player.exile_cards_json || []),
        ];
      }

      return {
        userId: player.user_id,
        username: player.username,
        email: player.email,
        turnOrder: player.turn_order,
        health: player.health,
        imo: player.imo,
        maxImo: player.max_imo,
        hasDrawnThisTurn: player.has_drawn_this_turn,
        hasUsedCardActionThisTurn: player.has_used_card_action_this_turn,
        isDefeated: player.is_defeated,
        zones: {
          deckCount: (player.deck_cards_json || []).length,
          handCount: isRequester ? handCards.length : (player.hand_cards_json || []).length,
          exileCount: isRequester ? exileCards.length : (player.exile_cards_json || []).length,
        },
        handCards: isRequester ? handCards : [],
        exileCards: isRequester ? exileCards : [],
        availableActions: buildAvailableActions({
          activeMatch,
          matchPlayer: player,
          requesterUserId: userId,
        }),
      };
    })
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
  const matchPlayer = matchPlayers.find((player) => player.user_id === userId) || null;
  const currentUserState = matchPlayer
    ? await buildPlayerState({
        activeMatch,
        matchPlayer,
        requesterUserId: userId,
        cardCatalogCache,
      })
    : null;

  return {
    match: {
      id: activeMatch.id,
      status: activeMatch.status,
      round: activeMatch.round,
      currentTurnPlayerId: activeMatch.current_turn_player_id,
      winnerUserId: activeMatch.winner_user_id,
      startedAt: activeMatch.started_at,
      endedAt: activeMatch.ended_at,
    },
    currentTurnPlayerId: activeMatch.current_turn_player_id,
    round: activeMatch.round,
    currentUserState,
  };
}

async function buildPlayerState({ activeMatch, matchPlayer, requesterUserId, cardCatalogCache }) {
  const isRequester = matchPlayer.user_id === requesterUserId;
  let handCards = [];
  let exileCards = [];

  if (isRequester) {
    const cardCatalogMap = await getCardCatalogMapForUser(matchPlayer.user_id, cardCatalogCache);
    [handCards, exileCards] = [
      hydrateCards(cardCatalogMap, matchPlayer.hand_cards_json || []),
      hydrateCards(cardCatalogMap, matchPlayer.exile_cards_json || []),
    ];
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
    handCards: isRequester ? handCards : [],
    exileCards: isRequester ? exileCards : [],
    availableActions: buildAvailableActions({
      activeMatch,
      matchPlayer,
      requesterUserId,
    }),
  };
}

async function buildActionRealtimeState({ activeMatch, currentUserId, currentPlayer, log, notice = '' }) {
  const currentUserState = await buildPlayerState({
    activeMatch,
    matchPlayer: currentPlayer,
    requesterUserId: currentUserId,
    cardCatalogCache: new Map(),
  });

  return {
    snapshot: {
      match: {
        id: activeMatch.id,
        status: activeMatch.status,
        round: activeMatch.round,
        currentTurnPlayerId: activeMatch.current_turn_player_id,
        winnerUserId: activeMatch.winner_user_id,
        startedAt: activeMatch.started_at,
        endedAt: activeMatch.ended_at,
      },
      currentTurnPlayerId: activeMatch.current_turn_player_id,
      round: activeMatch.round,
      currentUserState,
    },
    notice,
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

  if (playerState.has_drawn_this_turn) {
    throw new AppError('Voce ja comprou uma carta neste turno.', 409);
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
  pairedCardId = null,
  pairedTargetUserId = null,
  pairedSelectedExileCardId = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({ roomId, userId, includeAllPlayers: true });
  const originalPlayerState = context.currentPlayer;

  if (originalPlayerState.has_used_card_action_this_turn) {
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

  let pairedPlay = null;
  if (pairedCardId) {
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
  actingPlayerState.has_used_card_action_this_turn = true;
  actingPlayerState.hand_cards_json = handCards;
  actingPlayerState.deck_cards_json = [...actingPlayerState.deck_cards_json, primaryPlay.cardEntry];

  const notices = [];
  notices.push(
    await applyCardAutomation({
      phase: 'play',
      ownerId: userId,
      card: primaryPlay.resolvedCard,
      currentCard: primaryPlay.cardEntry,
      actingPlayerState,
      playerStatesByUserId,
      targetUserId,
      selectedExileCardId,
    })
  );

  if (pairedPlay) {
    actingPlayerState.deck_cards_json = [...actingPlayerState.deck_cards_json, pairedPlay.cardEntry];
    notices.push(
      await applyCardAutomation({
        phase: 'play',
        ownerId: userId,
        card: pairedPlay.resolvedCard,
        currentCard: pairedPlay.cardEntry,
        actingPlayerState,
        playerStatesByUserId,
        targetUserId: pairedTargetUserId,
        selectedExileCardId: pairedSelectedExileCardId,
      })
    );
  }

  const notice = notices.filter(Boolean).join(' ');
  const updatedPlayerStatesByUserId = await persistMatchPlayerStates({
    matchId: context.match.id,
    playerStatesByUserId,
    originalPlayers: context.matchPlayers,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_PLAY_CARD',
    message: pairedPlay
      ? `${originalPlayerState.username} jogou ${primaryPlay.resolvedCard.name} junto com ${pairedPlay.resolvedCard.name}.`
      : `${originalPlayerState.username} jogou ${primaryPlay.resolvedCard.name}.`,
    payload: {
      userId,
      cardId: primaryPlay.cardEntry.cardId,
      imoCost: totalImoCost,
      targetUserId: targetUserId || null,
      pairedCardId: pairedPlay?.cardEntry.cardId || null,
      pairedTargetUserId: pairedTargetUserId || null,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: context.match,
      currentUserId: userId,
      currentPlayer: updatedPlayerStatesByUserId.get(userId),
      log: createdLog,
      notice,
    }),
  });
}

async function discardCardForPlayer({
  roomId,
  userId,
  cardId,
  targetUserId = null,
  selectedExileCardId = null,
  includeSnapshot = true,
}) {
  const context = await requireActiveTurnContext({ roomId, userId, includeAllPlayers: true });
  const originalPlayerState = context.currentPlayer;

  if (originalPlayerState.has_used_card_action_this_turn) {
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
  const resolvedCard = await resolveCardById({ ownerId: userId, cardId: discardedCard.cardId });
  if (!resolvedCard) {
    throw new AppError('Carta descartada nao encontrada no catalogo.', 404);
  }

  if (resolvedCard.canDiscard === false) {
    throw new AppError(`A carta ${resolvedCard.name} nao pode ser descartada.`, 409);
  }

  actingPlayerState.has_used_card_action_this_turn = true;
  actingPlayerState.hand_cards_json = handCards;
  actingPlayerState.exile_cards_json = [discardedCard, ...actingPlayerState.exile_cards_json];

  const notice = await applyCardAutomation({
    phase: 'discard',
    ownerId: userId,
    card: resolvedCard,
    currentCard: discardedCard,
    actingPlayerState,
    playerStatesByUserId,
    targetUserId,
    selectedExileCardId,
  });

  const updatedPlayerStatesByUserId = await persistMatchPlayerStates({
    matchId: context.match.id,
    playerStatesByUserId,
    originalPlayers: context.matchPlayers,
  });

  const createdLog = await addMatchLog({
    matchId: context.match.id,
    type: 'MATCH_DISCARD_CARD',
    message: `${originalPlayerState.username} descartou ${resolvedCard.name}.`,
    payload: {
      userId,
      cardId: discardedCard.cardId,
      targetUserId: targetUserId || null,
    },
  });

  return finalizeActionResponse({
    roomId,
    userId,
    includeSnapshot,
    actionState: await buildActionRealtimeState({
      activeMatch: context.match,
      currentUserId: userId,
      currentPlayer: updatedPlayerStatesByUserId.get(userId),
      log: createdLog,
      notice,
    }),
  });
}

async function endTurnForPlayer({ roomId, userId, includeSnapshot = true }) {
  const context = await requireActiveTurnContext({ roomId, userId, includeAllPlayers: true });
  const currentPlayer = context.currentPlayer;
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
  const resolvedCard = await resolveCardById({ ownerId, cardId: cardEntry.cardId });
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
}) {
  const automation = phase === 'play' ? card.playAutomation : card.discardAutomation;
  if (!automation?.effects?.length) {
    return '';
  }

  const selectedTargetState = resolveAutomationTarget({
    automation,
    actingPlayerState,
    playerStatesByUserId,
    targetUserId,
  });
  const notices = [];

  for (const effect of automation.effects) {
    if (effect.type === 'gainCatalogCardToHand') {
      const generatedCard = await createGeneratedCardEntry({
        ownerId,
        cardId: effect.cardId,
      });

      actingPlayerState.hand_cards_json = [...actingPlayerState.hand_cards_json, generatedCard];
      notices.push(`Efeito resolvido: ${generatedCard.cardId} foi gerada na sua mao.`);
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
        notices.push('Efeito sem alvo valido: nao havia carta exilada disponivel para recuperar.');
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
      notices.push('Efeito resolvido: uma carta do seu exilio voltou para a sua mao.');
      continue;
    }

    if (effect.type === 'drawTopDeckToHand') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.deck_cards_json.length) {
        notices.push(`Efeito sem alvo valido: o deck de ${targetState.username} estava vazio.`);
        continue;
      }

      const [drawnCard] = targetState.deck_cards_json.splice(0, 1);
      targetState.hand_cards_json = [...targetState.hand_cards_json, drawnCard];
      notices.push(`Efeito resolvido: ${targetState.username} comprou uma carta.`);
      continue;
    }

    if (effect.type === 'moveTopDeckToExile') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.deck_cards_json.length) {
        notices.push(`Efeito sem alvo valido: o deck de ${targetState.username} estava vazio.`);
        continue;
      }

      const [exiledCard] = targetState.deck_cards_json.splice(0, 1);
      targetState.exile_cards_json = [exiledCard, ...targetState.exile_cards_json];
      notices.push(`Efeito resolvido: o topo do deck de ${targetState.username} foi para o exilio.`);
      continue;
    }

    if (effect.type === 'moveTopExileToDeck') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.exile_cards_json.length) {
        notices.push(`Efeito sem alvo valido: o exilio de ${targetState.username} estava vazio.`);
        continue;
      }

      const [returnedCard] = targetState.exile_cards_json.splice(0, 1);
      targetState.deck_cards_json = effect.shuffleIntoDeck
        ? shuffleCardEntries([...targetState.deck_cards_json, returnedCard])
        : [returnedCard, ...targetState.deck_cards_json];
      notices.push(`Efeito resolvido: uma carta do exilio de ${targetState.username} voltou para o deck.`);
      continue;
    }

    if (effect.type === 'revealTopDeck') {
      const targetState = resolveEffectTargetState({
        effect,
        actingPlayerState,
        selectedTargetState,
      });

      if (!targetState.deck_cards_json.length) {
        notices.push(`O deck de ${targetState.username} estava vazio.`);
        continue;
      }

      const revealedCard = await resolveCardById({
        ownerId: targetState.user_id,
        cardId: targetState.deck_cards_json[0].cardId,
      });

      notices.push(
        revealedCard
          ? `Topo do deck de ${targetState.username}: ${revealedCard.name}.`
          : `Topo do deck de ${targetState.username}: carta desconhecida.`
      );
    }
  }

  return notices.filter(Boolean).join(' ');
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

  return {
    cardId: generatedCard.id,
    instanceId: createCardInstanceId(generatedCard.id),
  };
}

function createCardInstanceId(cardId) {
  return `${cardId}::generated::${Math.random().toString(36).slice(2, 10)}`;
}

function shuffleCardEntries(cards) {
  const entries = [...cards];
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [entries[index], entries[randomIndex]] = [entries[randomIndex], entries[index]];
  }

  return entries;
}

async function requireActiveTurnContext({ roomId, userId, includeAllPlayers = false }) {
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

  if (match.current_turn_player_id !== userId) {
    throw new AppError('Nao e o seu turno.', 409);
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

  if (activeMatch.current_turn_player_id !== requesterUserId || matchPlayer.is_defeated) {
    return [];
  }

  const actions = ['endTurn'];

  if (!matchPlayer.has_used_card_action_this_turn) {
    actions.unshift('discardCard');
    actions.unshift('playCard');
  }

  if (!matchPlayer.has_drawn_this_turn) {
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

function hydrateCards(cardCatalogMap, cardEntries) {
  const hydrated = [];

  for (const entry of cardEntries || []) {
    const baseCard = cardCatalogMap.get(entry.cardId);
    if (!baseCard) {
      continue;
    }

    hydrated.push({
      ...baseCard,
      instanceId: entry.instanceId,
    });
  }

  return hydrated;
}

async function finalizeActionResponse({ roomId, userId, includeSnapshot, actionState = null }) {
  if (!includeSnapshot) {
    return actionState;
  }

  const snapshot = await getMatchSnapshot({ roomId, userId });
  if (!actionState?.notice) {
    return snapshot;
  }

  return {
    ...snapshot,
    actionNotice: actionState.notice,
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
  endTurnForPlayer,
  forfeitMatchByLeavingRoom,
};
