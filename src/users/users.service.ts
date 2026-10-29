import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PaginationDto } from '../common/dto/pagination.dto';
import { buildMeta, safeUserSelect } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupervisorDto } from './dto/create-supervisor.dto';
import { HandleErrors } from '../common/errors';

@Injectable()
@HandleErrors()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: safeUserSelect });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createSupervisor(dto: CreateSupervisorDto) {
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          password: await bcrypt.hash(dto.password, 10),
          fullName: dto.fullName,
          phone: dto.phone,
          role: Role.SUPERVISOR,
        },
        select: safeUserSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw e;
    }
  }

  async listSupervisors(q: PaginationDto) {
    const where: Prisma.UserWhereInput = {
      role: Role.SUPERVISOR,
      ...(q.search
        ? {
            OR: [
              { fullName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: safeUserSelect,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: buildMeta(total, q.page, q.limit) };
  }
}
