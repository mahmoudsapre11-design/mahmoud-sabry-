import { HandleErrors } from '../common/errors';
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { getRefreshSecret, REFRESH_TOKEN_TTL } from '../common/config/jwt.config';
import { safeUserSelect } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

interface TokenUser {
  id: number;
  email: string;
  role: Role;
}

@HandleErrors()
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Issues a short-lived access token + a long-lived refresh token.
   * Only the sha256 hash of the refresh token is stored in the database.
   */
  private async issueTokens(user: TokenUser, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const tokenId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: tokenId },
      { secret: getRefreshSecret(), expiresIn: REFRESH_TOKEN_TTL },
    );
    const decoded = this.jwt.decode(refreshToken) as { exp: number };

    await db.refreshToken.create({
      data: {
        id: tokenId,
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    return { tokenType: 'Bearer', accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) throw new ConflictException('Email is already registered');

    try {
      // Public registration always creates a YOUTH account
      const user = await this.prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(dto.password, 10),
          fullName: dto.fullName,
          phone: dto.phone,
          role: Role.YOUTH,
        },
        select: safeUserSelect,
      });
      return { user, ...(await this.issueTokens(user)) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw e;
    }
  }

  async login(dto: LoginDto) {
    const record = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const valid = record && (await bcrypt.compare(dto.password, record.password));
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    // Housekeeping: drop this user's expired refresh tokens (never blocks the login)
    try {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: record.id, expiresAt: { lt: new Date() } },
      });
    } catch (e) {
      this.logger.warn(`Could not purge expired refresh tokens: ${(e as Error).message}`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.id }, select: safeUserSelect });
    return { user, ...(await this.issueTokens(user)) };
  }

  /**
   * Refresh-token rotation:
   *  - the presented token is revoked and a brand-new pair is issued;
   *  - presenting an already-revoked token means it was stolen/replayed,
   *    so ALL sessions of that user are revoked (reuse detection).
   */
  async refresh(dto: RefreshDto) {
    let payload: { sub: number; jti: string };
    try {
      payload = await this.jwt.verifyAsync(dto.refreshToken, { secret: getRefreshSecret() });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!record || record.userId !== payload.sub || record.tokenHash !== this.hash(dto.refreshToken)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token reuse detected for user ${record.userId}; all sessions revoked`);
      throw new UnauthorizedException('Refresh token reuse detected. Please log in again');
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId }, select: safeUserSelect });
    if (!user) throw new UnauthorizedException('User no longer exists');

    return this.prisma.$transaction(async (tx) => {
      // Atomic revoke: if two requests race with the same token, only one wins
      const revoked = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) throw new UnauthorizedException('Refresh token already used');

      return { user, ...(await this.issueTokens(user, tx)) };
    });
  }

  /** Logout this device: revokes the given refresh token (idempotent, never leaks validity). */
  async logout(dto: RefreshDto) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: number; jti: string }>(dto.refreshToken, {
        secret: getRefreshSecret(),
        ignoreExpiration: true,
      });
      await this.prisma.refreshToken.updateMany({
        where: { id: payload.jti, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      /* invalid token: nothing to revoke */
    }
    return { message: 'Logged out' };
  }

  /** Logout everywhere: revokes all active refresh tokens of the user. */
  async logoutAll(userId: number) {
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out from all devices', revokedSessions: res.count };
  }
}
