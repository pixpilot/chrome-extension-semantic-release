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
  /** Checks the current submission state. */
  hasPendingReview: () => Promise<boolean>;
  /** Cancels a pending review; returns false if review already completed. */
  cancelPendingSubmission: () => Promise<boolean>;
  /** Uploads a .zip file or an unpacked directory as the item's new draft. */
  upload: (packagePath: string) => Promise<void>;
  /** Submits the uploaded draft for review. */
  submit: () => Promise<string>;
}

export type StoreClientFactory = typeof chromeWebstoreUpload;

// Large packages can stay IN_PROGRESS for a while after the upload request.
const UPLOAD_WAIT_SECONDS = 120;
const API_ROOT = 'https://chromewebstore.googleapis.com';
// These API errors can mean that review finished after the status check.
// eslint-disable-next-line no-magic-numbers -- HTTP status codes
const NO_SUBMISSION_STATUSES = new Set([400, 404, 409, 412]);

class CancellationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

    async hasPendingReview() {
      const status = await client.get(await getToken());
      return (
        (status.submittedItemRevisionStatus as { state?: string } | undefined)?.state ===
        'PENDING_REVIEW'
      );
    },

    async cancelPendingSubmission() {
      try {
        const url = `${API_ROOT}/v2/publishers/${encodeURIComponent(credentials.publisherId)}/items/${encodeURIComponent(credentials.extensionId)}:cancelSubmission`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await getToken()}` },
        });

        if (!response.ok) {
          throw new CancellationError(await responseError(response), response.status);
        }
        return true;
      } catch (error) {
        if (
          error instanceof CancellationError &&
          NO_SUBMISSION_STATUSES.has(error.status) &&
          /no (?:active |pending )?(?:submission|review)|submission.*(?:not active|not found|does not exist)|not pending review|nothing to cancel/iu.test(
            error.message,
          )
        ) {
          try {
            if (!(await this.hasPendingReview())) return false;
          } catch (statusError) {
            throw new Error(
              `Chrome Web Store cancellation reported no active submission, but status could not be rechecked: ${describe(statusError)}`,
            );
          }
          throw new Error(
            'Chrome Web Store cancellation reported no active submission, but the item is still pending review. Check the developer dashboard before retrying.',
          );
        }
        throw new Error(
          `Could not cancel the pending Chrome Web Store submission: ${describe(error)}`,
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

async function responseError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const { error } = parsed;
      if (typeof error === 'object' && error !== null && 'message' in error) {
        return String(error.message);
      }
      if (typeof error === 'string') return error;
    }
  } catch {
    // A plain-text API error is still useful to the caller.
  }
  return body || `HTTP ${response.status}`;
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/u, '');
}
