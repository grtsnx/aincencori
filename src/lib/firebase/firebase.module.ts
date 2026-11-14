import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service.js';

// Push notifications (Firebase Cloud Messaging). Global: inject it anywhere.
@Global()
@Module({
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class FirebaseModule {}
