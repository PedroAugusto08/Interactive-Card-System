function createPlayerEntryId(userId) {
  return `player:${Number(userId)}`;
}

function createMasterCharacterEntryId(characterId) {
  return `master-character:${Number(characterId)}`;
}

function normalizeSelectedCharacterIds(player) {
  if (Array.isArray(player?.selected_character_ids)) {
    return player.selected_character_ids
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  if (Array.isArray(player?.selected_character_ids_json)) {
    return player.selected_character_ids_json
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  const fallbackCharacterId = Number(player?.selected_character_id);
  return Number.isInteger(fallbackCharacterId) && fallbackCharacterId > 0 ? [fallbackCharacterId] : [];
}

function buildLobbyParticipantEntries({ players = [], characterMap = new Map(), masterUserId = null }) {
  const resolvedMasterUserId =
    Number.isInteger(Number(masterUserId)) && Number(masterUserId) > 0 ? Number(masterUserId) : null;
  const entries = [];

  for (const player of players) {
    const playerUserId = Number(player.user_id);
    const selectedCharacterIds = normalizeSelectedCharacterIds(player);

    if (playerUserId === resolvedMasterUserId) {
      for (const characterId of selectedCharacterIds) {
        const selectedCharacter = characterMap.get(characterId);
        entries.push({
          entryId: createMasterCharacterEntryId(characterId),
          participantType: 'master-creature',
          controllerUserId: playerUserId,
          roomPlayerUserId: playerUserId,
          sourceCharacterId: characterId,
          displayName: selectedCharacter?.name || `Criatura ${characterId}`,
          username: player.username,
        });
      }
      continue;
    }

    if (!selectedCharacterIds.length) {
      continue;
    }

    const selectedCharacter = characterMap.get(selectedCharacterIds[0]);
    entries.push({
      entryId: createPlayerEntryId(playerUserId),
      participantType: 'player',
      controllerUserId: playerUserId,
      roomPlayerUserId: playerUserId,
      sourceCharacterId: selectedCharacterIds[0],
      displayName: player.username,
      username: player.username,
      selectedCharacterName: selectedCharacter?.name || '',
    });
  }

  return entries;
}

function buildDefaultTurnOrderDraft({ players = [], characterMap = new Map(), masterUserId = null }) {
  return buildLobbyParticipantEntries({ players, characterMap, masterUserId }).map((entry) => entry.entryId);
}

function validateTurnOrderDraft({ lobbyEntries = [], draftEntryIds = [] }) {
  const validIds = lobbyEntries.map((entry) => entry.entryId);
  if (!validIds.length) {
    return {
      ok: false,
      reason: 'Nenhum participante disponível para ordenar.',
    };
  }

  if (!Array.isArray(draftEntryIds) || draftEntryIds.length !== validIds.length) {
    return {
      ok: false,
      reason: 'A ordem de turno precisa conter todos os participantes exatamente uma vez.',
    };
  }

  const validIdSet = new Set(validIds);
  const seen = new Set();

  for (const entryId of draftEntryIds) {
    if (!validIdSet.has(entryId) || seen.has(entryId)) {
      return {
        ok: false,
        reason: 'A ordem de turno contém itens inválidos ou duplicados.',
      };
    }
    seen.add(entryId);
  }

  return { ok: true };
}

function reconcileTurnOrderDraft({ draftEntryIds = [], lobbyEntries = [] }) {
  const nextIds = [];
  const validIds = new Set(lobbyEntries.map((entry) => entry.entryId));

  for (const entryId of draftEntryIds || []) {
    if (validIds.has(entryId) && !nextIds.includes(entryId)) {
      nextIds.push(entryId);
    }
  }

  for (const entry of lobbyEntries) {
    if (!nextIds.includes(entry.entryId)) {
      nextIds.push(entry.entryId);
    }
  }

  return nextIds;
}

function getNextActiveParticipant(activeParticipants, currentParticipantId) {
  const currentIndex = activeParticipants.findIndex((participant) => participant.id === currentParticipantId);
  if (currentIndex < 0) {
    return activeParticipants[0] || null;
  }

  return activeParticipants[(currentIndex + 1) % activeParticipants.length] || null;
}

function buildViewerMetadata({
  requesterUserId,
  participantStates = [],
  currentTurnParticipantId = null,
  openingParticipantId = null,
}) {
  const controlledParticipantIds = participantStates
    .filter((participant) => participant.controllerUserId === requesterUserId)
    .map((participant) => participant.participantId);

  const role = controlledParticipantIds.length > 1 ? 'master' : 'player';

  let focusedParticipantId = controlledParticipantIds[0] || null;
  if (controlledParticipantIds.includes(openingParticipantId)) {
    focusedParticipantId = openingParticipantId;
  } else if (controlledParticipantIds.includes(currentTurnParticipantId)) {
    focusedParticipantId = currentTurnParticipantId;
  }

  return {
    userId: requesterUserId,
    role,
    controlledParticipantIds,
    focusedParticipantId,
  };
}

function shouldRevealParticipantPrivateState({ requesterUserId, participant }) {
  return Number(participant?.controllerUserId) === Number(requesterUserId);
}

module.exports = {
  buildDefaultTurnOrderDraft,
  buildLobbyParticipantEntries,
  buildViewerMetadata,
  createMasterCharacterEntryId,
  createPlayerEntryId,
  getNextActiveParticipant,
  normalizeSelectedCharacterIds,
  reconcileTurnOrderDraft,
  shouldRevealParticipantPrivateState,
  validateTurnOrderDraft,
};
