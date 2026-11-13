import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  defaultVoice,
  maxAudioBytes,
  speechToTextModel,
  textToSpeechModel,
} from '@/config/agents/limits.js';
import type {
  SpeakDto,
  TranscribeDto,
  TranscriptDto,
  VoiceListDto,
} from '@/dto';
import { CencoriService } from '@/lib/cencori/cencori.service.js';

// Voice messages. The app records the user, we turn the recording into text
// (transcribe); the text goes to the chat like any message; the answer can
// be read aloud (speak). Nothing is stored: audio comes in, text or audio
// goes out. Live calls (talking over each other, like a phone) are a
// different thing and not built.
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private voicesCache?: { at: number; voices: string[] };

  constructor(private readonly cencori: CencoriService) {}

  // A recording in, its words out.
  async transcribe(body: TranscribeDto): Promise<TranscriptDto> {
    const [header, data] = body.audio.split(',', 2);
    const contentType = header.slice('data:'.length).split(';')[0];
    const bytes = Buffer.from(data ?? '', 'base64');
    if (bytes.length === 0) {
      throw new BadRequestException('The recording is empty.');
    }
    if (bytes.length > maxAudioBytes) {
      throw new BadRequestException(
        'The recording is too big (10 MB at most).',
      );
    }
    const extension = contentType.split('/')[1]?.split(/[+;]/)[0] || 'webm';
    const result = await this.call(() =>
      this.cencori.voiceTranscribe({
        audio: new Blob([bytes], { type: contentType }),
        filename: `voice.${extension}`,
        model: speechToTextModel,
        language: body.language,
      }),
    );
    return {
      text: result.text.trim(),
      language: result.language ?? null,
      seconds: result.duration ?? null,
    };
  }

  // Text in, an MP3 of it out.
  async speak(body: SpeakDto): Promise<{ audio: Buffer; contentType: string }> {
    const voice = body.voice ?? defaultVoice;
    if (!(await this.voices()).voices.includes(voice)) {
      throw new BadRequestException('Unknown voice. See "List voices".');
    }
    const result = await this.call(() =>
      this.cencori.voiceSpeak({
        input: body.text,
        model: textToSpeechModel,
        voice,
        responseFormat: 'mp3',
      }),
    );
    return {
      audio: Buffer.from(result.audio),
      contentType: result.contentType || 'audio/mpeg',
    };
  }

  // The voices of our speech model. Asked from Cencori at most hourly.
  async voices(): Promise<VoiceListDto> {
    if (!this.voicesCache || Date.now() - this.voicesCache.at > 3_600_000) {
      let voices = [defaultVoice];
      if (this.cencori.isConfigured) {
        try {
          const models = (await this.cencori.voiceListModels()) as {
            tts: { id: string; voices?: string[] }[];
          };
          const found = models.tts.find((m) => m.id === textToSpeechModel);
          if (found?.voices?.length) voices = found.voices;
        } catch {
          // Cencori is away: only the default voice is offered for now.
          return { voices, defaultVoice };
        }
      }
      this.voicesCache = { at: Date.now(), voices };
    }
    return { voices: this.voicesCache.voices, defaultVoice };
  }

  // Cencori being off, away or out of credit is "try later", not our bug.
  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`Voice failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Voice is not available right now. Please try again later.',
      );
    }
  }
}
