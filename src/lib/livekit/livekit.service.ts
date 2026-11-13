import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from 'livekit-server-sdk';

export interface CallTicket {
  // The LiveKit server the app connects to.
  url: string;
  // Lets this one person into this one room, for a short time.
  token: string;
  room: string;
}

// Live voice calls on LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET). We only hand out call tickets here; the audio flows
// between the app and LiveKit, and our voice worker (src/voice-worker.ts)
// joins the room to listen and speak.
@Injectable()
export class LivekitService {
  private readonly url?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('LIVEKIT_URL');
    this.apiKey = config.get<string>('LIVEKIT_API_KEY');
    this.apiSecret = config.get<string>('LIVEKIT_API_SECRET');
  }

  get isConfigured(): boolean {
    return Boolean(this.url && this.apiKey && this.apiSecret);
  }

  // A ticket for one person to join one room. Creating the room also calls
  // in our voice worker, which gets "details" (who is calling, which bot).
  // The details are signed into the ticket, so the app cannot change them.
  async ticket(input: {
    room: string;
    identity: string;
    name: string;
    agentName: string;
    details: Record<string, string | undefined>;
    seconds: number;
  }): Promise<CallTicket> {
    if (!this.url || !this.apiKey || !this.apiSecret) {
      throw new ServiceUnavailableException(
        'Voice calls are not set up: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET',
      );
    }
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: input.identity,
      name: input.name,
      ttl: input.seconds,
    });
    token.addGrant({
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    token.roomConfig = new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({
          agentName: input.agentName,
          metadata: JSON.stringify(input.details),
        }),
      ],
    });
    return { url: this.url, token: await token.toJwt(), room: input.room };
  }
}
