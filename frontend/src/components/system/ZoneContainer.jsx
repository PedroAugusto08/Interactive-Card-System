import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

export function ZoneContainer({ title, count = 0, tone = 'secondary', description }) {
  const stackPreview = Array.from({ length: Math.min(Math.max(count, 1), 4) });

  return (
    <Card className="zone-container" compact>
      <div className="zone-container__header">
        <div>
          <h3>{title}</h3>
          {description ? <p className="muted-text compact">{description}</p> : null}
        </div>
        <Badge tone={tone}>{count} cartas</Badge>
      </div>

      <div className="zone-container__body">
        <div className="zone-stack">
          {stackPreview.map((_, index) => (
            <div className="zone-stack__card" key={`${title}-${index}`} style={{ opacity: 1 - index * 0.12 }} />
          ))}
        </div>
        <span className="zone-container__count">{count ? `${count} itens na zona` : 'Zona vazia'}</span>
      </div>
    </Card>
  );
}
