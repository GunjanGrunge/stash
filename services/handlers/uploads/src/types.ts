/**
 * Entity shapes the upload handlers touch.
 *
 * Deliberately a NARROW view of the File entity that `@stash/handlers-files`
 * owns: these handlers read the object key, the registered size and the
 * state, and write nothing else. Re-declaring the full attribute set here
 * would make this package a second source of truth for the File schema.
 *
 * Rule 2: a File is not a Folder and not a Stash. `stashId` names the
 * ingestion event only — it never stands in for the creator's folder.
 */

export type FileState = "pending" | "uploading" | "committed" | "failed";

export interface UploadFileRecord {
  pk: string;
  sk: string;
  entity: "FILE";
  fileId: string;
  stashId: string;
  /** Rule 6: `users/<user_id>/<file_id>`. NEVER rebuilt from client input. */
  objectKey: string;
  /** The size the manifest entry registered. The verification baseline. */
  sizeBytes: number;
  checksum: string;
  state: FileState;
  /** The S3 multipart upload id, recorded by signParts. */
  uploadId?: string;
  /** Set once the reserved quota for this file has been given back. */
  quotaReleased?: boolean;
}

/** One presigned part URL handed to the client. Never logged (invariant 6). */
export interface PartAuthorization {
  partNumber: number;
  url: string;
}

/** A part the client uploaded, as S3 reported it back. */
export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** What S3 says about the assembled object. The thing we verify against. */
export interface ObjectFacts {
  sizeBytes: number;
  etag: string;
}

/** Every handler in this package answers with this shape. */
export interface HandlerResult {
  statusCode: number;
  body: string;
}
