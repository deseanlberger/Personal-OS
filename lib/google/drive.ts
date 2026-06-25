/**
 * Google Drive upload helper.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_DRIVE_REFRESH_TOKEN  (separate from gmail token — needs drive.file scope)
 *   GOOGLE_DRIVE_TAX_FOLDER_ID  (target folder in your Drive — get it from the folder URL)
 *
 * Setup once via developers.google.com/oauthplayground:
 *   1. Use your own credentials → paste Web Application client id + secret
 *   2. Scope: https://www.googleapis.com/auth/drive.file
 *   3. Authorize + exchange → copy the refresh_token to Vercel env
 *   4. Make a "Receipts" folder in your Drive, open it, copy the ID from
 *      the URL (the part after /folders/) → GOOGLE_DRIVE_TAX_FOLDER_ID
 */

export function driveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_TAX_FOLDER_ID
  );
}

async function accessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`drive token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('drive token exchange returned no access_token');
  return body.access_token;
}

export type DriveUploadResult = {
  file_id: string;
  web_view_link: string;
};

/**
 * Upload a receipt image to the configured tax folder using Drive's multipart
 * upload API. Returns the file id + viewable URL so we can pin them back onto
 * the transaction row.
 */
export async function uploadReceipt(
  bytes: Buffer,
  mime: string,
  filename: string,
): Promise<DriveUploadResult> {
  const token = await accessToken();
  const folderId = process.env.GOOGLE_DRIVE_TAX_FOLDER_ID!;

  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: mime,
  };

  // Multipart body: metadata JSON part + binary part separated by boundary.
  const boundary = 'pos-' + Math.random().toString(36).slice(2);
  const delim = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const header = Buffer.from(
    delim +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delim +
      `Content-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const footer = Buffer.from(closeDelim, 'utf8');
  const body = Buffer.concat([header, bytes, footer]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: string; webViewLink?: string };
  if (!json.id) throw new Error('drive upload returned no id');
  return { file_id: json.id, web_view_link: json.webViewLink || `https://drive.google.com/file/d/${json.id}/view` };
}
