# STASH API Reference

Configure the deployed `StashApiStack` `ApiUrl` output as the base URL. Send `Authorization: Bearer <Cognito ID token>` on every call. Identity is derived only from the verified token `sub`; never send a user ID. A beta user needs a provisioned DynamoDB `PROFILE` with a decimal 1 TB quota (`1000000000000` bytes) before creating a Stash.

Errors are `{ "code": string, "message": string }`: `400` invalid input or conflicting stash IDs, `401` invalid token, `404` unknown/foreign resource (indistinguishable), `409` conditional conflict, `507` quota exceeded. Retry network and `5xx` failures with exponential backoff and jitter. `Idempotency-Key` makes file registration safe to replay; the same `installationId` makes device registration safe to replay; device DELETE is idempotent. Never persist or log S3 keys, presigned URLs, or tokens.

| Endpoint | Contract |
| --- | --- |
| `POST /stashes` | Create an open Stash and reserve quota. |
| `POST /stashes/{id}/manifest-check` | Submit the manifest and receive exact/partial/none dedupe outcome. |
| `POST /stashes/{id}/files` | Register file intents. Body `stashId` must equal path `{id}`. |
| `POST /uploads/{file_id}/parts` | Obtain multipart-upload IDs and 900-second presigned part PUT URLs. |
| `POST /uploads/{file_id}/complete` | Submit upload ID and collected ETags; commits a verified file. |
| `POST /uploads/{file_id}/abort` | Abort a multipart upload. |
| `POST /stashes/{id}/complete` | Reconcile and finalize the Stash. |
| `POST /stashes/{id}/cancel` | Cancel the Stash and release reservation. |
| `GET /folders/{folderId}/children` | Read direct child folders/files. This endpoint does not currently paginate. |
| `GET /files/{id}` | Storage-neutral asset detail: id, stash/folder/path metadata, size, checksum, state, search metadata. No object key or URL. |
| `DELETE /files/{id}` | Move one committed caller-owned file to Trash. Returns `{ id, state: "trashed", purgeAfter }`. Repeating the request returns the same view. It does not delete bytes or change quota. |
| `GET /trash` | Lists the caller's recoverable trashed files as `{ items: [{ id, state, purgeAfter }] }`. |
| `POST /files/{id}/restore` | Restore a caller-owned file from Trash before the retention worker has started purging it. Returns `{ id, state: "committed" }`. |
| `GET /stashes` | Read the caller's Stashes; follow any returned pagination cursor. |
| `GET /me/usage` | `{ usedBytes, quotaBytes, provisioned }`; raw numbers, not display text. |
| `POST /devices` | `{ installationId, name, platform }` → stable server-owned active device view. |
| `DELETE /devices/{id}` | `204`; metadata-only soft revocation retained for audit. It does not invalidate Cognito sessions. |

## Direct multipart Stash sequence

1. Sign in through Cognito SRP and retain the short-lived ID token.
2. Create a Stash, manifest-check it, then register files with `Idempotency-Key`.
3. For each file, request part URLs, PUT bytes directly to S3, collect returned ETags, and complete it. Treat URLs as bearer secrets; renew expired URLs and retry failed parts individually.
4. Complete the Stash once all files commit, then browse folders/files and usage from any authorized device.

Payload bytes never pass through Lambda or API Gateway; frontend clients need no AWS credentials. File, Folder, and Stash remain separate entities. Beta device revocation has no Cognito/session linkage.

## Trash and recovery

`DELETE /files/{id}` is a recoverable action, not an S3 delete. A trashed
file disappears from folder children and `GET /files/{id}`, but it continues to
count toward quota because its payload remains stored. Show `purgeAfter` as
the recovery deadline. STASH permanently deletes eligible payloads no earlier
than that timestamp (daily retention processing can add up to 24 hours).
Restoring preserves the original file ID, folder ID, relative path, and
opaque object key; it never renames or moves creator content. A file that has
entered permanent purging is indistinguishable from a missing file (`404`) and
cannot be restored.
