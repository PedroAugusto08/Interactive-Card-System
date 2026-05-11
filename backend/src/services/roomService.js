const {
  createRoom,
  updateRoomState,
  findRoomByCode,
  findRoomById,
  findActiveRoomForUser,
  addPlayerToRoom,
  removePlayerFromRoom,
  isPlayerInRoom,
  listRoomPlayers,
  updateRoomPlayerState,
  resetRoomPlayersReady,
} = require('../models/roomModel');
const { findDeckById, listDecksByIds } = require('../models/deckModel');
const { AppError } = require('../utils/AppError');
const { getMatchSnapshot, forfeitMatchByLeavingRoom } = require('./matchService');
const { resolveRoomMasterUserId } = require('./masterOverride');
const {
  buildDefaultTurnOrderDraft,
  buildLobbyParticipantEntries,
  normalizeSelectedDeckIds,
  reconcileTurnOrderDraft,
  validateTurnOrderDraft,
} = require('./participantUtils');

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function createRoomForHost(hostId) {
  await assertUserHasNoConflictingRoom(hostId);

  const code = await generateUniqueRoomCode();
  const room = await createRoom({ code, hostId, status: 'lobby', turnOrderDraft: [] });

  await addPlayerToRoom({ roomId: room.id, userId: hostId });
  return buildRoomPayload(room.id, hostId);
}

async function joinRoomByCode({ code, userId, requesterUser = null }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw new AppError('Codigo da sala e obrigatorio.', 400);
  }

  const room = await findRoomByCode(normalizedCode);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const activeRoom = await findActiveRoomForUser(userId);
  if (activeRoom && activeRoom.id !== room.id) {
    throw new AppError('Voce ja participa de outra sala ativa.', 409);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId: room.id, userId });
  if (!alreadyInRoom) {
    if (room.status !== 'lobby') {
      throw new AppError('A sala ja iniciou uma partida.', 409);
    }

    await addPlayerToRoom({ roomId: room.id, userId });
    await rebuildLobbyConfiguration({ roomId: room.id });
  }

  return buildRoomPayload(room.id, requesterUser || { id: userId });
}

async function leaveRoom({ roomId, userId, requesterUser = null }) {
  let room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Jogador nao esta na sala.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({ room, requesterUser });
  if (activeMasterUserId === userId && ['lobby', 'in_match'].includes(room.status)) {
    throw new AppError('O mestre nao pode sair enquanto a sala estiver ativa.', 409);
  }

  if (room.status === 'in_match') {
    await forfeitMatchByLeavingRoom({ roomId, userId });
    room = await findRoomById(roomId);
  }

  await removePlayerFromRoom({ roomId, userId });

  const remainingPlayers = await listRoomPlayers(roomId);
  if (!remainingPlayers.length) {
    await updateRoomState({
      roomId,
      hostId: room.host_id,
      status: 'finished',
      turnOrderDraft: [],
    });

    return { room: { ...room, status: 'finished', turn_order_draft_json: [] }, players: [], lobbyParticipants: [] };
  }

  await rebuildLobbyConfiguration({
    roomId,
    preserveExistingDraft: true,
    masterUserId: activeMasterUserId,
  });
  return buildRoomPayload(roomId, requesterUser || { id: remainingPlayers[0].user_id });
}

async function getRoomPlayers({ roomId, userId, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Voce nao pertence a esta sala.', 403);
  }

  return buildRoomPayload(roomId, requesterUser || { id: userId });
}

async function getCurrentRoomForUser({ userId, requesterUser = null }) {
  const room = await findActiveRoomForUser(userId);
  if (!room) {
    return {
      room: null,
      players: [],
      lobbyParticipants: [],
      match: null,
    };
  }

  const roomPayload = await buildRoomPayload(room.id, requesterUser || { id: userId });
  if (room.status === 'in_match') {
    const matchSnapshot = await getMatchSnapshot({ roomId: room.id, userId });
    return {
      ...roomPayload,
      match: matchSnapshot,
    };
  }

  return {
    ...roomPayload,
    match: null,
  };
}

async function selectDeckForPlayer({ roomId, userId, deckId, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Nao e possivel trocar deck fora do lobby.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({ room, requesterUser });
  if (activeMasterUserId === userId) {
    throw new AppError('O mestre deve usar a selecao multipla de criaturas.', 409);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Voce nao pertence a esta sala.', 403);
  }

  const deck = await findDeckById(deckId);
  if (!deck || deck.owner_id !== userId) {
    throw new AppError('Deck nao encontrado para o jogador.', 404);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedDeckId: deckId,
    selectedDeckIds: [deckId],
    isReady: false,
  });

  await rebuildLobbyConfiguration({
    roomId,
    preserveExistingDraft: true,
    masterUserId: activeMasterUserId,
  });
  return buildRoomPayload(roomId, requesterUser || { id: userId });
}

async function replaceMasterDeckSelection({ roomId, userId, deckIds, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Nao e possivel trocar criaturas fora do lobby.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({ room, requesterUser });
  if (activeMasterUserId !== userId) {
    throw new AppError('Somente o mestre pode definir as criaturas.', 403);
  }

  const uniqueDeckIds = [...new Set((deckIds || []).map((value) => Number(value)).filter(Number.isInteger))];
  if (!uniqueDeckIds.length) {
    throw new AppError('Selecione ao menos um deck para o mestre.', 400);
  }

  const ownedDecks = await Promise.all(uniqueDeckIds.map((deckId) => findDeckById(deckId)));
  if (ownedDecks.some((deck) => !deck || deck.owner_id !== userId)) {
    throw new AppError('Um ou mais decks selecionados nao pertencem ao mestre.', 404);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedDeckId: uniqueDeckIds[0],
    selectedDeckIds: uniqueDeckIds,
    isReady: false,
  });

  await rebuildLobbyConfiguration({
    roomId,
    preserveExistingDraft: true,
    masterUserId: activeMasterUserId,
  });
  return buildRoomPayload(roomId, requesterUser || { id: userId });
}

async function updateTurnOrderDraftForRoom({ roomId, userId, draftEntryIds, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Nao e possivel editar a ordem fora do lobby.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({ room, requesterUser });
  if (activeMasterUserId !== userId) {
    throw new AppError('Somente o mestre pode definir a ordem da rodada.', 403);
  }

  const roomPayload = await buildRoomPayload(roomId, requesterUser || { id: userId });
  const validation = validateTurnOrderDraft({
    lobbyEntries: roomPayload.lobbyParticipants,
    draftEntryIds,
  });
  if (!validation.ok) {
    throw new AppError(validation.reason, 400);
  }

  await updateRoomState({
    roomId,
    hostId: room.host_id,
    status: room.status,
    turnOrderDraft: draftEntryIds,
  });
  await resetRoomPlayersReady(roomId);

  return buildRoomPayload(roomId, requesterUser || { id: userId });
}

async function setPlayerReadyState({ roomId, userId, isReady, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Nao e possivel alterar prontidao fora do lobby.', 409);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Voce nao pertence a esta sala.', 403);
  }

  const roomPayload = await buildRoomPayload(roomId, requesterUser || { id: userId });
  const player = roomPayload.players.find((item) => item.user_id === userId);
  if (!player) {
    throw new AppError('Jogador nao encontrado na sala.', 404);
  }

  if (player.is_master) {
    if (!player.selected_deck_ids.length) {
      throw new AppError('Selecione ao menos um deck para o mestre antes de marcar pronto.', 409);
    }

    const validation = validateTurnOrderDraft({
      lobbyEntries: roomPayload.lobbyParticipants,
      draftEntryIds: roomPayload.room.turn_order_draft_json || [],
    });
    if (!validation.ok) {
      throw new AppError('Defina a ordem completa da rodada antes de marcar pronto.', 409);
    }
  } else if (!player.selected_deck_id) {
    throw new AppError('Selecione um deck antes de marcar pronto.', 409);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedDeckId: player.selected_deck_id,
    selectedDeckIds: player.selected_deck_ids,
    isReady: Boolean(isReady),
    turnOrder: player.turn_order,
  });

  return buildRoomPayload(roomId, requesterUser || { id: userId });
}

async function rebuildLobbyConfiguration({ roomId, preserveExistingDraft = true, masterUserId = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    return null;
  }

  const players = await listRoomPlayers(roomId);
  const deckMap = await buildSelectedDeckMap(players);
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0
      ? Number(masterUserId)
      : room.host_id;
  const normalizedPlayers = players.map((player) =>
    normalizeRoomPlayer({ player, room, deckMap, masterUserId: resolvedMasterUserId })
  );
  const lobbyParticipants = buildLobbyParticipantEntries({
    room,
    players: normalizedPlayers,
    deckMap,
    masterUserId: resolvedMasterUserId,
  });
  const nextTurnOrderDraft = preserveExistingDraft
    ? reconcileTurnOrderDraft({
        draftEntryIds: room.turn_order_draft_json || [],
        lobbyEntries: lobbyParticipants,
      })
    : buildDefaultTurnOrderDraft({ room, players: normalizedPlayers, deckMap, masterUserId: resolvedMasterUserId });

  await updateRoomState({
    roomId,
    hostId: room.host_id,
    status: room.status,
    turnOrderDraft: nextTurnOrderDraft,
  });
  await resetRoomPlayersReady(roomId);

  return {
    room: {
      ...room,
      turn_order_draft_json: nextTurnOrderDraft,
    },
    players: normalizedPlayers,
    lobbyParticipants,
  };
}

async function buildRoomPayload(roomId, requesterUser = null) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const players = await listRoomPlayers(roomId);
  const deckMap = await buildSelectedDeckMap(players);
  const masterUserId = resolveRoomMasterUserId({ room, requesterUser });
  const normalizedPlayers = players.map((player) =>
    normalizeRoomPlayer({ player, room, deckMap, masterUserId })
  );
  const lobbyParticipants = buildLobbyParticipantEntries({
    room,
    players: normalizedPlayers,
    deckMap,
    masterUserId,
  });

  return {
    room: {
      ...room,
      master_user_id: masterUserId,
      turn_order_draft_json: reconcileTurnOrderDraft({
        draftEntryIds: room.turn_order_draft_json || [],
        lobbyEntries: lobbyParticipants,
      }),
    },
    players: normalizedPlayers,
    lobbyParticipants,
  };
}

function normalizeRoomPlayer({ player, room, deckMap, masterUserId = null }) {
  const selectedDeckIds = normalizeSelectedDeckIds(player);
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0 ? Number(masterUserId) : room.host_id;
  const selectedDecks = selectedDeckIds.map((deckId) => {
    const deck = deckMap.get(deckId);
    return deck
      ? {
          id: deck.id,
          name: deck.name,
          owner_id: deck.owner_id,
        }
      : {
          id: deckId,
          name: `Deck ${deckId}`,
          owner_id: player.user_id,
        };
  });

  return {
    ...player,
    role: player.user_id === resolvedMasterUserId ? 'master' : 'player',
    is_master: player.user_id === resolvedMasterUserId,
    selected_deck_ids: selectedDeckIds,
    selected_decks: selectedDecks,
  };
}

async function buildSelectedDeckMap(players) {
  const allSelectedDeckIds = players.flatMap((player) => normalizeSelectedDeckIds(player));
  const selectedDecks = await listDecksByIds(allSelectedDeckIds);
  return new Map(selectedDecks.map((deck) => [deck.id, deck]));
}

async function assertUserHasNoConflictingRoom(userId) {
  const activeRoom = await findActiveRoomForUser(userId);
  if (activeRoom) {
    throw new AppError('Voce ja participa de outra sala ativa.', 409);
  }
}

async function generateUniqueRoomCode(maxAttempts = 25) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateRoomCode();
    const existingRoom = await findRoomByCode(code);
    if (!existingRoom) {
      return code;
    }
  }

  throw new AppError('Nao foi possivel gerar codigo unico para sala.', 500);
}

function generateRoomCode() {
  let code = '';

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[randomIndex];
  }

  return code;
}

module.exports = {
  createRoomForHost,
  getCurrentRoomForUser,
  getRoomPlayers,
  joinRoomByCode,
  leaveRoom,
  replaceMasterDeckSelection,
  selectDeckForPlayer,
  setPlayerReadyState,
  updateTurnOrderDraftForRoom,
};
