function createPlayerEntryId(userId) {
  return `player:${Number(userId)}`;
}

function createMasterDeckEntryId(deckId) {
  return `master-deck:${Number(deckId)}`;
}

function normalizeSelectedDeckIds(player) {
  if (Array.isArray(player?.selected_deck_ids)) {
    return player.selected_deck_ids
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  if (Array.isArray(player?.selected_deck_ids_json)) {
    return player.selected_deck_ids_json
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  const fallbackDeckId = Number(player?.selected_deck_id);
  return Number.isInteger(fallbackDeckId) && fallbackDeckId > 0 ? [fallbackDeckId] : [];
}

function buildLobbyParticipantEntries({ room, players = [], deckMap = new Map() }) {
  const hostId = Number(room?.host_id);
  const entries = [];

  for (const player of players) {
    const playerUserId = Number(player.user_id);
    const selectedDeckIds = normalizeSelectedDeckIds(player);

    if (playerUserId === hostId) {
      for (const deckId of selectedDeckIds) {
        const selectedDeck = deckMap.get(deckId);
        entries.push({
          entryId: createMasterDeckEntryId(deckId),
          participantType: 'master-creature',
          controllerUserId: playerUserId,
          roomPlayerUserId: playerUserId,
          sourceDeckId: deckId,
          displayName: selectedDeck?.name || `Criatura ${deckId}`,
          username: player.username,
        });
      }
      continue;
    }

    if (!selectedDeckIds.length) {
      continue;
    }

    const selectedDeck = deckMap.get(selectedDeckIds[0]);
    entries.push({
      entryId: createPlayerEntryId(playerUserId),
      participantType: 'player',
      controllerUserId: playerUserId,
      roomPlayerUserId: playerUserId,
      sourceDeckId: selectedDeckIds[0],
      displayName: player.username,
      username: player.username,
      selectedDeckName: selectedDeck?.name || '',
    });
  }

  return entries;
}

function buildDefaultTurnOrderDraft({ room, players = [], deckMap = new Map() }) {
  return buildLobbyParticipantEntries({ room, players, deckMap }).map((entry) => entry.entryId);
}

function validateTurnOrderDraft({ lobbyEntries = [], draftEntryIds = [] }) {
  const validIds = lobbyEntries.map((entry) => entry.entryId);
  if (!validIds.length) {
    return {
      ok: false,
      reason: 'Nenhum participante disponivel para ordenar.',
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
        reason: 'A ordem de turno contem itens invalidos ou duplicados.',
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

function buildViewerMetadata({ requesterUserId, participantStates = [], currentTurnParticipantId = null, combatState = null }) {
  const controlledParticipantIds = participantStates
    .filter((participant) => participant.controllerUserId === requesterUserId)
    .map((participant) => participant.participantId);

  const role = controlledParticipantIds.length > 1 ? 'master' : 'player';

  let focusedParticipantId = controlledParticipantIds[0] || null;
  if (controlledParticipantIds.includes(currentTurnParticipantId)) {
    focusedParticipantId = currentTurnParticipantId;
  } else if (controlledParticipantIds.includes(combatState?.defenderParticipantId)) {
    focusedParticipantId = combatState.defenderParticipantId;
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
  createMasterDeckEntryId,
  createPlayerEntryId,
  getNextActiveParticipant,
  normalizeSelectedDeckIds,
  reconcileTurnOrderDraft,
  shouldRevealParticipantPrivateState,
  validateTurnOrderDraft,
};
