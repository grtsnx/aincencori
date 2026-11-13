import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { RoutineController } from './routine.controller.js';
import { RoutineService } from './routine.service.js';

@Module({
  imports: [ChatModule],
  controllers: [RoutineController],
  providers: [RoutineService],
})
export class RoutineModule {}
