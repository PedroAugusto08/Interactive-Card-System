import { useEffect, useMemo, useState } from 'react';

import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';

// Tela base de partida em tempo real via Socket.IO.
export function MatchPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const setRoomData = useRoomStore((state) => state.setRoomData);

  const socket = useSocket(token);

  const [roomCode, setRoomCode] = useState('');
  const [matchState, setMatchState] = useState(null);
  const [logItems, setLogItems] = useState([]);

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
  function handleSocketJoin(event) {
    event.preventDefault();
    if (!socket) {
      return;
    }

    socket.emit('room:join', {
      code: roomCode.trim().toUpperCase(),
    });
  }

  // Dispara evento para sair da sala atual.
  function handleSocketLeave() {
    if (!socket || !currentRoom?.id) {
      return;
    }

    socket.emit('room:leave', {
      roomId: currentRoom.id,
    });
  }

  return (
    <section className="stack-gap">
      <article className="card">
        <h1>Match</h1>
        <p>
          Usuario: <strong>{user?.username}</strong> | Socket: <strong>{socketStatus}</strong>
        </p>

        <form className="row-wrap" onSubmit={handleSocketJoin}>
          <input
            type="text"
            placeholder="Codigo da sala"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            required
          />

          <button className="solid-btn" type="submit" disabled={!socket}>
            Entrar via socket
          </button>

          <button className="ghost-btn" type="button" onClick={handleSocketLeave}>
            Sair da sala
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
