import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  areAllPlayersReady,
  getHostPlayer,
  translateMatchStatus,
  translateRoomStatus,
} from '../../utils/lobbyUi';

function getStatusTone({ roomStatus, matchStatus, players }) {
  if (roomStatus === 'in_match' || matchStatus === 'active') {
    return 'secondary';
  }

  if (areAllPlayersReady(players)) {
    return 'success';
  }

  return 'primary';
}

export function RoomStatusPanel({
  currentRoom,
  currentMatch,
  players,
  onCopyCode,
}) {
  if (!currentRoom) {
    return (
      <Card className="lobby-room-panel" title="Sala atual">
        <div className="empty-state">Nenhuma sala carregada.</div>
      </Card>
    );
  }

  const hostPlayer = getHostPlayer(players, currentRoom.host_id);
  const roomStatusLabel = translateRoomStatus({
    roomStatus: currentRoom.status,
    matchStatus: currentMatch?.status,
    players,
  });
  const matchStatusLabel = translateMatchStatus(currentMatch?.status);

  return (
    <Card
      actions={
        <Badge tone={getStatusTone({ roomStatus: currentRoom.status, matchStatus: currentMatch?.status, players })}>
          {roomStatusLabel}
        </Badge>
      }
      className="lobby-room-panel"
      glow
      title="Sala atual"
    >
      <div className="lobby-room-code">
        <span className="status-label">Codigo da sala</span>
        <div className="lobby-room-code__row">
          <strong className="lobby-room-code__value">{currentRoom.code}</strong>
          <Button className="lobby-copy-button" onClick={onCopyCode} size="sm" variant="secondary">
            Copiar
          </Button>
        </div>
      </div>

      <div className="lobby-room-field-grid">
        <div className="lobby-room-field">
          <div className="lobby-room-field__header">
            <span className="lobby-room-field__icon">S</span>
            <span>Status</span>
          </div>
          <div className="lobby-room-field__value">{roomStatusLabel}</div>
          <span className="muted-text compact">{matchStatusLabel}</span>
        </div>

        <div className="lobby-room-field">
          <div className="lobby-room-field__header">
            <span className="lobby-room-field__icon">H</span>
            <span>Host</span>
          </div>
          <div className="lobby-room-field__value">
            <span>{hostPlayer?.username || '-'}</span>
            {hostPlayer ? <Badge tone="accent">Host</Badge> : null}
          </div>
        </div>

        <div className="lobby-room-field">
          <div className="lobby-room-field__header">
            <span className="lobby-room-field__icon">J</span>
            <span>Jogadores</span>
          </div>
          <div className="lobby-room-field__value">
            {players.length} conectado{players.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="lobby-room-field">
          <div className="lobby-room-field__header">
            <span className="lobby-room-field__icon">M</span>
            <span>Partida</span>
          </div>
          <div className="lobby-room-field__value">{matchStatusLabel}</div>
          <span className="muted-text compact">
            {currentMatch?.round ? `Rodada ${currentMatch.round}` : 'Aguardando inicio'}
          </span>
        </div>
      </div>
    </Card>
  );
}
