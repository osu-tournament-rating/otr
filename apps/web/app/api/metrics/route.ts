import { optionalEnv } from '@otr/core/utils/env';
import { NextResponse } from 'next/server';
import { metricsRegistry } from '@/lib/metrics';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  // Without a token, the metrics stay closed to everyone rather than open
  const expectedToken = optionalEnv(process.env.METRICS_AUTH_TOKEN);

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const metrics = await metricsRegistry.metrics();
  return new NextResponse(metrics, {
    headers: { 'Content-Type': metricsRegistry.contentType },
  });
}
