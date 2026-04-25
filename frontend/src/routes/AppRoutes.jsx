import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedLayout } from '../components/ProtectedLayout';
import { DecksPage } from '../pages/DecksPage';
import { LoginPage } from '../pages/LoginPage';
import { MatchPage } from '../pages/MatchPage';
import { RegisterPage } from '../pages/RegisterPage';
import { RoomLobbyPage } from '../pages/RoomLobbyPage';
import { useAuthStore } from '../stores/authStore';
import { ProtectedRoute } from './ProtectedRoute';

// Define todas as rotas da aplicacao.
export function AppRoutes() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={isAuthenticated ? '/lobby' : '/login'} replace />}
      />

      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/lobby" replace /> : <LoginPage />}
      />

      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/lobby" replace /> : <RegisterPage />}
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/lobby" element={<RoomLobbyPage />} />
          <Route path="/dashboard" element={<Navigate to="/lobby" replace />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/match" element={<MatchPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
