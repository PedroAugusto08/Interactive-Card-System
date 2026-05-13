import { useCallback, useEffect, useMemo, useState } from 'react';

import { PlayerCard } from '../components/system/PlayerCard';
import { RoomStatusPanel } from '../components/system/RoomStatusPanel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { deckApi } from '../api/deckApi';
import { matchApi } from '../api/matchApi';
import { roomApi } from '../api/roomApi';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useDeckStore } from '../stores/deckStore';
import { useRoomStore } from '../stores/roomStore';
import { formatErrorMessage } from '../utils/formatError';
import {
  areAllPlayersReady,
  countReadyPlayers,
  getDeckById,
  getDeckCardCount,
  getPlayerSelectedDeckIds,
  translateRoomStatus,
} from '../utils/lobbyUi';

function hasValidTurnOrderDraft(turnOrderDraft, lobbyParticipants) {
  if (!Array.isArray(turnOrderDraft) || !Array.isArray(lobbyParticipants)) {
    return false;
  }

  if (turnOrderDraft.length !== lobbyParticipants.length) {
    return false;
  }

  const expected = new Set(lobbyParticipants.map((entry) => entry.entryId));
  const seen = new Set();

  for (const entryId of turnOrderDraft) {
    if (!expected.has(entryId) || seen.has(entryId)) {
      return false;
    }
    seen.add(entryId);
  }

  return true;
}

function moveEntry(entries, fromIndex, direction) {
  const nextIndex = fromIndex + direction;
  if (nextIndex < 0 || nextIndex >= entries.length) {
    return entries;
  }

  const nextEntries = [...entries];
  const [movedEntry] = nextEntries.splice(fromIndex, 1);
  nextEntries.splice(nextIndex, 0, movedEntry);
  return nextEntries;
}

export function RoomLobbyPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const lobbyParticipants = useRoomStore((state) => state.lobbyParticipants);
  const currentMatch = useRoomStore((state) => state.currentMatch);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const setMatchData = useRoomStore((state) => state.setMatchData);
  const clearRoom = useRoomStore((state) => state.clearRoom);
  const availableDecks = useDeckStore((state) => state.decks);
  const setDeckModuleData = useDeckStore((state) => state.setModuleData);
  const socket = useSocket(token);

  const [joinCode, setJoinCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [pendingMasterDeckIds, setPendingMasterDeckIds] = useState([]);
  const [pendingTurnOrder, setPendingTurnOrder] = useState([]);
  const [isLeaveRoomModalOpen, setIsLeaveRoomModalOpen] = useState(false);
  const canActAsMaster = Boolean(
    user?.canManageMultipleDecks ||
      user?.isMasterAccount ||
      user?.isDevMasterOverride ||
      user?.devMasterOverride
  );

  const syncRoomState = useCallback((payload) => {
    setRoomData(payload);

    const syncedCurrentPlayer = (payload?.players || []).find((player) => player.user_id === user?.id) || null;
    setPendingMasterDeckIds(getPlayerSelectedDeckIds(syncedCurrentPlayer));
    setPendingTurnOrder(payload?.room?.turn_order_draft_json || []);
  }, [setRoomData, user?.id]);

  const isSocketConnected = Boolean(socket?.connected);
  const currentPlayer = useMemo(
    () => players.find((player) => player.user_id === user?.id) || null,
    [players, user?.id]
  );
  const isMaster = Boolean(currentPlayer?.is_master);
  const selectedUserDeck = useMemo(
    () => getDeckById(availableDecks, currentPlayer?.selected_deck_id),
    [availableDecks, currentPlayer?.selected_deck_id]
  );
  const selectedMasterDeckIds = useMemo(
    () => getPlayerSelectedDeckIds(currentPlayer),
    [currentPlayer]
  );
  const readyPlayersCount = useMemo(() => countReadyPlayers(players), [players]);
  const everyoneReady = useMemo(() => areAllPlayersReady(players), [players]);
  const roomStatusLabel = useMemo(
    () =>
      translateRoomStatus({
        roomStatus: currentRoom?.status,
        matchStatus: currentMatch?.status,
        players,
      }),
    [currentMatch?.status, currentRoom?.status, players]
  );
  const turnOrderDraft = useMemo(() => currentRoom?.turn_order_draft_json || [], [currentRoom?.turn_order_draft_json]);
  const hasValidDraft = useMemo(
    () => hasValidTurnOrderDraft(turnOrderDraft, lobbyParticipants),
    [lobbyParticipants, turnOrderDraft]
  );

  useEffect(() => {
    let isMounted = true;

    async function loadLobbyState() {
      try {
        const [roomResponse, decksResponse] = await Promise.all([
          roomApi.getCurrentRoom({ token }),
          deckApi.listDecks({ token }),
        ]);

        if (!isMounted) {
          return;
        }

        const deckState = useDeckStore.getState();
        setDeckModuleData({
          rules: deckState.rules,
          catalog: deckState.catalog,
          decks: decksResponse.decks || [],
          imoCards: deckState.imoCards,
        });

        if (roomResponse.room) {
          syncRoomState(roomResponse);
        }
        if (roomResponse.match) {
          setMatchData(roomResponse.match);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(formatErrorMessage(error));
        }
      }
    }

    loadLobbyState();
    return () => {
      isMounted = false;
    };
  }, [setDeckModuleData, setMatchData, setRoomData, syncRoomState, token]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    function handleRoomUpdate(payload) {
      if (payload?.room?.status === 'finished') {
        clearRoom();
        setMatchData({ match: null, viewer: null, participantStates: [], logs: [] });
        setStatusMessage('A sala foi encerrada.');
        return;
      }

      syncRoomState(payload);
    }

    function handleMatchSync(payload) {
      setMatchData(payload);
    }

    function handleLog(payload) {
      if (payload?.type === 'ERROR' && payload.message) {
        setErrorMessage(payload.message);
      }
    }

    socket.on('room:update', handleRoomUpdate);
    socket.on('match:sync', handleMatchSync);
    socket.on('match:log', handleLog);

    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.off('match:sync', handleMatchSync);
      socket.off('match:log', handleLog);
    };
  }, [clearRoom, setMatchData, socket, syncRoomState]);

  useEffect(() => {
    if (!socket || !currentRoom?.id || !currentRoom?.code || !isSocketConnected) {
      return;
    }

    socket.emit('room:join', { code: currentRoom.code });
    if (currentRoom.status === 'in_match') {
      socket.emit('match:sync', { roomId: currentRoom.id });
    }
  }, [currentRoom?.code, currentRoom?.id, currentRoom?.status, isSocketConnected, socket]);

  useEffect(() => {
    if (!copyMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopyMessage(''), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [copyMessage]);

  const startMatchDisabledReason = useMemo(() => {
    if (!currentRoom) {
      return 'Crie ou entre em uma sala para abrir a partida.';
    }

    if (!isMaster) {
      return 'Somente o mestre pode iniciar a partida.';
    }

    if (currentRoom.status !== 'lobby') {
      return 'A partida já está em andamento ou foi encerrada.';
    }

    if (players.length < 2) {
      return 'A sala precisa de pelo menos 2 usuários.';
    }

    if (!selectedMasterDeckIds.length) {
      return 'O mestre precisa selecionar ao menos uma criatura.';
    }

    if (players.some((player) => !player.is_master && !player.selected_deck_id)) {
      return 'Todos os jogadores precisam selecionar um deck.';
    }

    if (!hasValidDraft) {
      return 'Defina a ordem completa da rodada antes de iniciar.';
    }

    if (!everyoneReady) {
      return 'Aguardando todos os jogadores ficarem prontos.';
    }

    return '';
  }, [currentRoom, everyoneReady, hasValidDraft, isMaster, players, selectedMasterDeckIds.length]);

  const canStartMatch = !isLoading && !startMatchDisabledReason;

  async function handleCreateRoom() {
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await roomApi.createRoom({ token });
      syncRoomState(response);
      setStatusMessage(`Sala criada com código ${response.room.code}.`);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleJoinRoom(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await roomApi.joinRoom({ code: joinCode.trim().toUpperCase(), token });
      syncRoomState(response);
      setStatusMessage(`Entrou na sala ${response.room.code}.`);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLeaveRoom() {
    if (!currentRoom?.id) {
      setErrorMessage('Não existe sala ativa para sair.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      if (socket && isSocketConnected) {
        socket.emit('room:leave', { roomId: currentRoom.id });
      } else {
        await roomApi.leaveRoom({ roomId: currentRoom.id, token });
      }
      clearRoom();
      setStatusMessage(
        isMaster && ['lobby', 'in_match'].includes(currentRoom.status)
          ? 'VocÃª saiu da sala. A sala foi encerrada para todos os participantes.'
          : 'VocÃª saiu da sala atual.'
      );
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  function handleRequestLeaveRoom() {
    if (!currentRoom?.id) {
      setErrorMessage('NÃ£o existe sala ativa para sair.');
      return;
    }

    if (isMaster && ['lobby', 'in_match'].includes(currentRoom.status)) {
      setIsLeaveRoomModalOpen(true);
      return;
    }

    handleLeaveRoom();
  }

  async function handleConfirmLeaveRoom() {
    setIsLeaveRoomModalOpen(false);
    await handleLeaveRoom();
  }

  async function handleRefreshPlayers() {
    if (!currentRoom?.id) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await roomApi.listPlayers({ roomId: currentRoom.id, token });
      syncRoomState(response);

      if (currentRoom.status === 'in_match') {
        const snapshot = await matchApi.getSnapshot({ roomId: currentRoom.id, token });
        setMatchData(snapshot);
      }
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectPlayerDeck(deckId) {
    if (!currentRoom?.id || isMaster) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await roomApi.selectDeck({
        roomId: currentRoom.id,
        deckId,
        token,
      });
      syncRoomState(response);
      setStatusMessage('Deck do jogador atualizado.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveMasterDecks() {
    if (!currentRoom?.id || !isMaster) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await roomApi.replaceMasterDecks({
        roomId: currentRoom.id,
        deckIds: pendingMasterDeckIds,
        token,
      });
      syncRoomState(response);
      setStatusMessage('Criaturas do mestre atualizadas.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveTurnOrder() {
    if (!currentRoom?.id || !isMaster) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await roomApi.updateTurnOrderDraft({
        roomId: currentRoom.id,
        draftEntryIds: pendingTurnOrder,
        token,
      });
      syncRoomState(response);
      setStatusMessage('Ordem da rodada atualizada.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleReady() {
    if (!currentRoom?.id) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await roomApi.setReady({
        roomId: currentRoom.id,
        isReady: !currentPlayer?.is_ready,
        token,
      });
      syncRoomState(response);
      setStatusMessage(currentPlayer?.is_ready ? 'Você não está mais pronto.' : 'Você marcou como pronto.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStartMatch() {
    if (!currentRoom?.id) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const snapshot = await matchApi.start({ roomId: currentRoom.id, token });
      setMatchData(snapshot);
      setStatusMessage('Partida iniciada com sucesso.');
      await handleRefreshPlayers();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopyRoomCode() {
    if (!currentRoom?.code || !navigator?.clipboard) {
      setErrorMessage('Não foi possível copiar o código da sala.');
      return;
    }

    try {
      await navigator.clipboard.writeText(currentRoom.code);
      setCopyMessage('Código copiado para a área de transferência.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    }
  }

  const orderedLobbyParticipants = pendingTurnOrder
    .map((entryId) => lobbyParticipants.find((entry) => entry.entryId === entryId))
    .filter(Boolean);

  return (
    <section className="stack-gap-lg lobby-shell">
      <div className="section-header lobby-hero">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <h1 className="page-title">Lobby</h1>
        </div>

        <div className="lobby-hero__meta">
          <Badge tone={everyoneReady ? 'success' : 'primary'}>{roomStatusLabel}</Badge>
          <span className="lobby-connection-pill">
            <span
              aria-hidden="true"
              className={['status-dot', `status-dot--${isSocketConnected ? 'connected' : 'offline'}`].join(' ')}
            />
            {isSocketConnected ? 'Tempo real ativo' : 'Reconectando lobby'}
          </span>
          <Badge tone="secondary">{players.length} no lobby</Badge>
        </div>
      </div>

      <div className="grid-2 lobby-grid">
        <div className="stack-gap lobby-left-column">
          <Card className="lobby-control-panel" title="Controle da sala">
            <div className="lobby-action-grid">
              <Button disabled={!canActAsMaster} loading={isLoading} onClick={handleCreateRoom}>
                Criar sala
              </Button>

              <Button disabled={isLoading || !currentRoom} onClick={handleRequestLeaveRoom} variant="danger">
                Sair da sala
              </Button>

              <Button disabled={isLoading} onClick={handleRefreshPlayers} variant="secondary">
                Atualizar
              </Button>
            </div>

            {!canActAsMaster ? (
              <p className="muted-text compact">
                Somente o mestre fixo pode criar salas. Contas de jogador entram usando o codigo da sala.
              </p>
            ) : null}

            <form className="lobby-join-form" onSubmit={handleJoinRoom}>
              <Input
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="Código da sala"
                required
                value={joinCode}
              />

              <Button loading={isLoading} type="submit">
                Entrar por código
              </Button>
            </form>

            {currentRoom ? (
              <div className="stack-gap" style={{ gap: '16px' }}>
                {isMaster ? (
                  <Card compact title="Criaturas do mestre">
                    <div className="row-wrap" style={{ gap: '10px' }}>
                      {availableDecks.map((deck) => {
                        const isSelected = pendingMasterDeckIds.includes(deck.id);
                        return (
                          <Button
                            key={`master-deck-toggle-${deck.id}`}
                            onClick={() =>
                              setPendingMasterDeckIds((current) =>
                                current.includes(deck.id)
                                  ? current.filter((value) => value !== deck.id)
                                  : [...current, deck.id]
                              )
                            }
                            type="button"
                            variant={isSelected ? 'primary' : 'secondary'}
                          >
                            {deck.name} ({getDeckCardCount(deck)})
                          </Button>
                        );
                      })}
                    </div>
                    <div className="row-wrap" style={{ marginTop: '12px' }}>
                      <Button disabled={isLoading} onClick={handleSaveMasterDecks} type="button">
                        Salvar criaturas
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <Card compact title="Deck do jogador">
                    <div className="row-wrap" style={{ gap: '10px' }}>
                      {availableDecks.map((deck) => {
                        const isSelected = Number(currentPlayer?.selected_deck_id) === Number(deck.id);
                        return (
                          <Button
                            key={`player-deck-select-${deck.id}`}
                            onClick={() => handleSelectPlayerDeck(deck.id)}
                            type="button"
                            variant={isSelected ? 'primary' : 'secondary'}
                          >
                            {deck.name} ({getDeckCardCount(deck)})
                          </Button>
                        );
                      })}
                    </div>
                    <p className="muted-text compact" style={{ marginTop: '12px' }}>
                      {selectedUserDeck ? `Selecionado: ${selectedUserDeck.name}.` : 'Selecione um deck para entrar pronto.'}
                    </p>
                  </Card>
                )}

                {isMaster ? (
                  <Card compact title="Ordem da rodada">
                    {orderedLobbyParticipants.length ? (
                      <div className="stack-gap lobby-turn-order-list" style={{ gap: '10px' }}>
                        {orderedLobbyParticipants.map((entry, index) => (
                          <div className="lobby-turn-order-item" key={`turn-order-${entry.entryId}`}>
                            <div className="stack-gap lobby-turn-order-item__copy" style={{ gap: '2px' }}>
                              <strong>{entry.displayName}</strong>
                              <span className="muted-text compact">
                                {entry.participantType === 'master-creature'
                                  ? `Criatura controlada por ${entry.username}`
                                  : 'Jogador'}
                              </span>
                            </div>
                            <div className="row-wrap">
                              <Button
                                onClick={() => setPendingTurnOrder((current) => moveEntry(current, index, -1))}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                Subir
                              </Button>
                              <Button
                                onClick={() => setPendingTurnOrder((current) => moveEntry(current, index, 1))}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                Descer
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button disabled={isLoading} onClick={handleSaveTurnOrder} type="button">
                          Salvar ordem
                        </Button>
                      </div>
                    ) : (
                      <div className="empty-state">Selecione criaturas e decks para montar a ordem.</div>
                    )}
                  </Card>
                ) : null}
              </div>
            ) : null}

            <div className="lobby-cta-group">
              <Button
                className="lobby-ready-button"
                disabled={isLoading || !currentRoom}
                onClick={handleToggleReady}
                variant="secondary"
              >
                {currentPlayer?.is_ready ? 'Desmarcar pronto' : 'Marcar como pronto'}
              </Button>

              <Button className="lobby-start-button" disabled={!canStartMatch} onClick={handleStartMatch}>
                Iniciar partida
              </Button>
            </div>

            {startMatchDisabledReason ? <p className="muted-text compact">{startMatchDisabledReason}</p> : null}
            {copyMessage ? <p className="success-text">{copyMessage}</p> : null}
            {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          </Card>
        </div>

        <div className="stack-gap lobby-right-column">
          <RoomStatusPanel
            currentMatch={currentMatch}
            currentRoom={currentRoom}
            onCopyCode={handleCopyRoomCode}
            players={players}
          />

          <Card
            actions={<Badge tone="accent">{readyPlayersCount}/{players.length} prontos</Badge>}
            className="lobby-players-panel"
            title="Jogadores conectados"
          >
            {players.length ? (
              <div className="lobby-players-grid">
                {players.map((player) => (
                  <PlayerCard
                    isCurrentUser={player.user_id === user?.id}
                    isHost={player.user_id === currentRoom?.host_id}
                    key={`${player.room_id}-${player.user_id}`}
                    player={player}
                    selectedDeck={getDeckById(availableDecks, player.selected_deck_id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">Sem jogadores no estado atual.</div>
            )}
          </Card>

          <Card title="Participantes da rodada">
            {lobbyParticipants.length ? (
              <div className="stack-gap lobby-participant-list" style={{ gap: '10px' }}>
                {lobbyParticipants.map((entry) => (
                  <div className="lobby-participant-item" key={`lobby-participant-${entry.entryId}`}>
                    <div className="stack-gap lobby-participant-item__copy" style={{ gap: '2px' }}>
                      <strong>{entry.displayName}</strong>
                      <span className="muted-text compact">
                        {entry.participantType === 'master-creature' ? 'Criatura do mestre' : 'Jogador'}
                      </span>
                    </div>
                    <Badge tone="secondary">
                      Posição {Math.max(1, turnOrderDraft.indexOf(entry.entryId) + 1)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Nenhum participante configurado ainda.</div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        cancelLabel="Cancelar"
        confirmLabel="Encerrar sala e sair"
        description="Ao sair como mestre, a sala ativa sera encerrada para todos."
        isLoading={isLoading}
        onClose={() => setIsLeaveRoomModalOpen(false)}
        onConfirm={handleConfirmLeaveRoom}
        open={isLeaveRoomModalOpen}
        title="Encerrar sala?"
      >
        <p className="muted-text">
          Todos os participantes perderao acesso a esta sala assim que voce sair. Use essa opcao apenas quando quiser encerrar a sessao atual.
        </p>
      </Modal>
    </section>
  );
}
