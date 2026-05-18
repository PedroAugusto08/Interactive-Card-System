import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedLayout } from '../components/ProtectedLayout';
import { CharactersPage } from '../pages/CharactersPage';
import { LoginPage } from '../pages/LoginPage';
import { MatchPage } from '../pages/MatchPage';
import { RegisterPage } from '../pages/RegisterPage';
import { RoomLobbyPage } from '../pages/RoomLobbyPage';
import { useAuthStore } from '../stores/authStore';
import { ProtectedRoute } from './ProtectedRoute';

export function AppRoutes() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return (
    <Routes>
      <Route path="/" element={<Navigate to={isAuthenticated ? '/lobby' : '/login'} replace />} />

      <Route path="/login" element={isAuthenticated ? <Navigate to="/lobby" replace /> : <LoginPage />} />

      <Route path="/register" element={isAuthenticated ? <Navigate to="/lobby" replace /> : <RegisterPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/lobby" element={<RoomLobbyPage />} />
          <Route path="/dashboard" element={<Navigate to="/lobby" replace />} />
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/decks" element={<Navigate to="/characters" replace />} />
          <Route path="/match" element={<MatchPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
