import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AppCache } from '../common/cache/app-cache.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { deleteStoredFile } from '../common/files/upload.util';
import { AuthUser, buildMeta } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { HandleErrors } from '../common/errors';

const programListSelect = {
  id: true,
  title: true,
  description: true,
  imageUrl: true,
  totalSeats: true,
  availableSeats: true,
  createdAt: true,
  supervisor: { select: { id: true, fullName: true } },
} satisfies Prisma.ProgramSelect;

const programDetailSelect = {
  ...programListSelect,
  sessions: {
    orderBy: [{ date: 'asc' as const }, { startTime: 'asc' as const }],
    select: { id: true, date: true, startTime: true, endTime: true, location: true },
  },
} satisfies Prisma.ProgramSelect;

@Injectable()
@HandleErrors()
export class ProgramsService {
  constructor(
    private prisma: PrismaService,
    private cache: AppCache,
  ) {}

  // ---------- reads (cached) ----------

  list(q: PaginationDto) {
    const search = q.search?.trim() ?? '';
    return this.cache.wrap('programs', `list:${q.page}:${q.limit}:${search.toLowerCase()}`, async () => {
      const where: Prisma.ProgramWhereInput = search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {};
      const [data, total] = await this.prisma.$transaction([
        this.prisma.program.findMany({
          where,
          select: programListSelect,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        this.prisma.program.count({ where }),
      ]);
      return { data, meta: buildMeta(total, q.page, q.limit) };
    });
  }

  detail(id: number) {
    return this.cache.wrap('programs', `detail:${id}`, async () => {
      const program = await this.prisma.program.findUnique({ where: { id }, select: programDetailSelect });
      if (!program) throw new NotFoundException('Program not found');
      return program;
    });
  }

  /** Programs a supervisor manages (admin sees all). Not cached: management view. */
  async managed(user: AuthUser, q: PaginationDto) {
    const where: Prisma.ProgramWhereInput = {
      ...(user.role === Role.SUPERVISOR ? { supervisorId: user.id } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.program.findMany({
        where,
        select: programListSelect,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.program.count({ where }),
    ]);
    return { data, meta: buildMeta(total, q.page, q.limit) };
  }

  // ---------- writes ----------

  private async assertSupervisor(supervisorId: number) {
    const sup = await this.prisma.user.findUnique({ where: { id: supervisorId }, select: { role: true } });
    if (!sup || sup.role !== Role.SUPERVISOR) {
      throw new BadRequestException('supervisorId must belong to a user with the SUPERVISOR role');
    }
  }

  /** Ensures the user can manage the program: admin always, supervisor only if assigned. */
  async assertCanManage(programId: number, user: AuthUser) {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, supervisorId: true, imageUrl: true },
    });
    if (!program) throw new NotFoundException('Program not found');
    if (user.role !== Role.ADMIN && program.supervisorId !== user.id) {
      throw new ForbiddenException('You can only manage programs assigned to you');
    }
    return program;
  }

  async create(dto: CreateProgramDto) {
    await this.assertSupervisor(dto.supervisorId);
    const program = await this.prisma.program.create({
      data: {
        title: dto.title,
        description: dto.description,
        totalSeats: dto.totalSeats,
        availableSeats: dto.totalSeats,
        supervisorId: dto.supervisorId,
      },
      select: programListSelect,
    });
    await this.cache.invalidate('programs');
    return program;
  }

  async update(id: number, dto: UpdateProgramDto, user: AuthUser) {
    await this.assertCanManage(id, user);

    if (user.role !== Role.ADMIN && (dto.totalSeats !== undefined || dto.supervisorId !== undefined)) {
      throw new ForbiddenException('Only an admin can change seats or the assigned supervisor');
    }
    if (dto.supervisorId !== undefined) await this.assertSupervisor(dto.supervisorId);

    await this.prisma.$transaction(async (tx) => {
      if (dto.totalSeats !== undefined) {
        const current = await tx.program.findUnique({ where: { id }, select: { totalSeats: true } });
        const delta = dto.totalSeats - current.totalSeats;
        // Atomic: never lets availableSeats go negative
        const res = await tx.program.updateMany({
          where: { id, ...(delta < 0 ? { availableSeats: { gte: -delta } } : {}) },
          data: { totalSeats: dto.totalSeats, availableSeats: { increment: delta } },
        });
        if (res.count === 0) {
          throw new BadRequestException('Cannot reduce total seats below the number of already reserved seats');
        }
      }
      await tx.program.update({
        where: { id },
        data: { title: dto.title, description: dto.description, supervisorId: dto.supervisorId },
      });
    });

    await this.cache.invalidate('programs');
    return this.prisma.program.findUnique({ where: { id }, select: programDetailSelect });
  }

  async remove(id: number) {
    const program = await this.prisma.program.findUnique({
      where: { id },
      select: {
        imageUrl: true,
        materials: { select: { filePath: true } },
        applications: { select: { cvPath: true } },
      },
    });
    if (!program) throw new NotFoundException('Program not found');

    await this.prisma.program.delete({ where: { id } }); // cascades sessions/materials/applications/announcements

    await Promise.all([
      deleteStoredFile(program.imageUrl),
      ...program.materials.map((m) => deleteStoredFile(m.filePath)),
      ...program.applications.map((a) => deleteStoredFile(a.cvPath)),
    ]);
    await this.cache.invalidate('programs', 'announcements');
    return { message: 'Program deleted' };
  }

  async setImage(id: number, user: AuthUser, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Image is required (multipart field name: image)');
    const newUrl = `/uploads/programs/${file.filename}`;
    try {
      const program = await this.assertCanManage(id, user);
      const updated = await this.prisma.program.update({
        where: { id },
        data: { imageUrl: newUrl },
        select: programListSelect,
      });
      await deleteStoredFile(program.imageUrl); // remove the old image from disk
      await this.cache.invalidate('programs');
      return updated;
    } catch (e) {
      await deleteStoredFile(newUrl); // do not leave an orphan upload behind
      throw e;
    }
  }
}
