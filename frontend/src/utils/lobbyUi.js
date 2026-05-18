export function getCharacterById(characters, characterId) {
  if (!characterId) {
    return null;
  }

  return characters.find((character) => Number(character.id) === Number(characterId)) || null;
}

export function getPlayerSelectedCharacterIds(player) {
  if (Array.isArray(player?.selected_character_ids)) {
    return player.selected_character_ids;
  }

  return player?.selected_character_id ? [player.selected_character_id] : [];
}

export function getHostPlayer(players, hostId) {
  return players.find((player) => player.user_id === hostId) || null;
}

export function countReadyPlayers(players) {
  return players.filter((player) => {
    if (player?.is_master) {
      return getPlayerSelectedCharacterIds(player).length > 0 && player.is_ready;
    }

    return player.selected_character_id && player.is_ready;
  }).length;
}

export function areAllPlayersReady(players) {
  return players.length >= 2 && players.every((player) => {
    if (player?.is_master) {
      return getPlayerSelectedCharacterIds(player).length > 0 && player.is_ready;
    }

    return player.selected_character_id && player.is_ready;
  });
}

export function translateMatchStatus(status) {
  switch (status) {
    case 'opening':
      return 'Escolha inicial';
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

  if (roomStatus === 'in_match' && matchStatus === 'opening') {
    return 'Abertura de Imo';
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

    return 'Lobby ativo';
  }

  return 'Ativa';
}
