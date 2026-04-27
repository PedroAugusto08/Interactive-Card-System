export function getDeckCardCount(deck) {
  if (!deck) {
    return 0;
  }

  if (typeof deck.summary?.totalCards === 'number') {
    return deck.summary.totalCards;
  }

  return (deck.cards_json || []).reduce((total, entry) => total + (Number(entry.quantity) || 0), 0);
}

export function getDeckById(decks, deckId) {
  if (!deckId) {
    return null;
  }

  return decks.find((deck) => Number(deck.id) === Number(deckId)) || null;
}

export function getHostPlayer(players, hostId) {
  return players.find((player) => player.user_id === hostId) || null;
}

export function countReadyPlayers(players) {
  return players.filter((player) => player.selected_deck_id && player.is_ready).length;
}

export function areAllPlayersReady(players) {
  return players.length >= 2 && players.every((player) => player.selected_deck_id && player.is_ready);
}

export function translateMatchStatus(status) {
  switch (status) {
    case 'active':
      return 'Em partida';
    case 'finished':
      return 'Encerrada';
    default:
      return 'Sem partida';
  }
}

export function translateRoomStatus({ roomStatus, matchStatus, players = [] }) {
  if (!roomStatus && !matchStatus) {
    return 'Sem sala';
  }

  if (roomStatus === 'in_match' || matchStatus === 'active') {
    return 'Em partida';
  }

  if (roomStatus === 'finished' || matchStatus === 'finished') {
    return 'Encerrada';
  }

  if (roomStatus === 'lobby') {
    if (players.length < 2) {
      return 'Aguardando jogadores';
    }

    if (areAllPlayersReady(players)) {
      return 'Preparando partida';
    }

    return 'Ativa';
  }

  return 'Ativa';
}
