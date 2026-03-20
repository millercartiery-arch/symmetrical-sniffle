
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import IORedis from 'ioredis';

let io: Server;

/** Stop reconnecting after first failure when Redis is not running (avoids log flood). */
const retryStrategy = process.env.DEBUG_REDIS === 'true'
  ? undefined
  : () => null;

const subRedis = new (IORedis as any)(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  retryStrategy,
  lazyConnect: true,
});

subRedis.on('error', () => {
  if (process.env.DEBUG_REDIS === 'true') {
    console.error('Redis subscription error');
  }
});

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // Allow all origins for now (including Tauri's file://)
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('join-room', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Subscribe to Redis events from workers
  subRedis.subscribe('task:update', (err) => {
    if (err) console.error('Failed to subscribe to task:update', err);
  });
  subRedis.subscribe('account:update', (err) => {
    if (err) console.error('Failed to subscribe to account:update', err);
  });

  subRedis.on('message', (channel, message) => {
    if (channel === 'task:update') {
      try {
        const payload = JSON.parse(message);
        io.emit('task:update', payload);
      } catch (e) {
        console.error('Error parsing task update message', e);
      }
    } else if (channel === 'account:update') {
      try {
        const payload = JSON.parse(message);
        io.emit('account:update', payload);
      } catch (e) {
        console.error('Error parsing account update message', e);
      }
    }
  });

  console.log('Socket.io initialized');
  return io;
}

export function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}
