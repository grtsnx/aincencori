import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { ComputerController } from './computer.controller.js';
import { ComputerService } from './computer.service.js';

@Module({
  imports: [ChatModule],
  controllers: [ComputerController],
  providers: [ComputerService],
})
export class ComputerModule {}
