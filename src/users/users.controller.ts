import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { CreateSupervisorDto } from './dto/create-supervisor.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Roles(Role.ADMIN)
  @Post('supervisors')
  createSupervisor(@Body() dto: CreateSupervisorDto) {
    return this.users.createSupervisor(dto);
  }

  @Roles(Role.ADMIN)
  @Get('supervisors')
  listSupervisors(@Query() q: PaginationDto) {
    return this.users.listSupervisors(q);
  }
}
