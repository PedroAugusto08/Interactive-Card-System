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
const { findCharacterById, listCharactersByIds } = require('../models/characterModel');
const { AppError } = require('../utils/AppError');
const { getMatchSnapshot, forfeitMatchByLeavingRoom } = require('./matchService');
const { canUserActAsMaster, resolveRoomMasterUserId } = require('./masterOverride');
const {
  buildDefaultTurnOrderDraft,
  buildLobbyParticipantEntries,
  normalizeSelectedCharacterIds,
  reconcileTurnOrderDraft,
  validateTurnOrderDraft,
} = require('./participantUtils');

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function createRoomForHost({ hostId, requesterUser = null }) {
  await assertUserHasNoConflictingRoom(hostId);
  if (!canUserActAsMaster(requesterUser || { id: hostId })) {
    throw new AppError('Somente o mestre fixo pode criar salas.', 403);
  }

  const code = await generateUniqueRoomCode();
  const room = await createRoom({ code, hostId, status: 'lobby', turnOrderDraft: [] });

  await addPlayerToRoom({ roomId: room.id, userId: hostId });
  return buildRoomPayload(room.id, requesterUser || { id: hostId });
}

async function joinRoomByCode({ code, userId, requesterUser = null }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw new AppError('Código da sala é obrigatório.', 400);
  }

  const room = await findRoomByCode(normalizedCode);
  if (!room) {
    throw new AppError('Sala não encontrada.', 404);
  }

  const activeRoom = await findActiveRoomForUser(userId);
  if (activeRoom && activeRoom.id !== room.id) {
    throw new AppError('Você já participa de outra sala ativa.', 409);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId: room.id, userId });
  if (!alreadyInRoom) {
    if (room.status !== 'lobby') {
      throw new AppError('A sala já iniciou uma partida.', 409);
    }

    await addPlayerToRoom({ roomId: room.id, userId });
    await rebuildLobbyConfiguration({ roomId: room.id, masterUserId: resolveRoomMasterUserId({ room, requesterUser }) });
  }

  return buildRoomPayload(room.id, requesterUser || { id: userId });
}

async function leaveRoom({ roomId, userId, requesterUser = null }) {
  let room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala não encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Jogador não está na sala.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({
    room,
    requesterUser,
    players: await listRoomPlayers(roomId),
  });
  const isMasterLeavingActiveRoom = activeMasterUserId === userId && ['lobby', 'in_match'].includes(room.status);

  if (room.status === 'in_match') {
    await forfeitMatchByLeavingRoom({
      roomId,
      userId,
      closeRoom: isMasterLeavingActiveRoom,
    });
    room = await findRoomById(roomId);
  }

  await removePlayerFromRoom({ roomId, userId });

  if (isMasterLeavingActiveRoom) {
    await updateRoomState({
      roomId,
      hostId: room.host_id,
      status: 'finished',
      turnOrderDraft: [],
    });

    return {
      room: null,
      players: [],
      lobbyParticipants: [],
    };
  }

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
    throw new AppError('Sala não encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Você não pertence a esta sala.', 403);
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

async function selectCharacterForPlayer({ roomId, userId, characterId, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala não encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Não é possível trocar personagem fora do lobby.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({
    room,
    requesterUser,
    players: await listRoomPlayers(roomId),
  });
  if (activeMasterUserId === userId) {
    throw new AppError('O mestre deve usar a seleção múltipla de criaturas.', 409);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Você não pertence a esta sala.', 403);
  }

  const character = await findCharacterById(characterId);
  if (!character || character.owner_id !== userId) {
    throw new AppError('Personagem não encontrado para o jogador.', 404);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedCharacterId: characterId,
    selectedCharacterIds: [characterId],
    isReady: false,
  });

  await rebuildLobbyConfiguration({
    roomId,
    preserveExistingDraft: true,
    masterUserId: activeMasterUserId,
  });
  return buildRoomPayload(roomId, requesterUser || { id: userId });
}

async function replaceMasterCharacterSelection({ roomId, userId, characterIds, requesterUser = null }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala não encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Não é possível trocar criaturas fora do lobby.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({
    room,
    requesterUser,
    players: await listRoomPlayers(roomId),
  });
  if (activeMasterUserId !== userId) {
    throw new AppError('Somente o mestre pode definir as criaturas.', 403);
  }

  const uniqueCharacterIds = [...new Set((characterIds || []).map((value) => Number(value)).filter(Number.isInteger))];
  if (!uniqueCharacterIds.length) {
    throw new AppError('Selecione ao menos um personagem para o mestre.', 400);
  }

  const ownedCharacters = await Promise.all(uniqueCharacterIds.map((value) => findCharacterById(value)));
  if (ownedCharacters.some((character) => !character || character.owner_id !== userId)) {
    throw new AppError('Um ou mais personagens selecionados não pertencem ao mestre.', 404);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedCharacterId: uniqueCharacterIds[0],
    selectedCharacterIds: uniqueCharacterIds,
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
    throw new AppError('Sala não encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Não é possível editar a ordem fora do lobby.', 409);
  }

  const activeMasterUserId = resolveRoomMasterUserId({
    room,
    requesterUser,
    players: await listRoomPlayers(roomId),
  });
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
    throw new AppError('Sala não encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Não é possível alterar prontidão fora do lobby.', 409);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Você não pertence a esta sala.', 403);
  }

  const roomPayload = await buildRoomPayload(roomId, requesterUser || { id: userId });
  const player = roomPayload.players.find((item) => item.user_id === userId);
  if (!player) {
    throw new AppError('Jogador não encontrado na sala.', 404);
  }

  if (player.is_master) {
    if (!player.selected_character_ids.length) {
      throw new AppError('Selecione ao menos um personagem para o mestre antes de marcar pronto.', 409);
    }

    const validation = validateTurnOrderDraft({
      lobbyEntries: roomPayload.lobbyParticipants,
      draftEntryIds: roomPayload.room.turn_order_draft_json || [],
    });
    if (!validation.ok) {
      throw new AppError('Defina a ordem completa da rodada antes de marcar pronto.', 409);
    }
  } else if (!player.selected_character_id) {
    throw new AppError('Selecione um personagem antes de marcar pronto.', 409);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedCharacterId: player.selected_character_id,
    selectedCharacterIds: player.selected_character_ids,
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
  const characterMap = await buildSelectedCharacterMap(players);
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0
      ? Number(masterUserId)
      : resolveRoomMasterUserId({ room, players });
  const normalizedPlayers = players.map((player) =>
    normalizeRoomPlayer({ player, characterMap, masterUserId: resolvedMasterUserId })
  );
  const lobbyParticipants = buildLobbyParticipantEntries({
    players: normalizedPlayers,
    characterMap,
    masterUserId: resolvedMasterUserId,
  });
  const nextTurnOrderDraft = preserveExistingDraft
    ? reconcileTurnOrderDraft({
        draftEntryIds: room.turn_order_draft_json || [],
        lobbyEntries: lobbyParticipants,
      })
    : buildDefaultTurnOrderDraft({ players: normalizedPlayers, characterMap, masterUserId: resolvedMasterUserId });

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
    throw new AppError('Sala não encontrada.', 404);
  }

  const players = await listRoomPlayers(roomId);
  const characterMap = await buildSelectedCharacterMap(players);
  const masterUserId = resolveRoomMasterUserId({ room, requesterUser, players });
  const normalizedPlayers = players.map((player) =>
    normalizeRoomPlayer({ player, characterMap, masterUserId })
  );
  const lobbyParticipants = buildLobbyParticipantEntries({
    players: normalizedPlayers,
    characterMap,
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

function normalizeRoomPlayer({ player, characterMap, masterUserId = null }) {
  const selectedCharacterIds = normalizeSelectedCharacterIds(player);
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0 ? Number(masterUserId) : null;
  const selectedCharacters = selectedCharacterIds.map((characterId) => {
    const character = characterMap.get(characterId);
    return character
      ? {
          id: character.id,
          name: character.name,
          owner_id: character.owner_id,
        }
      : {
          id: characterId,
          name: `Personagem ${characterId}`,
          owner_id: player.user_id,
        };
  });

  return {
    ...player,
    role: player.user_id === resolvedMasterUserId ? 'master' : 'player',
    is_master: player.user_id === resolvedMasterUserId,
    selected_character_id: selectedCharacterIds[0] || null,
    selected_character_ids: selectedCharacterIds,
    selected_characters: selectedCharacters,
  };
}

async function buildSelectedCharacterMap(players) {
  const allSelectedCharacterIds = players.flatMap((player) => normalizeSelectedCharacterIds(player));
  const selectedCharacters = await listCharactersByIds(allSelectedCharacterIds);
  return new Map(selectedCharacters.map((character) => [character.id, character]));
}

async function assertUserHasNoConflictingRoom(userId) {
  const activeRoom = await findActiveRoomForUser(userId);
  if (activeRoom) {
    throw new AppError('Você já participa de outra sala ativa.', 409);
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

  throw new AppError('Não foi possível gerar código único para sala.', 500);
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
  replaceMasterCharacterSelection,
  selectCharacterForPlayer,
  setPlayerReadyState,
  updateTurnOrderDraftForRoom,
};
