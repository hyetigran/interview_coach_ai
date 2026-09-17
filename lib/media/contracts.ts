export const PART_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
export const UPLOAD_LEASE_MS = 24 * 60 * 60 * 1000;
export type UploadState = {
  id: string; name: string; size: number; state: string; expiresAt: number;
  parts: { number: number; sha256: string }[];
};
export type MediaState = { upload: UploadState | null; admitted: number; reserved: number; allowance: number };
