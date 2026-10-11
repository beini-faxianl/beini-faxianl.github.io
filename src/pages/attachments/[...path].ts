import fs from 'node:fs';
import type { APIRoute, GetStaticPaths } from 'astro';
import { getVault } from '../../lib/vault';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
};

/** 把 Obsidian 仓库中的附件（图片、音视频、PDF…）原样输出到 /attachments/ 下 */
export const getStaticPaths: GetStaticPaths = () =>
  getVault().attachments.map((a) => ({
    params: { path: a.outPath },
    props: { file: a.file, ext: a.ext },
  }));

export const GET: APIRoute = ({ props }) => {
  const { file, ext } = props as { file: string; ext: string };
  return new Response(fs.readFileSync(file), {
    headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
  });
};
