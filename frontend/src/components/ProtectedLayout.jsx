import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';

import { useAuthStore } from '../stores/authStore';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

// Layout principal das telas privadas com menu superior.
export function ProtectedLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [displayedOutlet, setDisplayedOutlet] = useState(outlet);
  const [displayedPath, setDisplayedPath] = useState(location.pathname);
  const [pageTransitionStage, setPageTransitionStage] = useState('enter');
  const userInitial = (user?.username || user?.email || 'J').trim().charAt(0).toUpperCase();
  const fileInputRef = useRef(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setUsername(user?.username || '');
      setEmail(user?.email || '');
      setPassword('');
    }, 0);

    return () => window.clearTimeout(timeoutId);
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

  useEffect(() => {
    if (location.pathname === displayedPath) {
      return undefined;
    }

    const exitTimeoutId = window.setTimeout(() => {
      setPageTransitionStage('exit');
    }, 0);

    const swapTimeoutId = window.setTimeout(() => {
      setDisplayedOutlet(outlet);
      setDisplayedPath(location.pathname);
      setPageTransitionStage('enter');
    }, 150);

    return () => {
      window.clearTimeout(exitTimeoutId);
      window.clearTimeout(swapTimeoutId);
    };
  }, [displayedPath, location.pathname, outlet]);

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

  function handleOpenPhotoPicker() {
    fileInputRef.current?.click();
  }

  function handleProfileImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateUser({ profileImage: reader.result });
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function handleRemoveProfileImage() {
    updateUser({ profileImage: '' });
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
        <div className="topbar-left">
          <div className="topbar-brand" aria-label="Acedia Deck">
            <span aria-hidden="true" className="topbar-brand__mark">
              <span className="topbar-brand__mark-core" />
            </span>
            <div className="topbar-brand__copy">
              <strong className="topbar-brand__name">Acedia</strong>
              <span className="topbar-brand__subtitle">Deck System</span>
            </div>
          </div>

          <nav className="menu-links">
            <NavLink
              className={({ isActive }) =>
                ['topbar-nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              to="/lobby"
            >
              Lobby
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                ['topbar-nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              to="/decks"
            >
              Decks
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                ['topbar-nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              to="/match"
            >
              Partida
            </NavLink>
          </nav>
        </div>

        <div className="topbar-right">
          <button
            aria-controls="profile-sidebar"
            aria-expanded={isProfileOpen}
            aria-label="Abrir menu do usuario"
            className="profile-trigger"
            onClick={toggleProfileSidebar}
            type="button"
          >
            {user?.profileImage ? (
              <img
                alt={`Foto de perfil de ${user?.username || 'Jogador'}`}
                className="profile-trigger__avatar profile-trigger__avatar--image"
                src={user.profileImage}
              />
            ) : (
              <span aria-hidden="true" className="profile-trigger__avatar">
                {userInitial}
              </span>
            )}
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
          <div className="profile-identity-card">
            {user?.profileImage ? (
              <img
                alt={`Foto de perfil de ${user?.username || 'Jogador'}`}
                className="profile-identity-card__avatar profile-identity-card__avatar--image"
                src={user.profileImage}
              />
            ) : (
              <div className="profile-identity-card__avatar">{userInitial}</div>
            )}
            <div className="profile-identity-card__copy">
              <strong className="profile-identity-card__name">{user?.username || 'Jogador'}</strong>
              <span className="profile-identity-card__email">{user?.email || 'Sem login cadastrado'}</span>
              <span className="profile-identity-card__status">
                <span aria-hidden="true" className="profile-identity-card__status-dot" />
                Online
              </span>
            </div>
          </div>

          <button aria-label="Fechar menu do usuario" className="profile-close" onClick={closeProfileSidebar} type="button">
            ×
          </button>
        </div>

        <div className="profile-sidebar__section">
          <span className="profile-section-label">Conta</span>

          <div className="profile-sidebar__actions">
            <input
              accept="image/*"
              className="sr-only"
              onChange={handleProfileImageChange}
              ref={fileInputRef}
              type="file"
            />

            <Button
              className="profile-action"
              onClick={() => setActiveSection(activeSection === 'photo' ? '' : 'photo')}
              type="button"
              variant="secondary"
            >
              Alterar foto de perfil
            </Button>

            {activeSection === 'photo' ? (
              <div className="profile-photo-card">
                <div className="profile-photo-card__preview">
                  {user?.profileImage ? (
                    <img
                      alt={`Preview da foto de perfil de ${user?.username || 'Jogador'}`}
                      className="profile-photo-card__image"
                      src={user.profileImage}
                    />
                  ) : (
                    <span className="profile-photo-card__fallback">{userInitial}</span>
                  )}
                </div>

                <div className="profile-photo-card__copy">
                  <strong>Foto de perfil</strong>
                  <span className="muted-text compact">
                    Use uma imagem quadrada para um resultado mais elegante.
                  </span>
                </div>

                <div className="profile-form__actions">
                  <Button onClick={handleOpenPhotoPicker} type="button" variant="secondary">
                    {user?.profileImage ? 'Trocar foto' : 'Enviar foto'}
                  </Button>
                  {user?.profileImage ? (
                    <Button onClick={handleRemoveProfileImage} type="button" variant="secondary">
                      Remover
                    </Button>
                  ) : (
                    <Button onClick={() => setActiveSection('')} type="button" variant="secondary">
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            ) : null}

            <Button
              className="profile-action"
              onClick={() => setActiveSection(activeSection === 'username' ? '' : 'username')}
              variant="secondary"
            >
              Alterar nome de usuario
            </Button>

            {activeSection === 'username' ? (
              <form className="profile-form profile-form--compact" onSubmit={handleUsernameSubmit}>
                <Input
                  label="Nome de usuario"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Digite o nome de usuario"
                  value={username}
                />

                <div className="profile-form__actions">
                  <Button onClick={() => setActiveSection('')} type="button" variant="secondary">
                    Cancelar
                  </Button>
                  <Button type="submit">Salvar</Button>
                </div>
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

                <div className="profile-form__actions">
                  <Button onClick={() => setActiveSection('')} type="button" variant="secondary">
                    Cancelar
                  </Button>
                  <Button type="submit">Salvar</Button>
                </div>
              </form>
            ) : null}
          </div>
        </div>

        <div className="profile-sidebar__section">
          <span className="profile-section-label">Sessao</span>

          <div className="profile-sidebar__actions">
            <Button className="profile-action" onClick={handleLogout} variant="danger">
              Sair
            </Button>
          </div>
        </div>
      </aside>

      <main className="page-area">
        <div className={['page-transition', `page-transition--${pageTransitionStage}`].join(' ')}>
          {displayedOutlet}
        </div>
      </main>
    </div>
  );
}
