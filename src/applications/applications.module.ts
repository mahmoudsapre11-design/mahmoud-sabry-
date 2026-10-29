import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'email' })],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, EmailProcessor],
})
export class ApplicationsModule {}
