import { Badge } from '../ui/Badge';

const LOG_META_BY_TYPE = {
  MATCH_START: {
    tone: 'success',
    label: 'Início da partida',
    icon: '🎲',
  },
  MATCH_DRAW: {
    tone: 'secondary',
    label: 'Compra',
    icon: '🃏',
  },
  MATCH_PLAY_CARD: {
    tone: 'accent',
    label: 'Carta jogada',
    icon: '✨',
  },
  MATCH_DISCARD_CARD: {
    tone: 'secondary',
    label: 'Descarte',
    icon: '🪦',
  },
  MATCH_ATTACK_REACTION: {
    tone: 'danger',
    label: 'Ataque',
    icon: '⚔️',
  },
  MATCH_ATTACK_RESOLUTION: {
    tone: 'primary',
    label: 'Resolução',
    icon: '🛡️',
  },
  MATCH_REVEAL_TOP_DECK: {
    tone: 'accent',
    label: 'Revelação',
    icon: '👁️',
  },
  MATCH_END_TURN: {
    tone: 'primary',
    label: 'Fim de turno',
    icon: '⏭️',
  },
  MATCH_FINISH: {
    tone: 'success',
    label: 'Fim da partida',
    icon: '🏁',
  },
  MATCH_FORFEIT: {
    tone: 'danger',
    label: 'Saída da partida',
    icon: '🚪',
  },
  ROOM_JOIN: {
    tone: 'success',
    label: 'Entrada',
    icon: '🟢',
  },
  ROOM_JOIN_HTTP: {
    tone: 'success',
    label: 'Entrada',
    icon: '🟢',
  },
  ROOM_LEAVE: {
    tone: 'secondary',
    label: 'Saída',
    icon: '🔹',
  },
  ROOM_LEAVE_HTTP: {
    tone: 'secondary',
    label: 'Saída',
    icon: '🔹',
  },
  ROOM_LEAVE_SOCKET: {
    tone: 'secondary',
    label: 'Saída',
    icon: '🔹',
  },
  ERROR: {
    tone: 'danger',
    label: 'Erro',
    icon: '⚠️',
  },
  INFO: {
    tone: 'primary',
    label: 'Atualização',
    icon: '✦',
  },
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
  const meta = LOG_META_BY_TYPE[item.type] || LOG_META_BY_TYPE.INFO;

  return (
    <article className={['action-log-item', `action-log-item--${meta.tone}`].join(' ')}>
      <div className="action-log-item__top">
        <div className="action-log-item__meta">
          <span
            aria-hidden="true"
            className={['action-log-item__icon', `action-log-item__icon--${meta.tone}`].join(' ')}
          >
            <span className="action-log-item__emoji">{meta.icon}</span>
          </span>

          <div className="action-log-item__copy">
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
        </div>

        <span className="muted-text compact">{formatTimestamp(item.timestamp)}</span>
      </div>

      <p className="action-log-item__message">{item.message}</p>
    </article>
  );
}
