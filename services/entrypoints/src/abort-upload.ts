import { DynamoUploadRepository } from "../../handlers/uploads/src/dynamo-repository.js";
import { S3MultipartStore } from "../../handlers/uploads/src/s3-multipart.js";
import { abortUpload } from "../../handlers/uploads/src/abort-upload.js";
import { TABLE_NAME, bucketName, documentClient, s3Client } from "./clients.js";

/**
 * Lambda entry point for `POST /uploads/{file_id}/abort`.
 *
 * Wiring only. The bucket name comes from the environment, never from the
 * request, and the S3 KEY is always read from the stored File record inside
 * the handler (Rule 6) — nothing here can steer it.
 *
 * Both dependencies are built ONCE at module scope so a warm invocation reuses
 * the SDK clients rather than re-resolving credentials per part signature.
 */
const repo = new DynamoUploadRepository(documentClient, TABLE_NAME);
const store = new S3MultipartStore(s3Client, bucketName());

export const handler = abortUpload({ repo, store });
