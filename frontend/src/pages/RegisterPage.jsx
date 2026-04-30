import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { authApi } from '../api/authApi';
import { useAuthStore } from '../stores/authStore';
import { formatErrorMessage } from '../utils/formatError';

// Tela de cadastro de novo usuário.
export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await authApi.register({ username, email, password });
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
          <span className="auth-eyebrow">Nova Vinculação</span>
          <h1>Criar conta</h1>
          <p className="muted-text">Cadastre-se para criar ou entrar em salas.</p>

          <Input
            id="register-username"
            label="Nome de usuário"
            onChange={(event) => setUsername(event.target.value)}
            required
            type="text"
            value={username}
          />

          <Input
            id="register-email"
            label="Email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />

          <Input
            id="register-password"
            label="Senha"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <Button loading={isLoading} type="submit">
            {isLoading ? 'Criando conta...' : 'Cadastrar'}
          </Button>

          <p className="muted-text compact">
            Já tem conta? <Link to="/login">Entrar</Link>
          </p>
        </form>
      </Card>
    </section>
  );
}
