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
          <Badge tone="primary">Command Center</Badge>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Bem-vindo, <strong>{user?.username || 'Jogador'}</strong>. Seu fluxo de decks, salas e
            partida agora vive em uma interface dark, limpa e com um toque arcano.
          </p>
        </div>
      </div>

      <div className="stats-grid">
        <Card glow description="Monte composicoes validas com feedback visual em tempo real." title="Deck Builder">
          <Badge tone="secondary">Catalogo oficial</Badge>
        </Card>
        <Card glow description="Crie ou entre em salas com sincronizacao entre jogadores." title="Lobby">
          <Badge tone="success">Multiplayer</Badge>
        </Card>
        <Card glow description="Acompanhe o estado da partida e o log em uma tela dedicada." title="Match">
          <Badge tone="accent">Tempo real</Badge>
        </Card>
      </div>

      <Card description="Escolha rapidamente o modulo que voce quer abrir." title="Atalhos">
        <div className="grid-2">
          <Link className="panel-link ui-card ui-card--interactive" to="/decks">
            <div className="ui-card__content">
              <div className="panel-link-icon">D</div>
              <h2>Decks</h2>
              <p className="muted-text">Crie, ajuste e refine seus baralhos com visualizacao clara.</p>
            </div>
          </Link>

          <Link className="panel-link ui-card ui-card--interactive" to="/lobby">
            <div className="ui-card__content">
              <div className="panel-link-icon">L</div>
              <h2>Lobby</h2>
              <p className="muted-text">Gerencie salas, jogadores e o acesso por codigo.</p>
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
