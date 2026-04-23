import { useEffect, useMemo, useState } from 'react';

import { roomApi } from '../api/roomApi';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { formatErrorMessage } from '../utils/formatError';

// Tela base de partida em tempo real via Socket.IO.
export function MatchPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const clearRoom = useRoomStore((state) => state.clearRoom);

  const socket = useSocket(token);

  const [roomCode, setRoomCode] = useState('');
  const [matchState, setMatchState] = useState(null);
  const [logItems, setLogItems] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSocketConnected = Boolean(socket?.connected);

  function appendLocalLog(payload) {
    setLogItems((previous) => [payload, ...previous].slice(0, 40));
  }

  // Mensagem simples de status do socket para tela.
  const socketStatus = useMemo(() => {
    if (!socket) {
      return 'desconectado';
    }

    return socket.connected ? 'conectado' : 'conectando';
  }, [socket]);

  // Inscreve listeners dos eventos principais do backend.
  useEffect(() => {
    if (!socket) {
      return;
    }

    function handleRoomUpdate(payload) {
      setRoomData(payload);
    }

    function handleMatchUpdate(payload) {
      setMatchState(payload);
    }

    function handleLog(payload) {
      setLogItems((previous) => [payload, ...previous].slice(0, 40));
    }

    socket.on('room:update', handleRoomUpdate);
    socket.on('match:updateState', handleMatchUpdate);
    socket.on('match:log', handleLog);

    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.off('match:updateState', handleMatchUpdate);
      socket.off('match:log', handleLog);
    };
  }, [socket, setRoomData]);

  // Dispara evento para entrar em sala via websocket.
  async function handleSocketJoin(event) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      return;
    }

    if (isSocketConnected) {
      socket.emit('room:join', { code });
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await roomApi.joinRoom({ code, token });
      setRoomData(data);
      setMatchState({
        roomId: data.room.id,
        currentTurnPlayerId: null,
        round: 1,
        players: data.players,
      });

      appendLocalLog({
        type: 'ROOM_JOIN_HTTP',
        message: `Entrou na sala ${data.room.code} via HTTP fallback.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      appendLocalLog({
        type: 'ERROR',
        message: formatErrorMessage(error),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Dispara evento para sair da sala atual.
  async function handleSocketLeave() {
    if (!currentRoom?.id) {
      return;
    }

    if (isSocketConnected) {
      socket.emit('room:leave', {
        roomId: currentRoom.id,
      });

      clearRoom();
      setMatchState(null);

      appendLocalLog({
        type: 'ROOM_LEAVE_SOCKET',
        message: 'Saida de sala enviada via socket.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setIsSubmitting(true);

    try {
      await roomApi.leaveRoom({ roomId: currentRoom.id, token });
      clearRoom();
      setMatchState(null);

      appendLocalLog({
        type: 'ROOM_LEAVE_HTTP',
        message: 'Voce saiu da sala via HTTP fallback.',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      appendLocalLog({
        type: 'ERROR',
        message: formatErrorMessage(error),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Atualiza jogadores manualmente via API HTTP quando necessario.
  async function handleRefreshPlayers() {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await roomApi.listPlayers({ roomId: currentRoom.id, token });
      setRoomData(data);

      setMatchState((previous) => {
        if (!previous) {
          return {
            roomId: data.room.id,
            currentTurnPlayerId: null,
            round: 1,
            players: data.players,
          };
        }

        return {
          ...previous,
          roomId: data.room.id,
          players: data.players,
        };
      });

      appendLocalLog({
        type: 'ROOM_PLAYERS_REFRESH_HTTP',
        message: `Jogadores da sala ${data.room.code} atualizados via HTTP.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      appendLocalLog({
        type: 'ERROR',
        message: formatErrorMessage(error),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="stack-gap">
      <article className="card">
        <h1>Match</h1>
        <p>
          Usuario: <strong>{user?.username}</strong> | Socket: <strong>{socketStatus}</strong>
        </p>
        <p className="muted-text compact">
          {isSocketConnected
            ? 'Eventos em tempo real ativos via Socket.IO.'
            : 'Socket indisponivel: usando fallback HTTP para entrar/sair da sala.'}
        </p>

        <form className="row-wrap" onSubmit={handleSocketJoin}>
          <input
            type="text"
            placeholder="Codigo da sala"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            required
          />

          <button className="solid-btn" type="submit" disabled={isSubmitting}>
            {isSocketConnected ? 'Entrar via socket' : 'Entrar via HTTP'}
          </button>

          <button
            className="ghost-btn"
            type="button"
            onClick={handleSocketLeave}
            disabled={isSubmitting || !currentRoom}
          >
            Sair da sala
          </button>

          <button
            className="ghost-btn"
            type="button"
            onClick={handleRefreshPlayers}
            disabled={isSubmitting || !currentRoom}
          >
            Atualizar jogadores (HTTP)
          </button>
        </form>
      </article>

      <article className="card">
        <h2>Estado sincronizado</h2>
        {currentRoom ? (
          <p>
            Sala: <strong>{currentRoom.code}</strong> | Status: <strong>{currentRoom.status}</strong>
          </p>
        ) : (
          <p className="muted-text">Nenhuma sala ativa no estado local.</p>
        )}

        {matchState ? (
          <p>
            Round: <strong>{matchState.round}</strong> | Current turn player id:{' '}
            <strong>{matchState.currentTurnPlayerId ?? '-'}</strong>
          </p>
        ) : (
          <p className="muted-text">Sem match:updateState recebido ainda.</p>
        )}

        <h3>Jogadores no canal</h3>
        {players.length ? (
          <ul>
            {players.map((player) => (
              <li key={`${player.room_id}-${player.user_id}`}>
                {player.username}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">Sem jogadores sincronizados.</p>
        )}
      </article>

      <article className="card">
        <h2>Log de eventos</h2>
        {logItems.length ? (
          <ul className="log-list">
            {logItems.map((item, index) => (
              <li key={`${item.timestamp || 'time'}-${index}`}>
                <span className="log-type">[{item.type || 'INFO'}]</span> {item.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">Sem eventos por enquanto.</p>
        )}
      </article>
    </section>
  );
}
