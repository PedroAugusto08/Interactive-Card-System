import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../stores/authStore';

// Layout principal das telas privadas com menu superior.
export function ProtectedLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  // Faz logout local e manda para tela de login.
  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">Acedia Deck App</p>
          <p className="brand-subtitle">Gerenciamento multiplayer de baralho</p>
        </div>

        <nav className="menu-links">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/decks">Decks</NavLink>
          <NavLink to="/lobby">Lobby</NavLink>
          <NavLink to="/match">Partida</NavLink>
        </nav>

        <div className="topbar-right">
          <p className="welcome-text">{user?.username || 'Jogador'}</p>
          <button className="ghost-btn" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <main className="page-area">
        <Outlet />
      </main>
    </div>
  );
}
