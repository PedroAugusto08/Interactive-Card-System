import { useEffect, useMemo, useState } from 'react';

import { ActionLogItem } from '../components/system/ActionLogItem';
import { CardItem } from '../components/system/CardItem';
import { PlayerCard } from '../components/system/PlayerCard';
import { ZoneContainer } from '../components/system/ZoneContainer';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { roomApi } from '../api/roomApi';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { formatErrorMessage } from '../utils/formatError';

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
  const activeTurnPlayerId = matchState?.currentTurnPlayerId;

  const handPreview = useMemo(
    () => [
      {
        id: 'preview-1',
        name: 'Ataque Normal',
        description: 'Carta base de acao direta, pronta para uso no turno atual.',
        imageSrc: '/cartas/1.png',
        category: 'Fixa',
      },
      {
        id: 'preview-2',
        name: 'Reacao',
        description: 'Resposta defensiva para negar uma ofensiva inimiga.',
        imageSrc: '/cartas/3.png',
        category: 'Fixa',
      },
      {
        id: 'preview-3',
        name: 'Divisao',
        description: 'Manipula o fluxo de cartas entre aliados e alvos.',
        imageSrc: '/cartas/11.png',
        category: 'Divisao',
      },
    ],
    []
  );

  function appendLocalLog(payload) {
    setLogItems((previous) => [payload, ...previous].slice(0, 40));
  }

  const socketStatus = useMemo(() => {
    if (!socket) {
      return 'desconectado';
    }

    return socket.connected ? 'conectado' : 'conectando';
  }, [socket]);

  useEffect(() => {
    if (!socket) {
      return undefined;
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

  async function handleSocketLeave() {
    if (!currentRoom?.id) {
      return;
    }

    if (isSocketConnected) {
      socket.emit('room:leave', { roomId: currentRoom.id });
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
    <section className="match-shell">
      <div className="match-topbar">
        <Card description="Sala, turno e conectividade em um topo consolidado." title="Match Control">
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Sala</span>
              <span className="status-value">{currentRoom?.code || 'Sem sala'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Turno atual</span>
              <span className="status-value">{activeTurnPlayerId ?? '-'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Socket</span>
              <span className="status-value">{socketStatus}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Round</span>
              <span className="status-value">{matchState?.round ?? 1}</span>
            </div>
          </div>
        </Card>

        <Card description="Conecte-se a uma sala e sincronize o estado da partida." title="Acoes">
          <form className="stack-gap" onSubmit={handleSocketJoin}>
            <Input onChange={(event) => setRoomCode(event.target.value)} placeholder="Codigo da sala" required value={roomCode} />

            <div className="row-wrap">
              <Button loading={isSubmitting} type="submit">
                {isSocketConnected ? 'Entrar via socket' : 'Entrar via HTTP'}
              </Button>

              <Button disabled={isSubmitting || !currentRoom} onClick={handleSocketLeave} type="button" variant="secondary">
                Sair da sala
              </Button>

              <Button
                disabled={isSubmitting || !currentRoom}
                onClick={handleRefreshPlayers}
                type="button"
                variant="secondary"
              >
                Atualizar jogadores
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="match-grid">
        <div className="match-side-column players-column">
          <Card description="Lista lateral com destaque visual para o turno ativo." title="Jogadores">
            <div className="stack-gap">
              <div className="row-wrap">
                <Badge tone="accent">{players.length} conectados</Badge>
                <Badge tone={isSocketConnected ? 'success' : 'secondary'}>
                  {isSocketConnected ? 'Tempo real' : 'Fallback HTTP'}
                </Badge>
              </div>

              {players.length ? (
                players.map((player) => (
                  <PlayerCard
                    isActiveTurn={player.user_id === activeTurnPlayerId}
                    isCurrentUser={player.user_id === user?.id}
                    key={`${player.room_id}-${player.user_id}`}
                    player={player}
                  />
                ))
              ) : (
                <div className="empty-state">Sem jogadores sincronizados.</div>
              )}
            </div>
          </Card>
        </div>

        <div className="match-main-column">
          <Card
            description={
              isSocketConnected
                ? 'Eventos em tempo real ativos via Socket.IO.'
                : 'Socket indisponivel: usando fallback HTTP para entrar e sair.'
            }
            title="Area principal"
          >
            <div className="zones-grid">
              <ZoneContainer count={24} description="Fonte principal de compra." title="Deck" tone="primary" />
              <ZoneContainer count={5} description="Cartas descartadas recentemente." title="Descarte" />
              <ZoneContainer count={2} description="Cartas banidas ou temporariamente removidas." title="Exilio" />
              <ZoneContainer count={3} description="Recursos e cartas persistentes." title="Zona ativa" tone="accent" />
            </div>
          </Card>

          <Card description="Cartas com leitura limpa, hover leve e destaque de selecao." title="Sua mao">
            <div className="hand-grid">
              {handPreview.map((card, index) => (
                <CardItem
                  category={card.category}
                  description={card.description}
                  imageSrc={card.imageSrc}
                  key={card.id}
                  name={card.name}
                  selected={index === 0}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="match-side-column">
          <Card description="Feed lateral para eventos e feedbacks da partida." title="Log de acoes">
            <div className="log-list">
              {logItems.length ? (
                logItems.map((item, index) => <ActionLogItem item={item} key={`${item.timestamp || 'time'}-${index}`} />)
              ) : (
                <div className="empty-state">Sem eventos por enquanto.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
