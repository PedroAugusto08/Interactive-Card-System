import { Link } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { useAuthStore } from '../stores/authStore';

// Painel inicial apos login.
export function DashboardPage() {
  const user = useAuthStore((state) => state.user);

  return (
    <section className="stack-gap-lg">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Bem-vindo, {user?.username || 'Jogador'}!</p>
        </div>
      </div>


      <Card description="Escolha rapidamente o módulo que você quer abrir." title="Atalhos">
        <div className="grid-2">
          <Link className="panel-link ui-card ui-card--interactive" to="/decks">
            <div className="ui-card__content">
              <div className="panel-link-icon">D</div>
              <h2>Decks</h2>
              <p className="muted-text">Crie, ajuste e refine seu baralho com visualização clara.</p>
            </div>
          </Link>

          <Link className="panel-link ui-card ui-card--interactive" to="/lobby">
            <div className="ui-card__content">
              <div className="panel-link-icon">L</div>
              <h2>Lobby</h2>
              <p className="muted-text">Gerencie salas, jogadores e o acesso por código.</p>
            </div>
          </Link>

          <Link className="panel-link ui-card ui-card--interactive" to="/match">
            <div className="ui-card__content">
              <div className="panel-link-icon">M</div>
              <h2>Partida</h2>
              <p className="muted-text">Veja jogadores, zonas e log em um layout focado na partida.</p>
            </div>
          </Link>
        </div>
      </Card>
    </section>
  );
}
