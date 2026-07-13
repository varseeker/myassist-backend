import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { Prisma, RoleType } from '@prisma/client';
import {
  createTelegramLinkToken,
  normalizePhoneNumber,
} from '../messaging/messaging.utils';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  AuthenticatedUser,
  JwtPayload,
  REFRESH_TOKEN_COOKIE,
} from './interfaces/auth.interface';
import {
  generateSecureToken,
  hashToken,
  parseExpiresIn,
} from './utils/token.util';
import { normalizeUsername } from '../common/utils/username.util';

@Injectable()
export class AuthService {
  private readonly refreshExpiresIn: string;
  private readonly isDevelopment: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    this.isDevelopment =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'development';
  }

  async login(dto: LoginDto, res: Response) {
    const user = await this.validateUser(dto.username, dto.password);
    const tokens = await this.issueTokens(user, res);

    return tokens;
  }

  async register(dto: RegisterDto) {
    const email = dto.email?.trim() ? dto.email.trim().toLowerCase() : null;
    const username = normalizeUsername(dto.username);

    const existingUser = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ username }, ...(email ? [{ email }] : [])],
      },
    });

    if (existingUser) {
      if (email && existingUser.email === email) {
        throw new ConflictException('Email is already registered');
      }
      throw new ConflictException('Username is already taken');
    }

    const role = await this.prisma.role.findFirst({
      where: { name: RoleType.USER, deletedAt: null },
    });

    if (!role) {
      throw new BadRequestException('USER role is not configured');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        roleId: role.id,
        telegramLinkToken: createTelegramLinkToken(),
      },
    });

    return {
      message:
        'Registration successful. Please sign in. An admin will assign you to a project.',
    };
  }

  async logout(userId: string, refreshToken: string | undefined, res: Response) {
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await this.prisma.refreshToken.deleteMany({
        where: { userId, token: tokenHash },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }

    this.clearRefreshCookie(res);

    return { message: 'Logged out successfully' };
  }

  async refresh(refreshToken: string | undefined, res: Response) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    const tokenHash = hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: {
        user: {
          include: { role: true },
        },
      },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = storedToken.user;

    if (!user.isActive || user.deletedAt) {
      throw new UnauthorizedException('User is inactive');
    }

    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      role: user.role.name,
      isActive: user.isActive,
    };

    return this.issueTokens(authenticatedUser, res);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: {
        role: true,
        userProjects: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.telegramLinkToken) {
      const token = createTelegramLinkToken();
      await this.prisma.user.update({
        where: { id: user.id },
        data: { telegramLinkToken: token },
      });
      user.telegramLinkToken = token;
    }

    return this.mapUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.username !== undefined) {
      const username = normalizeUsername(dto.username);
      const taken = await this.prisma.user.findFirst({
        where: {
          username,
          deletedAt: null,
          NOT: { id: userId },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException('Username is already taken');
      }
      data.username = username;
    }

    if (dto.email !== undefined) {
      if (dto.email === null) {
        data.email = null;
      } else {
        const email = dto.email.trim().toLowerCase();
        const taken = await this.prisma.user.findFirst({
          where: {
            email,
            deletedAt: null,
            NOT: { id: userId },
          },
          select: { id: true },
        });
        if (taken) {
          throw new ConflictException('Email is already registered');
        }
        data.email = email;
      }
    }

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }

    if (dto.phoneNumber !== undefined) {
      if (dto.phoneNumber === null) {
        data.phoneNumber = null;
      } else {
        const normalized = normalizePhoneNumber(dto.phoneNumber);
        if (!normalized) {
          throw new BadRequestException('Invalid phone number format');
        }
        data.phoneNumber = normalized;
      }
    }

    if (dto.whatsappEnabled !== undefined) {
      data.whatsappEnabled = dto.whatsappEnabled;
    }

    if (dto.telegramChatId !== undefined) {
      data.telegramChatId =
        dto.telegramChatId === null ? null : dto.telegramChatId.trim();
    }

    if (dto.telegramEnabled !== undefined) {
      data.telegramEnabled = dto.telegramEnabled;
    }

    if (!user.telegramLinkToken) {
      data.telegramLinkToken = createTelegramLinkToken();
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return this.getProfile(userId);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        deletedAt: null,
        isActive: true,
      },
    });

    if (!user) {
      return {
        message:
          'If an account exists with this email, a password reset link has been sent.',
      };
    }

    const plainToken = generateSecureToken();
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const response: { message: string; resetToken?: string } = {
      message:
        'If an account exists with this email, a password reset link has been sent.',
    };

    if (this.isDevelopment) {
      response.resetToken = plainToken;
    }

    return response;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = hashToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt < new Date() ||
      resetToken.user.deletedAt ||
      !resetToken.user.isActive
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    return { message: 'Password reset successfully' };
  }

  private async validateUser(username: string, password: string) {
    let normalizedUsername: string;
    try {
      normalizedUsername = normalizeUsername(username);
    } catch {
      throw new UnauthorizedException('Username atau password salah');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        username: normalizedUsername,
        deletedAt: null,
      },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Username atau password salah');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Username atau password salah');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      role: user.role.name,
      isActive: user.isActive,
    } satisfies AuthenticatedUser;
  }

  private async issueTokens(user: AuthenticatedUser, res: Response) {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.createRefreshToken(user.id);

    this.setRefreshCookie(res, refreshToken);

    return {
      accessToken,
      user: await this.getProfile(user.id),
    };
  }

  private async createRefreshToken(userId: string) {
    const plainToken = generateSecureToken();
    const tokenHash = hashToken(plainToken);
    const expiresAt = new Date(
      Date.now() + parseExpiresIn(this.refreshExpiresIn),
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: tokenHash,
        expiresAt,
      },
    });

    return plainToken;
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      maxAge: parseExpiresIn(this.refreshExpiresIn),
      path: '/',
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
  }

  private mapUser(user: {
    id: string;
    username: string;
    email: string | null;
    fullName: string;
    roleId: string;
    isActive: boolean;
    phoneNumber?: string | null;
    whatsappEnabled?: boolean;
    telegramChatId?: string | null;
    telegramEnabled?: boolean;
    telegramLinkToken?: string | null;
    role: { name: RoleType };
    userProjects?: Array<{
      project: {
        id: string;
        name: string;
        code: string;
        isActive: boolean;
        deletedAt: Date | null;
      };
    }>;
  }) {
    const botUsername =
      this.configService.get<string>('TELEGRAM_BOT_USERNAME')?.trim() || null;
    const telegramLinkToken = user.telegramLinkToken ?? null;
    const telegramDeepLink =
      botUsername && telegramLinkToken
        ? `https://t.me/${botUsername}?start=${telegramLinkToken}`
        : null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      role: user.role.name,
      isActive: user.isActive,
      phoneNumber: user.phoneNumber ?? null,
      whatsappEnabled: user.whatsappEnabled ?? true,
      telegramChatId: user.telegramChatId ?? null,
      telegramEnabled: user.telegramEnabled ?? true,
      telegramLinkToken,
      telegramDeepLink,
      telegramLinked: Boolean(user.telegramChatId),
      projects: user.userProjects
        ?.filter((item) => item.project.deletedAt === null)
        .map((item) => ({
          id: item.project.id,
          name: item.project.name,
          code: item.project.code,
          isActive: item.project.isActive,
        })),
    };
  }

  private mapUserFromAuth(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
