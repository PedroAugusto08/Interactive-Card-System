import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedLayout } from '../components/ProtectedLayout';
import { DashboardPage } from '../pages/DashboardPage';
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
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />

      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />

      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/lobby" element={<RoomLobbyPage />} />
          <Route path="/match" element={<MatchPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
