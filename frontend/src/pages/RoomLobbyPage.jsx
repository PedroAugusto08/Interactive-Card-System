import { useState } from 'react';

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

  // Cria nova sala e atualiza estado local.
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

  // Entra em sala pelo codigo curto.
  async function handleJoinRoom(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await roomApi.joinRoom({ code: joinCode.trim().toUpperCase(), token });
      setRoomData(response);
      setRoomIdInput(String(response.room.id));
      setStatusMessage(`Entrou na sala ${response.room.code}.`);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  // Sai da sala atual usando contrato HTTP.
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

  // Busca lista de jogadores da sala pelo id.
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
    <section className="stack-gap">
      <article className="card">
        <h1>Room Lobby</h1>
        <p className="muted-text">Gerencie a entrada dos jogadores via API HTTP.</p>

        <div className="row-wrap">
          <button className="solid-btn" onClick={handleCreateRoom} disabled={isLoading}>
            Criar sala
          </button>

          <button className="ghost-btn" onClick={handleLeaveRoom} disabled={isLoading || !currentRoom}>
            Sair da sala
          </button>

          <button className="ghost-btn" onClick={handleListPlayers} disabled={isLoading}>
            Listar jogadores
          </button>
        </div>

        <form className="row-wrap" onSubmit={handleJoinRoom}>
          <input
            type="text"
            placeholder="Codigo da sala"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            required
          />

          <button className="solid-btn" type="submit" disabled={isLoading}>
            Entrar por codigo
          </button>
        </form>

        {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </article>

      <article className="card">
        <h2>Sala atual</h2>
        {currentRoom ? (
          <p>
            Code: <strong>{currentRoom.code}</strong> | Status: <strong>{currentRoom.status}</strong>
          </p>
        ) : (
          <p className="muted-text">Nenhuma sala carregada.</p>
        )}

        <h3>Jogadores conectados (API)</h3>
        {players.length ? (
          <ul>
            {players.map((player) => (
              <li key={`${player.room_id}-${player.user_id}`}>
                {player.username} ({player.email})
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">Sem jogadores no estado atual.</p>
        )}
      </article>
    </section>
  );
}
