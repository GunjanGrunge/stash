import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { createDownloadLease } from "../../handlers/files/src/create-download-lease.js";
import { TABLE_NAME, bucketName, documentClient, s3Client } from "./clients.js";
const repo = new DynamoRepository(documentClient, TABLE_NAME);
const presigner = { signGet: (objectKey: string, ttlSeconds: number) => getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucketName(), Key: objectKey }), { expiresIn: ttlSeconds }) };
export const handler = createDownloadLease({ repo, presigner });
