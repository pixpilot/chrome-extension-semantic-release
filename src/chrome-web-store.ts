import chromeWebstoreUpload from 'chrome-webstore-upload';

/** OAuth client and item identifiers for the Chrome Web Store API v2. */
export interface StoreCredentials {
  readonly extensionId: string;
  readonly publisherId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** The store operations a release needs. */
export interface ChromeWebStore {
  readonly itemUrl: string;
  /** Proves the credentials work and the publisher owns the item. */
  verify: () => Promise<void>;
  /** Uploads a .zip file or an unpacked directory as the item's new draft. */
  upload: (packagePath: string) => Promise<void>;
  /** Submits the uploaded draft for review. */
  submit: () => Promise<string>;
}

export type StoreClientFactory = typeof chromeWebstoreUpload;

// Large packages can stay IN_PROGRESS for a while after the upload request.
const UPLOAD_WAIT_SECONDS = 120;

export function createChromeWebStore(
  credentials: StoreCredentials,
  createClient: StoreClientFactory = chromeWebstoreUpload,
): ChromeWebStore {
  const client = createClient(credentials);
  let token: Promise<string> | undefined;

  // One access token lasts an hour, far longer than a release.
  const getToken = async (): Promise<string> => {
    token ??= client.fetchToken();
    return token;
  };

  return {
    itemUrl: `https://chromewebstore.google.com/detail/${credentials.extensionId}`,

    async verify() {
      try {
        await client.get(await getToken());
      } catch (error) {
        throw new Error(
          `Chrome Web Store rejected the credentials or item: ${describe(error)}. Check client-id, client-secret, refresh-token, publisher-id and extension-id.`,
        );
      }
    },

    async upload(packagePath) {
      const result = await client.uploadExisting(
        packagePath,
        await getToken(),
        UPLOAD_WAIT_SECONDS,
      );

      if (result.uploadState !== 'SUCCEEDED') {
        throw new Error(
          `Chrome Web Store upload ended in state ${result.uploadState}. Check the item in the developer dashboard.`,
        );
      }
    },

    async submit() {
      const result = await client.publish('default', await getToken());
      return result.state;
    },
  };
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/u, '');
}
