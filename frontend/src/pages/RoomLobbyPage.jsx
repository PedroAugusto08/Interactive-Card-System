import { useState } from 'react';

import { PlayerCard } from '../components/system/PlayerCard';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { roomApi } from '../api/roomApi';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { formatErrorMessage } from '../utils/formatError';

// Tela de lobby para criar/entrar em sala e listar jogadores.
export function RoomLobbyPage() {
  const token = useAuthStore((state) => state.token);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const clearRoom = useRoomStore((state) => state.clearRoom);

  const [joinCode, setJoinCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleCreateRoom() {
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await roomApi.createRoom({ token });
      setRoomData(response);
      setStatusMessage(`Sala criada com codigo ${response.room.code}.`);
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
      setErrorMessage('Nao existe sala ativa para sair.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      await roomApi.leaveRoom({ roomId: currentRoom.id, token });
      clearRoom();
      setStatusMessage('Voce saiu da sala atual.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleListPlayers() {
    const roomId = Number(currentRoom?.id);
    if (!roomId) {
      setErrorMessage('Entre em uma sala para listar jogadores.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await roomApi.listPlayers({ roomId, token });
      setRoomData(response);
      setStatusMessage(`Jogadores carregados da sala ${response.room.code}.`);
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
          <Badge tone="secondary">Lobby Control</Badge>
          <h1 className="page-title">Room Lobby</h1>
          <p className="page-subtitle">Crie uma sala, entre por codigo e acompanhe a composicao do grupo.</p>
        </div>
      </div>

      <div className="grid-2">
        <Card description="Gerencie a entrada dos jogadores via API HTTP." title="Sala">
          <div className="row-wrap">
            <Button loading={isLoading} onClick={handleCreateRoom}>
              Criar sala
            </Button>

            <Button disabled={isLoading || !currentRoom} onClick={handleLeaveRoom} variant="secondary">
              Sair da sala
            </Button>

            <Button disabled={isLoading} onClick={handleListPlayers} variant="secondary">
              Listar jogadores
            </Button>
          </div>

          <form className="stack-gap" onSubmit={handleJoinRoom} style={{ marginTop: '18px' }}>
            <Input
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="Codigo da sala"
              required
              value={joinCode}
            />

            <Button loading={isLoading} type="submit">
              Entrar por codigo
            </Button>
          </form>

          <div className="stack-gap" style={{ marginTop: '18px' }}>
            {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          </div>
        </Card>

        <Card title="Sala atual" description="Status da sala e jogadores carregados no estado local.">
          {currentRoom ? (
            <div className="status-grid" style={{ marginBottom: '18px' }}>
              <div className="status-item">
                <span className="status-label">Codigo</span>
                <span className="status-value">{currentRoom.code}</span>
              </div>

              <div className="status-item">
                <span className="status-label">Status</span>
                <span className="status-value">{currentRoom.status}</span>
              </div>

              <div className="status-item">
                <span className="status-label">Jogadores</span>
                <span className="status-value">{players.length}</span>
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
              players.map((player) => <PlayerCard key={`${player.room_id}-${player.user_id}`} player={player} />)
            ) : (
              <div className="empty-state">Sem jogadores no estado atual.</div>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
