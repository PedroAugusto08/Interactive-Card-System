import { useEffect, useMemo, useState } from 'react';

import { PlayerCard } from '../components/system/PlayerCard';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { deckApi } from '../api/deckApi';
import { matchApi } from '../api/matchApi';
import { roomApi } from '../api/roomApi';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { formatErrorMessage } from '../utils/formatError';

export function RoomLobbyPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const currentMatch = useRoomStore((state) => state.currentMatch);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const setMatchData = useRoomStore((state) => state.setMatchData);
  const clearRoom = useRoomStore((state) => state.clearRoom);

  const [joinCode, setJoinCode] = useState('');
  const [availableDecks, setAvailableDecks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const userDeck = useMemo(() => availableDecks[0] || null, [availableDecks]);

  const currentPlayer = useMemo(
    () => players.find((player) => player.user_id === user?.id) || null,
    [players, user?.id]
  );
  const isHost = currentRoom?.host_id === user?.id;

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

        setAvailableDecks(decksResponse.decks || []);
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
  }, [setMatchData, setRoomData, token]);

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

  return (
    <section className="stack-gap-lg">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <h1 className="page-title">Room Lobby</h1>
        </div>
      </div>

      <div className="grid-2">
        <Card description="Criação, entrada e configuração da sua participação na sala." title="Sala">
          <div className="row-wrap">
            <Button loading={isLoading} onClick={handleCreateRoom}>
              Criar sala
            </Button>

            <Button disabled={isLoading || !currentRoom} onClick={handleLeaveRoom} variant="secondary">
              Sair da sala
            </Button>

            <Button disabled={isLoading} onClick={handleRefreshPlayers} variant="secondary">
              Atualizar
            </Button>
          </div>

          <form className="stack-gap" onSubmit={handleJoinRoom} style={{ marginTop: '18px' }}>
            <Input onChange={(event) => setJoinCode(event.target.value)} placeholder="Código da sala" required value={joinCode} />

            <Button loading={isLoading} type="submit">
              Entrar por código
            </Button>
          </form>

          <div className="stack-gap" style={{ marginTop: '18px' }}>
            <div className="status-item">
              <span className="status-label">Meu deck para a sala</span>
              <span className="status-value">{userDeck?.name || 'Nenhum deck criado'}</span>
            </div>

            <div className="row-wrap">
              <Button disabled={isLoading || !currentRoom || !userDeck} onClick={handleToggleReady} variant="secondary">
                {currentPlayer?.is_ready ? 'Desmarcar pronto' : 'Marcar como pronto'}
              </Button>

              <Button
                disabled={isLoading || !currentRoom || !isHost || currentRoom.status !== 'lobby'}
                onClick={handleStartMatch}
              >
                Iniciar partida
              </Button>
            </div>
          </div>

          {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        </Card>

        <Card title="Sala atual" description="Estado atual da sala, host e preparação dos jogadores.">
          {currentRoom ? (
            <div className="status-grid" style={{ marginBottom: '18px' }}>
              <div className="status-item">
                <span className="status-label">Código</span>
                <span className="status-value">{currentRoom.code}</span>
              </div>

              <div className="status-item">
                <span className="status-label">Status</span>
                <span className="status-value">{currentRoom.status}</span>
              </div>

              <div className="status-item">
                <span className="status-label">Host</span>
                <span className="status-value">{players.find((player) => player.user_id === currentRoom.host_id)?.username || '-'}</span>
              </div>

              <div className="status-item">
                <span className="status-label">Match</span>
                <span className="status-value">{currentMatch?.status || 'Sem partida'}</span>
              </div>
            </div>
          ) : (
            <div className="empty-state">Nenhuma sala carregada.</div>
          )}

          <div className="stack-gap">
            <div className="row-wrap">
              <h3>Jogadores conectados</h3>
              <Badge tone="accent">{players.length} no lobby</Badge>
            </div>

            {players.length ? (
              players.map((player) => (
                <PlayerCard
                  isCurrentUser={player.user_id === user?.id}
                  key={`${player.room_id}-${player.user_id}`}
                  player={player}
                />
              ))
            ) : (
              <div className="empty-state">Sem jogadores no estado atual.</div>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
