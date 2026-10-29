import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { materialUpload } from '../common/files/upload.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { CreateMaterialDto } from './dto/create-material.dto';
import { MaterialsService } from './materials.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaterialsController {
  constructor(private materials: MaterialsService) {}

  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Post('programs/:programId/materials')
  @UseInterceptors(FileInterceptor('file', materialUpload))
  create(
    @Param('programId', ParseIntPipe) programId: number,
    @Body() dto: CreateMaterialDto,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.materials.create(programId, dto, user, file);
  }

  // Youth: only when the application is ACCEPTED
  @Get('programs/:programId/materials')
  list(@Param('programId', ParseIntPipe) programId: number, @CurrentUser() user: AuthUser) {
    return this.materials.list(programId, user);
  }

  @Get('materials/:id/download')
  async download(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { diskPath, filename } = await this.materials.getDownload(id, user);
    return res.download(diskPath, filename);
  }

  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Delete('materials/:id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.materials.remove(id, user);
  }
}
