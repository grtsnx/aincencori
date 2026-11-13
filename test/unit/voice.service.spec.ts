import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { VoiceService } from '@/modules/voice/voice.service.js';

const audio = (bytes: Buffer, type = 'audio/webm;codecs=opus') =>
  `data:${type};base64,${bytes.toString('base64')}`;

function build(over: Record<string, unknown> = {}) {
  const cencori = {
    isConfigured: true,
    voiceTranscribe: vi.fn().mockResolvedValue({
      text: ' Write to Chidi. ',
      language: 'en',
      duration: 2.5,
    }),
    voiceSpeak: vi.fn().mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]).buffer,
      contentType: 'audio/mpeg',
    }),
    voiceListModels: vi.fn().mockResolvedValue({
      tts: [{ id: 'tts-1', voices: ['alloy', 'nova'] }],
      stt: [],
    }),
    ...over,
  };
  return { service: new VoiceService(cencori as never), cencori };
}

describe('VoiceService', () => {
  it('turns a recording into text', async () => {
    const { service, cencori } = build();

    const result = await service.transcribe({
      audio: audio(Buffer.from('fake audio')),
      language: 'en',
    });

    expect(result).toEqual({
      text: 'Write to Chidi.',
      language: 'en',
      seconds: 2.5,
    });
    const request = cencori.voiceTranscribe.mock.calls[0][0];
    expect(request).toMatchObject({
      filename: 'voice.webm',
      model: 'whisper-1',
      language: 'en',
    });
    expect(Buffer.from(await request.audio.arrayBuffer()).toString()).toBe(
      'fake audio',
    );
  });

  it('refuses empty and oversized recordings without calling Cencori', async () => {
    const { service, cencori } = build();

    await expect(
      service.transcribe({ audio: audio(Buffer.alloc(0)) }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.transcribe({ audio: audio(Buffer.alloc(10 * 1_048_576 + 1)) }),
    ).rejects.toThrow('too big');
    expect(cencori.voiceTranscribe).not.toHaveBeenCalled();
  });

  it('reads text aloud in a known voice only', async () => {
    const { service, cencori } = build();

    const spoken = await service.speak({ text: 'Hello Ada.', voice: 'nova' });
    expect([...spoken.audio]).toEqual([1, 2, 3]);
    expect(spoken.contentType).toBe('audio/mpeg');
    expect(cencori.voiceSpeak).toHaveBeenCalledWith({
      input: 'Hello Ada.',
      model: 'tts-1',
      voice: 'nova',
      responseFormat: 'mp3',
    });

    await expect(
      service.speak({ text: 'Hello.', voice: 'darth-vader' }),
    ).rejects.toThrow('Unknown voice');
  });

  it('says "try later" when Cencori is away or out of credit', async () => {
    const { service } = build({
      voiceTranscribe: vi
        .fn()
        .mockRejectedValue(
          new Error('Your organization has run out of credits.'),
        ),
    });

    await expect(
      service.transcribe({ audio: audio(Buffer.from('x')) }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
