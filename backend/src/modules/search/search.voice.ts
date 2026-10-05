import { insertAndGetId, queryOne, type Row } from '../../db/query';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { orchestrate } from '../ai/ai.orchestrator';
import { throughGateway } from '../ai/ai.gateway';
import { detectLanguageHint } from './search.taxonomy';

const log = loggerFor('search.voice');

export interface VoiceSearchInput {
  userId: number | null;
  audioUrl?: string | null;
  durationMs?: number | null;
  transcript?: string | null;
  language?: string | null;
}

export interface VoiceSearchResult {
  id: number;
  transcript: string;
  language: string;
  confidence: number;
  provider: string;
}

async function transcribeWithOpenAi(audioUrl: string): Promise<{ transcript: string; language: string; confidence: number } | null> {
  if (!env.AI_API_KEY) return null;
  try {
    const base = env.AI_BASE_URL || 'https://api.openai.com/v1';
    const audio = await fetch(audioUrl);
    if (!audio.ok) return null;
    const blob = await audio.blob();
    const form = new FormData();
    form.append('file', blob, 'voice.webm');
    form.append('model', 'whisper-1');
    const response = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_API_KEY}` },
      body: form,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { text?: string; language?: string };
    const transcript = (payload.text ?? '').trim();
    if (!transcript) return null;
    return {
      transcript,
      language: payload.language ?? detectLanguageHint(transcript) ?? 'en',
      confidence: 0.7,
    };
  } catch (error) {
    log.warn({ err: error }, 'voice transcription failed');
    return null;
  }
}

export async function ingestVoiceSearch(input: VoiceSearchInput): Promise<VoiceSearchResult> {
  let transcript = (input.transcript ?? '').trim();
  let language = input.language ?? (transcript ? detectLanguageHint(transcript) : null) ?? 'en';
  let confidence = transcript ? 0.9 : 0;
  let provider = transcript ? 'client' : 'none';

  if (!transcript && input.audioUrl) {
    const run = async () => {
      const remote = await transcribeWithOpenAi(input.audioUrl!);
      return {
        transcript: remote?.transcript ?? '',
        language: remote?.language ?? 'en',
        confidence: remote ? Math.round((remote.confidence ?? 0.7) * 100) : 0,
        model: remote ? 'whisper' : 'none',
        latencyMs: 0,
      };
    };
    try {
      const gated = input.userId
        ? await throughGateway({ userId: input.userId }, { task: 'speech_to_text', input: { audioUrl: input.audioUrl }, run })
        : await orchestrate(
            { task: 'speech_to_text', skipEntitlement: true, skipQuota: true, input: { audioUrl: input.audioUrl } },
            run,
          );
      if (!('accepted' in gated) && gated.result.transcript) {
        transcript = gated.result.transcript;
        language = gated.result.language;
        confidence = (gated.result.confidence ?? 70) / 100;
        provider = 'whisper';
      }
    } catch (error) {
      log.debug({ err: error }, 'voice AI path skipped');
      const remote = await transcribeWithOpenAi(input.audioUrl);
      if (remote) {
        transcript = remote.transcript;
        language = remote.language;
        confidence = remote.confidence;
        provider = 'whisper';
      }
    }
  }

  const id = await insertAndGetId(
    `INSERT INTO voice_search_requests
       (user_id, audio_url, duration_ms, detected_language, transcript, confidence, provider, resolved_query)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.audioUrl ?? null,
      input.durationMs ?? null,
      language,
      transcript.slice(0, 500) || null,
      confidence,
      provider,
      transcript.slice(0, 255) || null,
    ],
  );

  if (!transcript) {
    const row = await queryOne<Row>('SELECT id FROM voice_search_requests WHERE id = ?', [id]);
    void row;
    return { id, transcript: '', language, confidence: 0, provider };
  }

  return { id, transcript, language, confidence, provider };
}
