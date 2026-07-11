import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { RoleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
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
    const user = await this.validateUser(dto.email, dto.password);
    const tokens = await this.issueTokens(user, res);

    return tokens;
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

    return this.mapUser(user);
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

  private async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        deletedAt: null,
      },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      id: user.id,
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
    email: string;
    fullName: string;
    roleId: string;
    isActive: boolean;
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
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      role: user.role.name,
      isActive: user.isActive,
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
