import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementsController {
  constructor(private announcements: AnnouncementsService) {}

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: AuthUser) {
    return this.announcements.create(dto, user);
  }

  @Get('public')
  listPublic(@Query() q: PaginationDto) {
    return this.announcements.listPublic(q);
  }

  @Roles(Role.YOUTH)
  @Get('feed')
  feed(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.announcements.feed(user, q);
  }

  @Get('program/:programId')
  forProgram(
    @Param('programId', ParseIntPipe) programId: number,
    @Query() q: PaginationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.announcements.listForProgram(programId, q, user);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.announcements.remove(id, user);
  }
}
