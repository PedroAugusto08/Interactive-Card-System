const {
  createRoom,
  findRoomByCode,
  findRoomById,
  addPlayerToRoom,
  removePlayerFromRoom,
  isPlayerInRoom,
  listRoomPlayers,
} = require('../models/roomModel');
const { AppError } = require('../utils/AppError');

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Cria uma sala e coloca o host nela.
async function createRoomForHost(hostId) {
  const code = await generateUniqueRoomCode();
  const room = await createRoom({ code, hostId, status: 'lobby' });

  await addPlayerToRoom({ roomId: room.id, userId: hostId });
  const players = await listRoomPlayers(room.id);

  return { room, players };
}

// Entra em sala usando codigo compartilhado.
async function joinRoomByCode({ code, userId }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw new AppError('Codigo da sala e obrigatorio.', 400);
  }

  const room = await findRoomByCode(normalizedCode);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  if (room.status !== 'lobby') {
    throw new AppError('A sala nao esta mais em lobby.', 409);
  }

  await addPlayerToRoom({ roomId: room.id, userId });
  const players = await listRoomPlayers(room.id);

  return { room, players };
}

// Sai da sala e devolve o novo estado de jogadores.
async function leaveRoom({ roomId, userId }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Jogador nao esta na sala.', 409);
  }

  await removePlayerFromRoom({ roomId, userId });
  const players = await listRoomPlayers(roomId);

  return { room, players };
}

// Busca estado atual da sala + jogadores.
async function getRoomPlayers({ roomId, userId }) {
  const room = await findRoomById(roomId);
  if (!room) {
    throw new AppError('Sala nao encontrada.', 404);
  }

  // Apenas jogadores da sala podem consultar seus participantes.
  const alreadyInRoom = await isPlayerInRoom({ roomId, userId });
  if (!alreadyInRoom) {
    throw new AppError('Voce nao pertence a esta sala.', 403);
  }

  const players = await listRoomPlayers(roomId);
  return { room, players };
}

// Tenta gerar codigo sem colisao no banco.
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

// Gera um codigo aleatorio legivel para humanos.
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
};
