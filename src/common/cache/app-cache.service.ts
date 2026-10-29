import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';

export type CacheGroup = 'programs' | 'announcements';

/**
 * Thin wrapper over cache-manager that adds group-based invalidation.
 * Every cached key belongs to a group; any write simply invalidates the
 * whole group so readers always get the latest version.
 * The cache is an optimization only: if it fails, we fall back to the database.
 */
@Injectable()
export class AppCache {
  private readonly logger = new Logger(AppCache.name);
  private groups = new Map<CacheGroup, Set<string>>();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async wrap<T>(group: CacheGroup, key: string, loader: () => Promise<T>): Promise<T> {
    const fullKey = `${group}:${key}`;

    try {
      const hit = await this.cache.get<T>(fullKey);
      if (hit !== undefined && hit !== null) return hit;
    } catch (e) {
      this.logger.warn(`Cache read failed for ${fullKey}: ${(e as Error).message}`);
    }

    const value = await loader(); // errors here (404, DB errors) must reach the caller

    try {
      await this.cache.set(fullKey, value);
      if (!this.groups.has(group)) this.groups.set(group, new Set());
      this.groups.get(group).add(fullKey);
    } catch (e) {
      this.logger.warn(`Cache write failed for ${fullKey}: ${(e as Error).message}`);
    }
    return value;
  }

  async invalidate(...groups: CacheGroup[]): Promise<void> {
    for (const group of groups) {
      const keys = this.groups.get(group);
      if (!keys) continue;
      try {
        await Promise.all([...keys].map((k) => this.cache.del(k)));
      } catch (e) {
        this.logger.warn(`Cache invalidation failed for group ${group}: ${(e as Error).message}`);
      } finally {
        keys.clear();
      }
    }
  }
}
