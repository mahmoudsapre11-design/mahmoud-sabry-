import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { PaginationDto } from '../common/dto/pagination.dto';
import { cvUpload } from '../common/files/upload.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { ApplicationsService } from './applications.service';
import { ApplicationsQueryDto } from './dto/applications-query.dto';
import { ApplyDto } from './dto/apply.dto';
import { ReviewDto } from './dto/review.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private applications: ApplicationsService) {}

  // Youth: apply to a program (multipart/form-data, optional PDF field "cv", optional "note")
  @Roles(Role.YOUTH)
  @Post('programs/:programId/applications')
  @UseInterceptors(FileInterceptor('cv', cvUpload))
  apply(
    @Param('programId', ParseIntPipe) programId: number,
    @Body() dto: ApplyDto,
    @CurrentUser() user: AuthUser,
    @UploadedFile() cv?: Express.Multer.File,
  ) {
    return this.applications.apply(user.id, programId, dto.note, cv);
  }

  // Youth: only my own applications
  @Roles(Role.YOUTH)
  @Get('applications/my')
  mine(@CurrentUser() user: AuthUser, @Query() q: ApplicationsQueryDto) {
    return this.applications.listMine(user.id, q);
  }

  @Roles(Role.YOUTH)
  @Patch('applications/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.applications.cancel(user, id);
  }

  // Admin: review queue
  @Roles(Role.ADMIN)
  @Get('applications')
  listAll(@Query() q: ApplicationsQueryDto) {
    return this.applications.listAll(q);
  }

  @Roles(Role.ADMIN)
  @Patch('applications/:id/review')
  review(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewDto) {
    return this.applications.review(id, dto.status);
  }

  // Supervisor (own programs) / Admin: applicants of one program
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get('programs/:programId/applications')
  forProgram(
    @Param('programId', ParseIntPipe) programId: number,
    @CurrentUser() user: AuthUser,
    @Query() q: PaginationDto,
  ) {
    return this.applications.listForProgram(programId, user, q);
  }

  // Private CV download (CVs are never served as static files)
  @Get('applications/:id/cv')
  async cv(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { diskPath, filename } = await this.applications.getCvDownload(id, user);
    return res.download(diskPath, filename);
  }
}
