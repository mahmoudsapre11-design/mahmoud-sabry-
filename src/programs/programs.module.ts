import { Module } from '@nestjs/common';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [ProgramsController, SessionsController, MaterialsController],
  providers: [ProgramsService, SessionsService, MaterialsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
