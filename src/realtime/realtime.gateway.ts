import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/interfaces/auth.interface';
import { PrismaService } from '../prisma/prisma.service';
import { USER_ROOM_PREFIX } from './realtime.events';
import { RealtimeService } from './realtime.service';

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim());

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtimeService.setServer(server);
    this.logger.log('Realtime gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;

      if (!token) {
        throw new Error('Missing access token');
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      const user = await this.prisma.user.findFirst({
        where: {
          id: payload.sub,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });

      if (!user) {
        throw new Error('User not found or inactive');
      }

      await client.join(`${USER_ROOM_PREFIX}${user.id}`);
      client.data.userId = user.id;
    } catch (error) {
      this.logger.warn(
        `Rejected socket connection: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      client.disconnect(true);
    }
  }
}
