import { Badge } from '../ui/Badge';

const TONE_BY_TYPE = {
  ERROR: 'danger',
  ROOM_JOIN: 'success',
  ROOM_JOIN_HTTP: 'success',
  ROOM_LEAVE: 'secondary',
  ROOM_LEAVE_HTTP: 'secondary',
  ROOM_LEAVE_SOCKET: 'secondary',
  INFO: 'primary',
};

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Agora';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Agora';
  }

  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ActionLogItem({ item }) {
  const tone = TONE_BY_TYPE[item.type] || 'primary';

  return (
    <article className={['action-log-item', `action-log-item--${tone}`].join(' ')}>
      <div className="action-log-item__top">
        <div className="action-log-item__meta">
          <span className={['action-log-item__icon', `action-log-item__icon--${tone}`].join(' ')} aria-hidden="true" />
          <Badge tone={tone}>{item.type || 'INFO'}</Badge>
        </div>
        <span className="muted-text compact">{formatTimestamp(item.timestamp)}</span>
      </div>

      <p className="action-log-item__message">{item.message}</p>
    </article>
  );
}
