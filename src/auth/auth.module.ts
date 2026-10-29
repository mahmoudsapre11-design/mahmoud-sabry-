import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ACCESS_TOKEN_TTL, getJwtSecret, getRefreshSecret } from '../common/config/jwt.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

// Fail fast at startup if secrets are missing / identical
getRefreshSecret();

@Module({
  imports: [
    PassportModule,
    // Default secret/ttl = ACCESS token (short-lived). Refresh tokens pass their own secret.
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: ACCESS_TOKEN_TTL },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
