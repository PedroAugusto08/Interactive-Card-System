import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { authApi } from '../api/authApi';
import { useAuthStore } from '../stores/authStore';
import { formatErrorMessage } from '../utils/formatError';

// Tela de login do usuario.
export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Envia login para API e guarda token no store.
  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await authApi.login({ email, password });
      setAuth(response.token, response.user);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Entrar</h1>
        <p className="muted-text">Acesse sua conta para entrar nas salas do RPG.</p>

        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="login-password">Senha</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button className="solid-btn" type="submit" disabled={isLoading}>
          {isLoading ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="muted-text compact">
          Nao tem conta? <Link to="/register">Criar conta</Link>
        </p>
      </form>
    </section>
  );
}
