import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../stores/authStore';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

// Layout principal das telas privadas com menu superior.
export function ProtectedLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-panel">
          <Badge className="brand-chip" tone="accent">
            Arcane Dark UI
          </Badge>
          <p className="brand">Acedia Deck App</p>
          <p className="brand-subtitle">Deck building, lobby e partida em tempo real</p>
        </div>

        <nav className="menu-links">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/decks">Decks</NavLink>
          <NavLink to="/lobby">Lobby</NavLink>
          <NavLink to="/match">Partida</NavLink>
        </nav>

        <div className="topbar-right">
          <div className="welcome-stack">
            <p className="welcome-text">{user?.username || 'Jogador'}</p>
            <span className="muted-text compact">Sessao autenticada</span>
          </div>

          <Button onClick={handleLogout} size="sm" variant="secondary">
            Sair
          </Button>
        </div>
      </header>

      <main className="page-area">
        <Outlet />
      </main>
    </div>
  );
}
