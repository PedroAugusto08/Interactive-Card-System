import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export function DeckCardRow({ deck, isSelected = false, onEdit, onDelete }) {
  return (
    <Card className="deck-row-card" compact interactive selected={isSelected}>
      <div className="stack-gap" style={{ gap: '8px' }}>
        <div className="row-wrap">
          <h3>{deck.name}</h3>
          {isSelected ? <Badge tone="primary">Em edição</Badge> : null}
        </div>

        <p className="muted-text compact">{deck.description || 'Sem descrição'}</p>

        <div className="deck-row-card__summary">
          <Badge tone="accent">Total {deck.summary?.totalCards ?? 0}</Badge>
          <Badge tone="secondary">Fixa {deck.summary?.categoryTotals?.fixed ?? 0}</Badge>
          <Badge tone="secondary">Divisão {deck.summary?.categoryTotals?.division ?? 0}</Badge>
          <Badge tone="secondary">Imo {deck.summary?.categoryTotals?.imo ?? 0}</Badge>
        </div>
      </div>

      <div className="row-wrap">
        <Button onClick={() => onEdit?.(deck)} size="sm" variant="secondary">
          Editar
        </Button>
        <Button onClick={() => onDelete?.(deck)} size="sm" variant="danger">
          Excluir
        </Button>
      </div>
    </Card>
  );
}
