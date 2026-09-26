import type { StoreClientFactory } from '../src/chrome-web-store';
import { describe, expect, it, vi } from 'vitest';

import { createChromeWebStore } from '../src/chrome-web-store';

const credentials = {
  extensionId: 'ext-id',
  publisherId: 'pub-id',
  clientId: 'client',
  clientSecret: 'secret',
  refreshToken: 'refresh',
};

function createClient(overrides: Record<string, unknown> = {}) {
  const client = {
    fetchToken: vi.fn(async () => 'access-token'),
    get: vi.fn(async () => ({})),
    uploadExisting: vi.fn(async () => ({ uploadState: 'SUCCEEDED' })),
    publish: vi.fn(async () => ({ state: 'PENDING_REVIEW' })),
    ...overrides,
  };
  const factory = vi.fn(() => client) as unknown as StoreClientFactory;
  return { client, factory };
}

describe('createChromeWebStore', () => {
  it('verifies, uploads and submits with one access token', async () => {
    const { client, factory } = createClient();
    const store = createChromeWebStore(credentials, factory);

    await store.verify();
    await store.upload('build');
    await expect(store.submit()).resolves.toBe('PENDING_REVIEW');

    expect(factory).toHaveBeenCalledWith(credentials);
    expect(client.fetchToken).toHaveBeenCalledTimes(1);
    expect(client.uploadExisting).toHaveBeenCalledWith('build', 'access-token', 120);
    expect(client.publish).toHaveBeenCalledWith('default', 'access-token');
    expect(store.itemUrl).toBe('https://chromewebstore.google.com/detail/ext-id');
  });

  it('explains rejected credentials', async () => {
    const { factory } = createClient({
      get: vi.fn(async () => {
        throw new Error('The OAuth client was not found.');
      }),
    });

    await expect(createChromeWebStore(credentials, factory).verify()).rejects.toThrow(
      'rejected the credentials or item: The OAuth client was not found. Check client-id',
    );
  });

  it('fails an upload that did not succeed', async () => {
    const { factory } = createClient({
      uploadExisting: vi.fn(async () => ({ uploadState: 'FAILED' })),
    });

    await expect(
      createChromeWebStore(credentials, factory).upload('x.zip'),
    ).rejects.toThrow('ended in state FAILED');
  });
});
