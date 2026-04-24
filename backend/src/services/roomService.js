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
} = require('../models/roomModel');
const { findDeckById } = require('../models/deckModel');
const { AppError } = require('../utils/AppError');
const { getMatchSnapshot, forfeitMatchByLeavingRoom } = require('./matchService');

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function createRoomForHost(hostId) {
  await assertUserHasNoConflictingRoom(hostId);

  const code = await generateUniqueRoomCode();
  const room = await createRoom({ code, hostId, status: 'lobby' });

  await addPlayerToRoom({ roomId: room.id, userId: hostId });
  const players = await listRoomPlayers(room.id);

  return { room, players };
}

async function joinRoomByCode({ code, userId }) {
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
  }

  const players = await listRoomPlayers(room.id);
  return { room, players };
}

async function leaveRoom({ roomId, userId }) {
  let room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Jogador nao esta na sala.', 409);
  }

  if (room.status === 'in_match') {
    await forfeitMatchByLeavingRoom({ roomId, userId });
    room = await findRoomById(roomId);
  }

  await removePlayerFromRoom({ roomId, userId });
  const players = await listRoomPlayers(roomId);

  const nextHostId = players[0]?.user_id || room.host_id;
  const nextStatus = players.length <= 1 && room.status !== 'lobby' ? 'finished' : players.length ? room.status : 'finished';

  const updatedRoom = await updateRoomState({
    roomId,
    hostId: nextHostId,
    status: nextStatus,
  });

  return { room: updatedRoom, players };
}

async function getRoomPlayers({ roomId, userId }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Voce nao pertence a esta sala.', 403);
  }

  const players = await listRoomPlayers(roomId);
  return { room, players };
}

async function getCurrentRoomForUser(userId) {
  const room = await findActiveRoomForUser(userId);
  if (!room) {
    return { room: null, players: [], match: null };
  }

  const players = await listRoomPlayers(room.id);
  if (room.status === 'in_match') {
    const matchSnapshot = await getMatchSnapshot({ roomId: room.id, userId });
    return {
      room,
      players,
      match: matchSnapshot,
    };
  }

  return {
    room,
    players,
    match: null,
  };
}

async function selectDeckForPlayer({ roomId, userId, deckId }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('Nao e possivel trocar deck fora do lobby.', 409);
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
    isReady: false,
  });

  const players = await listRoomPlayers(roomId);
  return { room, players };
}

async function setPlayerReadyState({ roomId, userId, isReady }) {
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

  const players = await listRoomPlayers(roomId);
  const player = players.find((item) => item.user_id === userId);
  if (!player?.selected_deck_id) {
    throw new AppError('Selecione um deck antes de marcar pronto.', 409);
  }

  await updateRoomPlayerState({
    roomId,
    userId,
    selectedDeckId: player.selected_deck_id,
    isReady: Boolean(isReady),
    turnOrder: player.turn_order,
  });

  const updatedPlayers = await listRoomPlayers(roomId);
  return { room, players: updatedPlayers };
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
  joinRoomByCode,
  leaveRoom,
  getRoomPlayers,
  getCurrentRoomForUser,
  selectDeckForPlayer,
  setPlayerReadyState,
};
