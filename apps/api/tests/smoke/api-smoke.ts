const baseUrl = process.env.API_SMOKE_BASE_URL?.replace(/\/$/, '');
if (!baseUrl) throw new Error('Set API_SMOKE_BASE_URL to the backend origin.');

const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA;
const health = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(8_000) });
if (!health.ok) throw new Error(`API readiness returned HTTP ${health.status}.`);
if (expectedReleaseSha && health.headers.get('x-release-sha') !== expectedReleaseSha) {
  throw new Error('The API health check did not report the expected release SHA.');
}

const contractResponse = await fetch(`${baseUrl}/api/openapi.json`, { signal: AbortSignal.timeout(8_000) });
if (!contractResponse.ok) throw new Error(`OpenAPI returned HTTP ${contractResponse.status}.`);
const contract = await contractResponse.json() as { openapi?: string; paths?: Record<string, unknown> };
const operations = Object.values(contract.paths ?? {}).reduce((total, path) => {
  if (typeof path !== 'object' || path === null) return total;
  return total + Object.keys(path).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).length;
}, 0);
if (contract.openapi !== '3.1.0' || operations !== 49) {
  throw new Error('The live OpenAPI contract version or operation count did not match the backend contract.');
}

process.stdout.write('Backend smoke passed: readiness, release identity, and 49-operation OpenAPI contract.\n');
