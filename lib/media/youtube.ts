/** Accept only single-video YouTube URLs; never pass user URLs to a downloader. */
export function youtubeVideoId(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid YouTube video link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS YouTube video link.');
  let id: string | null = null;
  if (url.hostname === 'youtu.be' && /^\/[^/]+\/?$/.test(url.pathname)) id = url.pathname.split('/')[1];
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Paste a single YouTube video link, not a channel or playlist.');
  return id;
}

export function youtubeEndSeconds(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const match = /^(?:(\d{1,2}):)?([0-5]?\d):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[3]) > 59) throw new Error('Use mm:ss or hh:mm:ss for the stop time.');
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (seconds <= 0 || seconds > 3600) throw new Error('Choose a stop time between 00:01 and 1:00:00.');
  return seconds;
}
