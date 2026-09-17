export function validateWave(bytes: ArrayBuffer, size: number) {
  const v = new DataView(bytes); const text = (offset: number, length: number) => new TextDecoder().decode(bytes.slice(offset, offset + length));
  if (bytes.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || text(12, 4) !== 'fmt ' || text(36, 4) !== 'data' || v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1 || v.getUint16(34, true) !== 16) throw new Error('Use a PCM 16-bit WAV with a standard 44-byte header.');
  const channels = v.getUint16(22, true), rate = v.getUint32(24, true), dataBytes = v.getUint32(40, true);
  if (dataBytes === 0 || ![1, 2].includes(channels) || rate < 8000 || rate > 48000 || v.getUint16(32, true) !== channels * 2 || v.getUint32(28, true) !== rate * channels * 2 || v.getUint32(4, true) !== size - 8 || dataBytes !== size - 44 || dataBytes % (channels * 2) || dataBytes / (rate * channels * 2) > 3600) throw new Error('The WAV size, duration, or audio metadata is invalid. Maximum duration is 60 minutes.');
  return { channels, sampleRate: rate, durationMs: Math.round(dataBytes / (rate * channels * 2) * 1000) };
}
