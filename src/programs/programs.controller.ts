import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { programImageUpload } from '../common/files/upload.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { ProgramsService } from './programs.service';

@Controller('programs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProgramsController {
  constructor(private programs: ProgramsService) {}

  // Browse programs: pagination + search (?page=1&limit=10&search=...)
  @Get()
  list(@Query() q: PaginationDto) {
    return this.programs.list(q);
  }

  // Declared before ':id' so "managed" is not parsed as an id
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get('managed')
  managed(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.programs.managed(user, q);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.programs.detail(id);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateProgramDto) {
    return this.programs.create(dto);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProgramDto, @CurrentUser() user: AuthUser) {
    return this.programs.update(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.programs.remove(id);
  }

  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Post(':id/image')
  @UseInterceptors(FileInterceptor('image', programImageUpload))
  setImage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.programs.setImage(id, user, file);
  }
}
