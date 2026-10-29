import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Role } from '@prisma/client';
import { existsSync } from 'fs';
import { deleteStoredFile, toDiskPath } from '../common/files/upload.util';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { ProgramsService } from './programs.service';
import { HandleErrors } from '../common/errors';

const materialSelect = { id: true, programId: true, title: true, originalName: true, size: true, createdAt: true };

@Injectable()
@HandleErrors()
export class MaterialsService {
  constructor(
    private prisma: PrismaService,
    private programs: ProgramsService,
  ) {}

  /** Admin: always. Supervisor: own programs. Youth: only with an ACCEPTED application. */
  private async assertCanAccess(programId: number, user: AuthUser) {
    if (user.role === Role.ADMIN) return;
    if (user.role === Role.SUPERVISOR) {
      await this.programs.assertCanManage(programId, user);
      return;
    }
    const application = await this.prisma.application.findUnique({
      where: { userId_programId: { userId: user.id, programId } },
      select: { status: true },
    });
    if (!application || application.status !== ApplicationStatus.ACCEPTED) {
      throw new ForbiddenException('Program materials are available only to accepted participants');
    }
  }

  async create(programId: number, dto: CreateMaterialDto, user: AuthUser, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('PDF file is required (multipart field name: file)');
    const filePath = `/uploads/materials/${file.filename}`;
    try {
      await this.programs.assertCanManage(programId, user);
      return await this.prisma.material.create({
        data: { programId, title: dto.title, filePath, originalName: file.originalname, size: file.size },
        select: materialSelect,
      });
    } catch (e) {
      await deleteStoredFile(filePath);
      throw e;
    }
  }

  async list(programId: number, user: AuthUser) {
    const program = await this.prisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) throw new NotFoundException('Program not found');
    await this.assertCanAccess(programId, user);

    const items = await this.prisma.material.findMany({
      where: { programId },
      select: materialSelect,
      orderBy: { createdAt: 'desc' },
    });
    return items.map((m) => ({ ...m, downloadUrl: `/materials/${m.id}/download` }));
  }

  async getDownload(id: number, user: AuthUser) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    await this.assertCanAccess(material.programId, user);

    const diskPath = toDiskPath(material.filePath);
    if (!diskPath || !existsSync(diskPath)) throw new NotFoundException('File not found on server');
    return { diskPath, filename: material.originalName };
  }

  async remove(id: number, user: AuthUser) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    await this.programs.assertCanManage(material.programId, user);
    await this.prisma.material.delete({ where: { id } });
    await deleteStoredFile(material.filePath);
    return { message: 'Material deleted' };
  }
}
