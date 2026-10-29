import { Body, Controller, Delete, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { CreateSessionDto, UpdateSessionDto } from './dto/session.dto';
import { SessionsService } from './sessions.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR, Role.ADMIN)
export class SessionsController {
  constructor(private sessions: SessionsService) {}

  @Post('programs/:programId/sessions')
  create(
    @Param('programId', ParseIntPipe) programId: number,
    @Body() dto: CreateSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessions.create(programId, dto, user);
  }

  @Patch('sessions/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessions.update(id, dto, user);
  }

  @Delete('sessions/:id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.sessions.remove(id, user);
  }
}
