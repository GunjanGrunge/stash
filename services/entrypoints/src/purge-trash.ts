import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoRetentionRepository } from "../../handlers/retention/src/dynamo-repository.js";
import { purgeTrash } from "../../handlers/retention/src/purge-trash.js";
import { TABLE_NAME, bucketName, s3Client, documentClient } from "./clients.js";

const repo = new DynamoRetentionRepository(documentClient, TABLE_NAME);

/** EventBridge entry point for the once-daily 30-day Trash retention sweep. */
export const handler = async (): Promise<void> => {
  await purgeTrash({
    repo,
    objects: {
      async deleteObject(objectKey: string): Promise<void> {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: objectKey }));
      },
    },
  });
};
