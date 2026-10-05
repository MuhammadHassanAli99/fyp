import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { loggerFor } from '../config/logger';
import { verifyAccessToken } from '../core/security/tokens';
import { heartbeat, socketConnected, socketDisconnected } from '../modules/chat/presence.service';
import type { PresenceStatus } from '../modules/chat/chat.types';

const log = loggerFor('realtime');

let io: Server | null = null;

const typingLast = new Map<string, number>();
const TYPING_MIN_INTERVAL_MS = 1500;

function userIdOf(socket: Socket): number | null {
  const value = socket.data.userId as number | undefined;
  return typeof value === 'number' && value > 0 ? value : null;
}

/**
 * Socket.io gateway. JWT is the same access token as REST.
 * Room naming: `user:{id}`, `conversation:{uuid}`, `marketplace:{code}`, `auction:{uuid}`.
 *
 * Chat/call events require a verified user. Auction rooms remain joinable with a token
 * so live bidding can ride the same gateway.
 */
export function attachRealtime(server: HttpServer): Server {
  if (io) return io;

  io = new Server(server, {
    path: `${env.API_PREFIX}/realtime`,
    cors: { origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ?? (socket.handshake.query.token as string | undefined);
    if (!token) return next();
    try {
      const claims = verifyAccessToken(token);
      socket.data.userId = Number(claims.sub);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = userIdOf(socket);
    if (userId) {
      socket.join(`user:${userId}`);
      void socketConnected(userId).then(() => {
        io?.to(`user:${userId}`).emit('presence:self', { status: 'online' });
      });
    }

    socket.on('join:conversation', (conversationUuid: string) => {
      void (async () => {
        if (typeof conversationUuid !== 'string' || !userId) return;
        try {
          const { requireConversation } = await import('../modules/chat/chat.access');
          const { markDelivered } = await import('../modules/chat/chat.service');
          const conversation = await requireConversation(conversationUuid, userId);
          socket.join(`conversation:${conversationUuid}`);
          await markDelivered(Number(conversation.id), userId);
        } catch (error) {
          log.debug({ err: error, userId }, 'join:conversation denied');
          socket.emit('error', { code: 'FORBIDDEN', message: 'Cannot join conversation' });
        }
      })();
    });

    socket.on('leave:conversation', (conversationUuid: string) => {
      if (typeof conversationUuid === 'string') socket.leave(`conversation:${conversationUuid}`);
    });

    socket.on('typing:start', (payload: { conversationUuid?: string }) => {
      if (!userId || !payload?.conversationUuid) return;
      const key = `${userId}:${payload.conversationUuid}`;
      const last = typingLast.get(key) ?? 0;
      if (Date.now() - last < TYPING_MIN_INTERVAL_MS) return;
      typingLast.set(key, Date.now());
      socket.to(`conversation:${payload.conversationUuid}`).emit('typing:start', {
        userId,
        conversationUuid: payload.conversationUuid,
      });
    });

    socket.on('typing:stop', (payload: { conversationUuid?: string }) => {
      if (!userId || !payload?.conversationUuid) return;
      socket.to(`conversation:${payload.conversationUuid}`).emit('typing:stop', {
        userId,
        conversationUuid: payload.conversationUuid,
      });
    });

    socket.on('presence:ping', (payload: { status?: PresenceStatus } | undefined) => {
      if (!userId) return;
      const status = payload?.status === 'away' ? 'away' : 'online';
      void heartbeat(userId, status);
    });

    socket.on('message:send', (payload: Record<string, unknown>) => {
      void (async () => {
        if (!userId) return;
        try {
          const { getConversationByUuid, sendMessage } = await import('../modules/chat/chat.service');
          const conversationUuid = String(payload.conversationUuid ?? '');
          const conversation = await getConversationByUuid(conversationUuid, userId);
          const message = await sendMessage({
            conversationId: conversation.id,
            senderId: userId,
            kind: (payload.kind as 'text') ?? 'text',
            body: typeof payload.body === 'string' ? payload.body : null,
            clientMessageId: typeof payload.clientMessageId === 'string' ? payload.clientMessageId : null,
            replyToId: typeof payload.replyToId === 'number' ? payload.replyToId : null,
          });
          socket.emit('message:ack', { clientMessageId: payload.clientMessageId ?? null, message });
        } catch (error) {
          log.warn({ err: error, userId }, 'message:send failed');
          socket.emit('message:error', { clientMessageId: payload.clientMessageId ?? null });
        }
      })();
    });

    socket.on('call:signal', (payload: { callUuid?: string; type?: string; payload?: unknown }) => {
      void (async () => {
        if (!userId || !payload?.callUuid || !payload.type) return;
        try {
          const { signalCall } = await import('../modules/calls/calls.service');
          await signalCall({
            callUuid: payload.callUuid,
            userId,
            type: payload.type as 'offer' | 'answer' | 'ice' | 'hangup' | 'ice-restart',
            payload: payload.payload,
          });
        } catch (error) {
          log.warn({ err: error, userId }, 'call:signal failed');
        }
      })();
    });

    socket.on('join:auction', (auctionUuid: string) => {
      if (typeof auctionUuid === 'string' && auctionUuid.length > 0 && auctionUuid.length <= 64) {
        socket.join(`auction:${auctionUuid}`);
      }
    });

    socket.on('leave:auction', (auctionUuid: string) => {
      if (typeof auctionUuid === 'string') socket.leave(`auction:${auctionUuid}`);
    });

    socket.on('disconnect', () => {
      if (userId) void socketDisconnected(userId);
      log.debug({ socketId: socket.id, userId }, 'socket disconnected');
    });
  });

  log.info({ path: `${env.API_PREFIX}/realtime` }, 'realtime gateway listening');
  return io;
}

export function getRealtime(): Server | null {
  return io;
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => {
    io!.close(() => resolve());
  });
  io = null;
}

export function emitToAuction(auctionUuid: string, event: string, payload: unknown): void {
  io?.to(`auction:${auctionUuid}`).emit(event, payload);
}

export function emitToUser(userId: number, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToConversation(conversationUuid: string, event: string, payload: unknown): void {
  io?.to(`conversation:${conversationUuid}`).emit(event, payload);
}

export function isUserConnected(userId: number): boolean {
  return Boolean(io?.sockets.adapter.rooms.get(`user:${userId}`)?.size);
}
