import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { authApi } from '../api/authApi';
import { useAuthStore } from '../stores/authStore';
import { formatErrorMessage } from '../utils/formatError';

// Tela de cadastro de novo usuario.
export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Envia cadastro para API e ja autentica localmente.
  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await authApi.register({ username, email, password });
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
        <h1>Criar conta</h1>
        <p className="muted-text">Cadastre-se para criar ou entrar em salas.</p>

        <label htmlFor="register-username">Nome de usuario</label>
        <input
          id="register-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />

        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label htmlFor="register-password">Senha</label>
        <input
          id="register-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button className="solid-btn" type="submit" disabled={isLoading}>
          {isLoading ? 'Criando conta...' : 'Cadastrar'}
        </button>

        <p className="muted-text compact">
          Ja tem conta? <Link to="/login">Entrar</Link>
        </p>
      </form>
    </section>
  );
}
