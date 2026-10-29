export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
  }
  return secret;
}

export function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET is not set. Copy .env.example to .env and set it.');
  }
  if (secret === process.env.JWT_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be different from JWT_SECRET.');
  }
  return secret;
}

export const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN ?? '15m';
export const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
