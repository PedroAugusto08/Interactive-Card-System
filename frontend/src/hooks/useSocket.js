import { useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// Cria e conecta socket autenticado com o JWT atual.
export function useSocket(token) {
  const socket = useMemo(() => {
    if (!token) {
      return null;
    }

    return io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
    });
  }, [token]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return socket;
}
