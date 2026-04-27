import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

function getInitials(name) {
  return String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export function PlayerCard({ player, isActiveTurn = false, isCurrentUser = false }) {
  return (
    <Card
      className={['player-card', isActiveTurn ? 'player-card--active-turn' : ''].filter(Boolean).join(' ')}
      compact
      glow={isActiveTurn}
      selected={isActiveTurn}
    >
      <div className="player-card__header">
        <div className="player-card__avatar">{getInitials(player.username)}</div>

        <div className="stack-gap" style={{ gap: '4px' }}>
          <span>{player.username}</span>
        </div>
      </div>

      <div className="row-wrap">
        {isCurrentUser ? <Badge tone="primary">Você</Badge> : null}
        {isActiveTurn ? <Badge tone="accent">Turno ativo</Badge> : null}
        {player.is_ready ? <Badge tone="success">Pronto</Badge> : <Badge tone="secondary">Aguardando</Badge>}
      </div>
    </Card>
  );
}
