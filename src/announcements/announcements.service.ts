import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma, Role } from '@prisma/client';
import { AppCache } from '../common/cache/app-cache.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AuthUser, buildMeta } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramsService } from '../programs/programs.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { HandleErrors } from '../common/errors';

const announcementSelect = {
  id: true,
  title: true,
  content: true,
  programId: true,
  createdAt: true,
  author: { select: { id: true, fullName: true } },
  program: { select: { id: true, title: true } },
} satisfies Prisma.AnnouncementSelect;

const REGISTERED = [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED];

@Injectable()
@HandleErrors()
export class AnnouncementsService {
  constructor(
    private prisma: PrismaService,
    private programs: ProgramsService,
    private cache: AppCache,
  ) {}

  private async page(where: Prisma.AnnouncementWhereInput, q: PaginationDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        select: announcementSelect,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return { data, meta: buildMeta(total, q.page, q.limit) };
  }

  async create(dto: CreateAnnouncementDto, user: AuthUser) {
    if (user.role === Role.SUPERVISOR) {
      if (!dto.programId) throw new ForbiddenException('Supervisors can only post announcements to their own programs');
      await this.programs.assertCanManage(dto.programId, user);
    } else if (dto.programId) {
      await this.programs.detail(dto.programId); // 404 if the program does not exist
    }

    const announcement = await this.prisma.announcement.create({
      data: { title: dto.title, content: dto.content, programId: dto.programId ?? null, authorId: user.id },
      select: announcementSelect,
    });
    await this.cache.invalidate('announcements');
    return announcement;
  }

  // Public announcements (cached)
  listPublic(q: PaginationDto) {
    return this.cache.wrap('announcements', `public:${q.page}:${q.limit}`, () =>
      this.page({ programId: null }, q),
    );
  }

  // Announcements of one program (cached): registered youth, the program's supervisor, or admin
  async listForProgram(programId: number, q: PaginationDto, user: AuthUser) {
    if (user.role === Role.SUPERVISOR) {
      await this.programs.assertCanManage(programId, user);
    } else if (user.role === Role.YOUTH) {
      const registration = await this.prisma.application.findFirst({
        where: { userId: user.id, programId, status: { in: REGISTERED } },
        select: { id: true },
      });
      if (!registration) throw new ForbiddenException('You are not registered in this program');
    }
    return this.cache.wrap('announcements', `program:${programId}:${q.page}:${q.limit}`, () =>
      this.page({ programId }, q),
    );
  }

  // Youth feed: public + announcements of programs the youth is registered in (cached per user)
  feed(user: AuthUser, q: PaginationDto) {
    return this.cache.wrap('announcements', `feed:${user.id}:${q.page}:${q.limit}`, async () => {
      const registrations = await this.prisma.application.findMany({
        where: { userId: user.id, status: { in: REGISTERED } },
        select: { programId: true },
      });
      const programIds = registrations.map((r) => r.programId);
      return this.page({ OR: [{ programId: null }, { programId: { in: programIds } }] }, q);
    });
  }

  async remove(id: number, user: AuthUser) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      select: { id: true, authorId: true },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    if (user.role !== Role.ADMIN && announcement.authorId !== user.id) {
      throw new ForbiddenException('You can only delete your own announcements');
    }
    await this.prisma.announcement.delete({ where: { id } });
    await this.cache.invalidate('announcements');
    return { message: 'Announcement deleted' };
  }
}
