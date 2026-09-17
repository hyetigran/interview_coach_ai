import { Container } from '@cloudflare/containers';
import { createBudgetLedger } from '../server/budget';

// Each durable object represents one paid attempt. Never restart a consumed attempt.
export class MediaProcessor extends Container<{DB: D1Database}> {
  defaultPort = 8790;
  sleepAfter = '120s';
  enableInternet = false;

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!/^\/(operations|compression)\/(?:transcript-)?prepare-[a-f0-9-]{36}(?:-(?:prepare-)?attempt-[12])?$/.test(path) || request.headers.has('origin')) return new Response('Not found', {status:404});
    if (request.method === 'DELETE') {
      await this.ctx.storage.put('consumed', true);
      await this.destroy();
      return new Response(null, {status:204});
    }
    if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
    const secret = crypto.randomUUID() + crypto.randomUUID();
    const admitted = await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get('consumed')) return 409;
      // $0.10 stays reserved until Cloudflare billing is reconciled. No invented receipt.
      if (!await createBudgetLedger(this.env.DB).reserve('media-' + path.slice(1).replace('/', '-'), 'cloudflare-media-v1', 100000)) return 402;
      await this.ctx.storage.put('consumed', true);
      await this.schedule(120, 'expire');
      await this.startAndWaitForPorts({ports:8790, startOptions:{envVars:{AUTH_SECRET:secret},enableInternet:false}, cancellationOptions:{instanceGetTimeoutMS:10000,portReadyTimeoutMS:10000}});
      return 200;
    });
    if (admitted !== 200) return new Response(admitted === 402 ? 'The processing allowance cannot cover media preparation.' : 'This media attempt was already submitted. Retry after cancellation completes.', {status:admitted});
    try {
      // Avoid containerFetch's automatic restart after an uncertain/terminated execution.
      const init: RequestInit & {duplex:'half'} = {method:'POST',headers:{authorization:`Bearer ${secret}`},body:request.body,signal:request.signal,duplex:'half'};
      const response = await this.ctx.container!.getTcpPort(8790).fetch(new Request(`http://localhost:8790${path}`, init));
      if (!response.body) { await this.destroy(); return response; }
      const reader = response.body.getReader();
      let stopping: Promise<void> | undefined;
      const stop = () => stopping ??= this.destroy();
      return new Response(new ReadableStream({
        async pull(controller) {
          try { const next = await reader.read(); if (next.done) { await stop(); controller.close(); } else controller.enqueue(next.value); }
          catch (error) { await stop(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { await stop(); } },
      }), {status:response.status,headers:response.headers});
    } catch { await this.destroy(); return new Response('Media processing failed. Retry after cancellation completes.', {status:502}); }
  }

  async expire() { await this.destroy(); }
}

export default { fetch() { return new Response('Not found', {status:404}); } };
