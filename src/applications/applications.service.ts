import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma, Role } from '@prisma/client';
import { Queue } from 'bullmq';
import { existsSync } from 'fs';
import { AppCache } from '../common/cache/app-cache.service';
import { deleteStoredFile, toDiskPath } from '../common/files/upload.util';
import { AuthUser, buildMeta } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsQueryDto } from './dto/applications-query.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { HandleErrors } from '../common/errors';

const applicationSelect = {
  id: true,
  status: true,
  note: true,
  cvPath: true,
  createdAt: true,
  updatedAt: true,
  program: { select: { id: true, title: true, imageUrl: true } },
} satisfies Prisma.ApplicationSelect;

const applicationWithUserSelect = {
  ...applicationSelect,
  user: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.ApplicationSelect;

@Injectable()
@HandleErrors()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private cache: AppCache,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  // ------------------------------------------------------------------
  // Apply: reserves one seat atomically.
  //
  // Last-seat race condition: the seat is taken with a single conditional
  // UPDATE ... SET availableSeats = availableSeats - 1 WHERE availableSeats > 0.
  // PostgreSQL takes a row lock for that statement, so concurrent requests
  // are serialized and re-evaluate the condition after the lock is released.
  // Exactly `availableSeats` requests get count = 1; the rest get a clean 409.
  // Everything runs inside one interactive transaction: if creating the
  // application fails (e.g. duplicate), the seat decrement is rolled back.
  // ------------------------------------------------------------------
  async apply(userId: number, programId: number, note: string | undefined, cvFile?: Express.Multer.File) {
    const newCvPath = cvFile ? `/uploads/cvs/${cvFile.filename}` : null;
    let replacedCv: string | null = null;

    try {
      const application = await this.prisma.$transaction(
        async (tx) => {
          const program = await tx.program.findUnique({ where: { id: programId }, select: { id: true } });
          if (!program) throw new NotFoundException('Program not found');

          const existing = await tx.application.findUnique({
            where: { userId_programId: { userId, programId } },
          });
          if (existing && existing.status !== ApplicationStatus.CANCELLED) {
            throw new ConflictException(
              `You already have an application for this program (status: ${existing.status})`,
            );
          }

          // Atomic seat reservation
          const seat = await tx.program.updateMany({
            where: { id: programId, availableSeats: { gt: 0 } },
            data: { availableSeats: { decrement: 1 } },
          });
          if (seat.count === 0) {
            throw new ConflictException('No seats available for this program');
          }

          if (existing) {
            // Re-applying after cancelling: reuse the row (unique userId+programId)
            const reopened = await tx.application.updateMany({
              where: { id: existing.id, status: ApplicationStatus.CANCELLED },
              data: {
                status: ApplicationStatus.PENDING,
                note: note ?? null,
                cvPath: newCvPath ?? existing.cvPath,
              },
            });
            if (reopened.count === 0) {
              throw new ConflictException('You already have an active application for this program');
            }
            if (newCvPath) replacedCv = existing.cvPath;
            return tx.application.findUnique({ where: { id: existing.id }, select: applicationSelect });
          }

          return tx.application.create({
            data: { userId, programId, note: note ?? null, cvPath: newCvPath },
            select: applicationSelect,
          });
        },
        { maxWait: 10_000, timeout: 10_000 },
      );

      // Only after the transaction committed successfully:
      await deleteStoredFile(replacedCv);
      await this.cache.invalidate('programs', 'announcements');
      await this.notify(application.id, userId, programId, application.status);
      return application;
    } catch (e) {
      await deleteStoredFile(newCvPath); // never keep an orphan CV after a failed application
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('You already applied to this program');
      }
      throw e;
    }
  }

  // Youth cancels their own application (PENDING or ACCEPTED) -> seat is released once.
  async cancel(user: AuthUser, id: number) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const app = await tx.application.findUnique({ where: { id } });
        if (!app || app.userId !== user.id) throw new NotFoundException('Application not found');

        const changed = await tx.application.updateMany({
          where: { id, status: { in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED] } },
          data: { status: ApplicationStatus.CANCELLED },
        });
        if (changed.count === 0) {
          throw new ConflictException(`Application cannot be cancelled (status: ${app.status})`);
        }
        await tx.program.update({
          where: { id: app.programId },
          data: { availableSeats: { increment: 1 } },
        });
        return {
          application: await tx.application.findUnique({ where: { id }, select: applicationSelect }),
          programId: app.programId,
        };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    await this.cache.invalidate('programs', 'announcements');
    await this.notify(id, user.id, result.programId, ApplicationStatus.CANCELLED);
    return result.application;
  }

  // Admin decision on a PENDING application. REJECTED releases the seat.
  async review(id: number, status: 'ACCEPTED' | 'REJECTED') {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const changed = await tx.application.updateMany({
          where: { id, status: ApplicationStatus.PENDING },
          data: { status },
        });
        if (changed.count === 0) {
          const current = await tx.application.findUnique({ where: { id }, select: { status: true } });
          if (!current) throw new NotFoundException('Application not found');
          throw new ConflictException(`Only PENDING applications can be reviewed (current: ${current.status})`);
        }
        const app = await tx.application.findUnique({ where: { id }, select: { programId: true } });
        if (status === ApplicationStatus.REJECTED) {
          await tx.program.update({
            where: { id: app.programId },
            data: { availableSeats: { increment: 1 } },
          });
        }
        return {
          application: await tx.application.findUnique({ where: { id }, select: applicationWithUserSelect }),
          programId: app.programId,
        };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    await this.cache.invalidate('programs', 'announcements');
    await this.notify(id, result.application.user.id, result.programId, status);
    return result.application;
  }

  // Added to the queue only AFTER the transaction committed. IDs only.
  private async notify(applicationId: number, userId: number, programId: number, status: string) {
    try {
      await this.emailQueue.add(
        'application-status',
        { userId, programId, status },
        {
          jobId: `application-${applicationId}-${status}`, // prevents duplicate jobs
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        },
      );
    } catch (err) {
      // A queue outage (Redis down) must never fail an already-committed application
      console.error('Failed to enqueue email job:', (err as Error).message);
    }
  }

  // ------------------------------ reads ------------------------------

  async listMine(userId: number, q: ApplicationsQueryDto) {
    const where: Prisma.ApplicationWhereInput = { userId, ...(q.status ? { status: q.status } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        select: applicationSelect,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.application.count({ where }),
    ]);
    return { data, meta: buildMeta(total, q.page, q.limit) };
  }

  async listAll(q: ApplicationsQueryDto) {
    const where: Prisma.ApplicationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.programId ? { programId: q.programId } : {}),
      ...(q.search
        ? {
            OR: [
              { user: { fullName: { contains: q.search, mode: 'insensitive' } } },
              { user: { email: { contains: q.search, mode: 'insensitive' } } },
              { program: { title: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        select: applicationWithUserSelect,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.application.count({ where }),
    ]);
    return { data, meta: buildMeta(total, q.page, q.limit) };
  }

  /** Applicants of one program: admin, or the supervisor assigned to it. */
  async listForProgram(programId: number, user: AuthUser, q: PaginationDto) {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { supervisorId: true },
    });
    if (!program) throw new NotFoundException('Program not found');
    if (user.role !== Role.ADMIN && program.supervisorId !== user.id) {
      throw new ForbiddenException('You can only view applicants of your own programs');
    }
    const where: Prisma.ApplicationWhereInput = { programId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        select: applicationWithUserSelect,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.application.count({ where }),
    ]);
    return { data, meta: buildMeta(total, q.page, q.limit) };
  }

  /** CV download: owner youth, admin, or the program's supervisor. */
  async getCvDownload(id: number, user: AuthUser) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      select: { userId: true, cvPath: true, program: { select: { supervisorId: true } } },
    });
    if (!app) throw new NotFoundException('Application not found');

    const allowed =
      user.role === Role.ADMIN ||
      (user.role === Role.YOUTH && app.userId === user.id) ||
      (user.role === Role.SUPERVISOR && app.program.supervisorId === user.id);
    if (!allowed) throw new ForbiddenException('You cannot access this CV');
    if (!app.cvPath) throw new BadRequestException('This application has no CV');

    const diskPath = toDiskPath(app.cvPath);
    if (!diskPath || !existsSync(diskPath)) throw new NotFoundException('File not found on server');
    return { diskPath, filename: `cv-application-${id}.pdf` };
  }
}
