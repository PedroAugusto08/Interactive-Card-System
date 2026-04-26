import { resolveCardImageUrl } from '../../utils/cardImages';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

export function ZoneContainer({
  title,
  count = 0,
  tone = 'secondary',
  description,
  previewCards = [],
  onClick,
}) {
  const stackPreview = Array.from({ length: Math.min(Math.max(count, 1), 4) });
  const previewItems = previewCards.slice(0, 4);

  return (
    <Card className={['zone-container', `zone-container--${tone}`].join(' ')} compact interactive>
      <button
        aria-label={onClick ? `Abrir zona ${title}` : undefined}
        className={['zone-container__trigger', onClick ? 'zone-container__trigger--clickable' : ''].filter(Boolean).join(' ')}
        onClick={onClick}
        type="button"
      >
        <div className="zone-container__header">
          <div>
            <h3>{title}</h3>
            {description ? <p className="muted-text compact">{description}</p> : null}
          </div>
          <Badge tone={tone}>{count} cartas</Badge>
        </div>

        <div className="zone-container__body">
          {previewItems.length ? (
            <div className="zone-preview-strip">
              {previewItems.map((card) => (
                <img
                  alt={`Carta em ${title}: ${card.name}`}
                  className="zone-preview-strip__image"
                  key={card.instanceId}
                  loading="lazy"
                  src={resolveCardImageUrl(card.imagePath)}
                />
              ))}
            </div>
          ) : (
            <div className="zone-stack" aria-hidden="true">
              {stackPreview.map((_, index) => (
                <div className="zone-stack__card" key={`${title}-${index}`} style={{ opacity: 1 - index * 0.12 }} />
              ))}
            </div>
          )}
          <span className="zone-container__count">{count ? `${count} itens na zona` : 'Zona vazia'}</span>
        </div>
      </button>
    </Card>
  );
}
