import { Injectable, NotFoundException } from '@nestjs/common';
import { AppCache } from '../common/cache/app-cache.service';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto, UpdateSessionDto } from './dto/session.dto';
import { ProgramsService } from './programs.service';
import { HandleErrors } from '../common/errors';

@Injectable()
@HandleErrors()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private programs: ProgramsService,
    private cache: AppCache,
  ) {}

  async create(programId: number, dto: CreateSessionDto, user: AuthUser) {
    await this.programs.assertCanManage(programId, user);
    const session = await this.prisma.session.create({
      data: {
        programId,
        date: new Date(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
      },
    });
    await this.cache.invalidate('programs');
    return session;
  }

  private async findOwned(id: number, user: AuthUser) {
    const session = await this.prisma.session.findUnique({ where: { id }, select: { id: true, programId: true } });
    if (!session) throw new NotFoundException('Session not found');
    await this.programs.assertCanManage(session.programId, user);
    return session;
  }

  async update(id: number, dto: UpdateSessionDto, user: AuthUser) {
    await this.findOwned(id, user);
    const session = await this.prisma.session.update({
      where: { id },
      data: {
        date: dto.date ? new Date(dto.date) : undefined,
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
      },
    });
    await this.cache.invalidate('programs');
    return session;
  }

  async remove(id: number, user: AuthUser) {
    await this.findOwned(id, user);
    await this.prisma.session.delete({ where: { id } });
    await this.cache.invalidate('programs');
    return { message: 'Session deleted' };
  }
}
