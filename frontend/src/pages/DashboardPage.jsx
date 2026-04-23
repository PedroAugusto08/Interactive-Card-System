import { Link } from 'react-router-dom';

import { useAuthStore } from '../stores/authStore';

// Painel inicial apos login.
export function DashboardPage() {
  const user = useAuthStore((state) => state.user);

  return (
    <section className="stack-gap">
      <article className="card">
        <h1>Dashboard</h1>
        <p>
          Bem-vindo, <strong>{user?.username || 'Jogador'}</strong>.
        </p>
        <p className="muted-text">Aqui voce gerencia seu fluxo entre decks, lobby e partida.</p>
      </article>

      <article className="grid-2">
        <Link className="card action-card" to="/decks">
          <h2>Decks</h2>
          <p>Crie e edite seus baralhos.</p>
        </Link>

        <Link className="card action-card" to="/lobby">
          <h2>Lobby</h2>
          <p>Crie sala, entre por codigo e veja jogadores.</p>
        </Link>

        <Link className="card action-card" to="/match">
          <h2>Partida</h2>
          <p>Conecte no socket e acompanhe atualizacoes em tempo real.</p>
        </Link>
      </article>
    </section>
  );
}
