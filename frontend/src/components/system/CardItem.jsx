import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

export function CardItem({
  name,
  description,
  imageSrc,
  category,
  maxCopies,
  selected = false,
  footer,
  showDescription = true,
  onClick,
}) {
  return (
    <Card
      className="game-card"
      compact
      glow={selected}
      interactive={Boolean(onClick)}
      selected={selected}
    >
      <div className="game-card__image-wrap">
        <button
          aria-label={`Abrir detalhes da carta ${name}`}
          className="game-card__hitbox"
          onClick={onClick}
          type="button"
        >
          <img alt={`Carta ${name}`} className="game-card__image" loading="lazy" src={imageSrc} />
        </button>
      </div>

      <div className="game-card__meta">
        <div className="row-wrap game-card__badges">
          {category ? <Badge tone="secondary">{category}</Badge> : null}
          {selected ? <Badge tone="primary">Selecionada</Badge> : null}
          {typeof maxCopies === 'number' ? <Badge tone="accent">Max {maxCopies}</Badge> : null}
        </div>

        <h3>{name}</h3>
        {showDescription ? <p className="game-card__description">{description}</p> : null}
      </div>

      {footer ? <div className="game-card__footer">{footer}</div> : null}
    </Card>
  );
}
