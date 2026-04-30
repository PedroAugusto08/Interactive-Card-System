import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { authApi } from '../api/authApi';
import { useAuthStore } from '../stores/authStore';
import { formatErrorMessage } from '../utils/formatError';

// Tela de login do usuário.
export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await authApi.login({ email, password });
      setAuth(response.token, response.user);
      navigate('/lobby', { replace: true });
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="auth-wrap">
      <Card className="auth-card" glow>
        <form className="auth-card-inner" onSubmit={handleSubmit}>
          <span className="auth-eyebrow">Portal Arcano</span>
          <h1>Entrar</h1>
          <p className="muted-text">Acesse sua conta para entrar nas salas do RPG.</p>

          <Input
            id="login-email"
            label="Email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />

          <Input
            id="login-password"
            label="Senha"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <Button loading={isLoading} type="submit">
            {isLoading ? 'Entrando...' : 'Entrar'}
          </Button>

          <p className="muted-text compact">
            Não tem conta? <Link to="/register">Criar conta</Link>
          </p>
        </form>
      </Card>
    </section>
  );
}
