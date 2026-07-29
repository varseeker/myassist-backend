import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CommentsModule } from './comments/comments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagingModule } from './messaging/messaging.module';
import { RealtimeModule } from './realtime/realtime.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { HealthModule } from './health/health.module';
import { OpsAlertModule } from './ops-alert/ops-alert.module';
import { PrismaModule } from './prisma/prisma.module';
import { RolesModule } from './roles/roles.module';
import { StorageModule } from './storage/storage.module';
import { ProjectsModule } from './projects/projects.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    MessagingModule,
    OpsAlertModule,
    HealthModule,
    UsersModule,
    RolesModule,
    ProjectsModule,
    TicketsModule,
    CommentsModule,
    AttachmentsModule,
    NotificationsModule,
    RealtimeModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
