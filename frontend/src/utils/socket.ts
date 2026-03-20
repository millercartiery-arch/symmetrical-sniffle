import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
const DEFAULT_REMOTE_URL = 'https://hkd.llc';

export const initSocket = () => {
  if (socket) return socket;

  const configuredSocketBase = import.meta.env.VITE_SOCKET_BASE_URL?.trim();
  const configuredApiBase = import.meta.env.VITE_API_URL?.trim();
  // 未配置时用当前 origin，支持用 IP 或域名访问
  const useSameOrigin =
    configuredSocketBase === undefined || configuredSocketBase === '';
  const API_URL = useSameOrigin
    ? window.location.origin
    : configuredSocketBase || configuredApiBase || DEFAULT_REMOTE_URL;

  socket = io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket?.id);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  return socket;
};

export const getSocket = () => {
  if (!socket) {
    return initSocket();
  }
  return socket;
};
