import { useEffect, useMemo, useState } from 'react';

import { PlayerCard } from '../components/system/PlayerCard';
import { RoomStatusPanel } from '../components/system/RoomStatusPanel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
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
  translateRoomStatus,
} from '../utils/lobbyUi';

export function RoomLobbyPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
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
  const userDeck = useMemo(() => availableDecks[0] || null, [availableDecks]);
  const isSocketConnected = Boolean(socket?.connected);

  const currentPlayer = useMemo(
    () => players.find((player) => player.user_id === user?.id) || null,
    [players, user?.id]
  );
  const isHost = currentRoom?.host_id === user?.id;
  const readyPlayersCount = useMemo(() => countReadyPlayers(players), [players]);
  const everyoneReady = useMemo(() => areAllPlayersReady(players), [players]);
  const selectedUserDeck = useMemo(
    () => getDeckById(availableDecks, currentPlayer?.selected_deck_id) || userDeck,
    [availableDecks, currentPlayer?.selected_deck_id, userDeck]
  );
  const roomStatusLabel = useMemo(
    () =>
      translateRoomStatus({
        roomStatus: currentRoom?.status,
        matchStatus: currentMatch?.status,
        players,
      }),
    [currentMatch?.status, currentRoom?.status, players]
  );
  const startMatchDisabledReason = useMemo(() => {
    if (!currentRoom) {
      return 'Crie ou entre em uma sala para abrir a partida.';
    }

    if (!isHost) {
      return 'Somente o host pode iniciar a partida.';
    }

    if (currentRoom.status !== 'lobby') {
      return 'A partida já está em andamento ou foi encerrada.';
    }

    if (players.length < 2) {
      return 'A sala precisa de pelo menos 2 jogadores.';
    }

    if (players.some((player) => !player.selected_deck_id)) {
      return 'Todos os jogadores precisam selecionar um deck.';
    }

    if (!everyoneReady) {
      return 'Aguardando todos os jogadores ficarem prontos.';
    }

    return '';
  }, [currentRoom, everyoneReady, isHost, players]);
  const canStartMatch = !isLoading && !startMatchDisabledReason;
  const readyBannerTitle = everyoneReady ? 'Todos prontos para iniciar' : 'Aguardando jogadores ficarem prontos';
  const readyBannerDescription = currentRoom
    ? `${readyPlayersCount} de ${players.length} jogador${players.length === 1 ? '' : 'es'} pronto${readyPlayersCount === 1 ? '' : 's'}.`
    : '';

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
          setRoomData(roomResponse);
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
  }, [setDeckModuleData, setMatchData, setRoomData, token]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    function handleRoomUpdate(payload) {
      setRoomData(payload);
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
  }, [setMatchData, setRoomData, socket]);

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

    const timeoutId = window.setTimeout(() => {
      setCopyMessage('');
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyMessage]);

  async function handleCreateRoom() {
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await roomApi.createRoom({ token });
      setRoomData(response);
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
      setRoomData(response);
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
      await roomApi.leaveRoom({ roomId: currentRoom.id, token });
      clearRoom();
      setStatusMessage('Você saiu da sala atual.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefreshPlayers() {
    if (!currentRoom?.id) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await roomApi.listPlayers({ roomId: currentRoom.id, token });
      setRoomData(response);

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

  async function ensureUserDeckSelected() {
    const deckId = userDeck?.id;
    if (!currentRoom?.id || !deckId) {
      return false;
    }

    if (Number(currentPlayer?.selected_deck_id) === Number(deckId)) {
      return true;
    }

    const response = await roomApi.selectDeck({
      roomId: currentRoom.id,
      deckId,
      token,
    });
    setRoomData(response);
    return true;
  }

  async function handleToggleReady() {
    if (!currentRoom?.id) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      if (!currentPlayer?.is_ready) {
        const hasDeck = await ensureUserDeckSelected();
        if (!hasDeck) {
          throw new Error('Crie seu deck antes de marcar como pronto.');
        }
      }

      const response = await roomApi.setReady({
        roomId: currentRoom.id,
        isReady: !currentPlayer?.is_ready,
        token,
      });
      setRoomData(response);
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

  return (
    <section className="stack-gap-lg lobby-shell">
      <div className="section-header lobby-hero">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <h1 className="page-title">Lobby</h1>
        </div>

        <div className="lobby-hero__meta">
          <div
            className={[
              'lobby-ready-banner',
              'lobby-ready-banner--inline',
              everyoneReady ? 'lobby-ready-banner--success' : 'lobby-ready-banner--pending',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'lobby-ready-banner__icon',
                everyoneReady ? 'lobby-ready-banner__icon--success' : 'lobby-ready-banner__icon--pending',
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <span className="lobby-ready-banner__inline-copy">
              <strong>{readyBannerTitle}</strong>
              {readyBannerDescription ? <span>{readyBannerDescription}</span> : null}
            </span>
          </div>

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
          <Card
            className="lobby-control-panel"
            title="Controle da sala"
          >
            <div className="lobby-action-grid">
              <Button loading={isLoading} onClick={handleCreateRoom}>
                Criar sala
              </Button>

              <Button disabled={isLoading || !currentRoom} onClick={handleLeaveRoom} variant="danger">
                Sair da sala
              </Button>

              <Button disabled={isLoading} onClick={handleRefreshPlayers} variant="secondary">
                Atualizar
              </Button>
            </div>

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

            <div className="lobby-selected-deck">
              <div className="lobby-selected-deck__top">
                <div className="lobby-selected-deck__icon" aria-hidden="true">
                  D
                </div>

                <div className="stack-gap" style={{ gap: '4px' }}>
                  <span className="status-label">Deck selecionado</span>
                  <strong className="lobby-selected-deck__name">
                    {selectedUserDeck?.name || 'Nenhum deck criado'}
                  </strong>
                  <span className="muted-text compact">
                    {selectedUserDeck
                      ? `${getDeckCardCount(selectedUserDeck)} cartas`
                      : 'Crie um deck para liberar o estado pronto.'}
                  </span>
                </div>
              </div>
            </div>

            <div className="lobby-cta-group">
              <Button
                className="lobby-ready-button"
                disabled={isLoading || !currentRoom || !userDeck}
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
        </div>
      </div>
    </section>
  );
}

