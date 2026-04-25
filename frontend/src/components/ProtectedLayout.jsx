import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAuthStore } from '../stores/authStore';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

// Layout principal das telas privadas com menu superior.
export function ProtectedLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setUsername(user?.username || '');
    setEmail(user?.email || '');
    setPassword('');
  }, [user?.email, user?.username]);

  useEffect(() => {
    if (!isProfileOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsProfileOpen(false);
        setActiveSection('');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProfileOpen]);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  function toggleProfileSidebar() {
    setIsProfileOpen((previous) => {
      const nextOpen = !previous;
      if (!nextOpen) {
        setActiveSection('');
      }

      return nextOpen;
    });
  }

  function closeProfileSidebar() {
    setIsProfileOpen(false);
    setActiveSection('');
  }

  function handleUsernameSubmit(event) {
    event.preventDefault();
    const nextUsername = username.trim();
    if (!nextUsername) {
      return;
    }

    updateUser({ username: nextUsername });
    setActiveSection('');
  }

  function handleEmailSubmit(event) {
    event.preventDefault();
    const nextEmail = email.trim();
    const nextPassword = password.trim();
    if (!nextEmail && !nextPassword) {
      return;
    }

    updateUser({
      ...(nextEmail ? { email: nextEmail } : {}),
      ...(nextPassword ? { password: nextPassword } : {}),
    });
    setPassword('');
    setActiveSection('');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <nav className="menu-links">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/decks">Decks</NavLink>
          <NavLink to="/lobby">Lobby</NavLink>
          <NavLink to="/match">Partida</NavLink>
        </nav>

        <div className="topbar-right">
          <button
            aria-controls="profile-sidebar"
            aria-expanded={isProfileOpen}
            aria-label="Abrir menu do usuario"
            className="profile-trigger"
            onClick={toggleProfileSidebar}
            type="button"
          >
            <span aria-hidden="true" className="profile-trigger__icon">
              <span className="profile-trigger__head" />
              <span className="profile-trigger__body" />
            </span>
          </button>
        </div>
      </header>

      {isProfileOpen ? (
        <button
          aria-label="Fechar menu do usuario"
          className="profile-overlay"
          onClick={closeProfileSidebar}
          type="button"
        />
      ) : null}

      <aside className={['profile-sidebar', isProfileOpen ? 'is-open' : ''].join(' ')} id="profile-sidebar">
        <div className="profile-sidebar__header">
          <div className="stack-gap" style={{ gap: '6px' }}>
            <p className="welcome-text">Bem vindo, {user?.username || 'Jogador'}!</p>
            <span className="muted-text compact">{user?.email || 'Sem login cadastrado'}</span>
          </div>

          <button aria-label="Fechar menu do usuario" className="profile-close" onClick={closeProfileSidebar} type="button">
            X
          </button>
        </div>

        <div className="profile-sidebar__actions">
          <Button
            className="profile-action"
            onClick={() => setActiveSection(activeSection === 'username' ? '' : 'username')}
            variant="secondary"
          >
            Alterar nome de usuario
          </Button>

          {activeSection === 'username' ? (
            <form className="profile-form" onSubmit={handleUsernameSubmit}>
              <Input
                label="Novo nome"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Digite o nome do usuario"
                value={username}
              />

              <Button type="submit">Salvar nome</Button>
            </form>
          ) : null}

          <Button
            className="profile-action"
            onClick={() => setActiveSection(activeSection === 'email' ? '' : 'email')}
            variant="secondary"
          >
            Alterar login
          </Button>

          {activeSection === 'email' ? (
            <form className="profile-form" onSubmit={handleEmailSubmit}>
              <Input
                label="Novo login"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Digite o login"
                type="email"
                value={email}
              />

              <Input
                label="Nova senha"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite a nova senha"
                type="password"
                value={password}
              />

              <Button type="submit">Salvar login e senha</Button>
            </form>
          ) : null}

          <Button className="profile-action" onClick={handleLogout} variant="danger">
            Sair
          </Button>
        </div>
      </aside>

      <main className="page-area">
        <Outlet />
      </main>
    </div>
  );
}
