// R2 requires a body with a runtime-known length, not only a Content-Length header.
export function mediaOutputForStorage(response: Response): ReadableStream {
  const header = response.headers.get('content-length');
  const length = Number(header);
  if (!response.body || !header || !/^\d+$/.test(header) || !Number.isSafeInteger(length) || length <= 0 || length > 256 * 1024 * 1024) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Media output has an invalid size.');
  }
  const fixed = new FixedLengthStream(length);
  // pipeTo propagates source errors and destination cancellation to the other side.
  // Its rejection is also delivered to the R2 reader through fixed.readable.
  void response.body.pipeTo(fixed.writable).catch(() => {});
  return fixed.readable;
}
