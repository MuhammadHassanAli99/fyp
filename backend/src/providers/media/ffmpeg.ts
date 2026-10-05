import { spawn } from 'node:child_process';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';

const log = loggerFor('ffmpeg');

let resolved: string | null | undefined;
let missingLogged = false;

function toFfmpegPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Absolute path or `ffmpeg` on PATH. Null when the binary is not installed. */
export async function resolveFfmpeg(): Promise<string | null> {
  if (resolved !== undefined) return resolved;
  if (env.FFMPEG_PATH) {
    resolved = env.FFMPEG_PATH;
    return resolved;
  }
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const result = await run(probe, ['ffmpeg']);
    resolved = result.code === 0 ? 'ffmpeg' : null;
  } catch {
    resolved = null;
  }
  if (resolved === null && !missingLogged) {
    missingLogged = true;
    log.warn('ffmpeg not found; video stays processing/pending until FFMPEG_PATH or PATH provides it');
  }
  return resolved;
}

export const ffmpegAvailable = async (): Promise<boolean> => (await resolveFfmpeg()) !== null;

export interface HlsResult {
  playlistPath: string;
  segmentPaths: string[];
  posterPath: string | null;
  durationSecs: number | null;
}

/**
 * One VOD HLS ladder (H.264 + AAC, ~720p cap). Relative segment names so a CDN
 * can serve the playlist without rewriting URLs.
 */
export async function transcodeToHls(inputPath: string, outputDir: string): Promise<HlsResult> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    throw new Error('ffmpeg is not installed');
  }

  const playlistPath = `${outputDir}/playlist.m3u8`;
  const segmentPattern = `${outputDir}/seg_%03d.ts`;
  const args = [
    '-y',
    '-i',
    toFfmpegPath(inputPath),
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-maxrate',
    '2500k',
    '-bufsize',
    '5000k',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '48',
    '-keyint_min',
    '48',
    '-sc_threshold',
    '0',
    '-vf',
    "scale='min(1280,iw)':-2",
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    toFfmpegPath(segmentPattern),
    toFfmpegPath(playlistPath),
  ];

  let result = await run(ffmpeg, args);
  if (result.code !== 0) {
    result = await run(ffmpeg, [
      '-y',
      '-i',
      toFfmpegPath(inputPath),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      toFfmpegPath(segmentPattern),
      toFfmpegPath(playlistPath),
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr.slice(-2000) || 'ffmpeg hls failed');
    }
  }

  const { readdir } = await import('node:fs/promises');
  const names = await readdir(outputDir);
  const segmentPaths = names
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => `${outputDir}/${name}`);

  const posterPath = `${outputDir}/poster.jpg`;
  const poster = await run(ffmpeg, [
    '-y',
    '-ss',
    '1',
    '-i',
    toFfmpegPath(inputPath),
    '-frames:v',
    '1',
    '-q:v',
    '3',
    toFfmpegPath(posterPath),
  ]);

  return {
    playlistPath,
    segmentPaths,
    posterPath: poster.code === 0 ? posterPath : null,
    durationSecs: await probeDuration(ffmpeg, inputPath),
  };
}

async function probeDuration(ffmpeg: string, inputPath: string): Promise<number | null> {
  const ffprobe = ffmpeg === 'ffmpeg' ? 'ffprobe' : ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  try {
    const result = await run(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      toFfmpegPath(inputPath),
    ]);
    if (result.code !== 0) return null;
    const seconds = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}
