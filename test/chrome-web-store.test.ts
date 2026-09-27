import type { StoreClientFactory } from '../src/chrome-web-store';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => vi.unstubAllGlobals());

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

  it('leaves published and draft items unchanged', async () => {
    const { client, factory } = createClient({
      get: vi
        .fn()
        .mockResolvedValueOnce({ submittedItemRevisionStatus: { state: 'PUBLISHED' } })
        .mockResolvedValueOnce({}),
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    expect(await createChromeWebStore(credentials, factory).hasPendingReview()).toBe(
      false,
    );
    expect(await createChromeWebStore(credentials, factory).hasPendingReview()).toBe(
      false,
    );
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels a pending review with the existing token and no request body', async () => {
    const { client, factory } = createClient({
      get: vi.fn(async () => ({
        submittedItemRevisionStatus: { state: 'PENDING_REVIEW' },
      })),
    });
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = createChromeWebStore(credentials, factory);

    expect(await store.hasPendingReview()).toBe(true);
    expect(await store.cancelPendingSubmission()).toBe(true);

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://chromewebstore.googleapis.com/v2/publishers/pub-id/items/ext-id:cancelSubmission',
      { method: 'POST', headers: { Authorization: 'Bearer access-token' } },
    );
    expect(client.fetchToken).toHaveBeenCalledOnce();
  });

  it('rechecks status when cancellation reports no active submission', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        submittedItemRevisionStatus: { state: 'PENDING_REVIEW' },
      })
      .mockResolvedValueOnce({
        submittedItemRevisionStatus: { state: 'PUBLISHED' },
      });
    const { factory } = createClient({ get });
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'No active submission to cancel' } }),
          {
            status: 400,
          },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const store = createChromeWebStore(credentials, factory);

    expect(await store.hasPendingReview()).toBe(true);
    expect(await store.cancelPendingSubmission()).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('stops when cancellation reports no active submission but status is still pending', async () => {
    const { factory } = createClient({
      get: vi.fn(async () => ({
        submittedItemRevisionStatus: { state: 'PENDING_REVIEW' },
      })),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'No active submission' } }), {
            status: 400,
          }),
      ),
    );
    const store = createChromeWebStore(credentials, factory);

    await expect(store.cancelPendingSubmission()).rejects.toThrow(
      'item is still pending review',
    );
  });

  it('surfaces API, authentication and network failures', async () => {
    const { factory } = createClient();
    const store = createChromeWebStore(credentials, factory);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'daily quota exceeded' } }), {
            status: 429,
          }),
      ),
    );
    await expect(store.cancelPendingSubmission()).rejects.toThrow('daily quota exceeded');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection reset');
      }),
    );
    await expect(store.cancelPendingSubmission()).rejects.toThrow('connection reset');

    const badToken = createClient({
      fetchToken: vi.fn(async () => {
        throw new Error('invalid grant');
      }),
    });
    await expect(
      createChromeWebStore(credentials, badToken.factory).cancelPendingSubmission(),
    ).rejects.toThrow('invalid grant');
  });
});
