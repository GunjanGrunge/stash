import { DynamoReadRepository } from "../../handlers/read/src/dynamo-repository.js";
import { getUsage } from "../../handlers/read/src/get-usage.js";
import { TABLE_NAME, documentClient } from "./clients.js";

/**
 * Lambda entry point for `GET /me/usage`.
 *
 * Wiring only — a read handler, so it never touches S3 and never resolves the
 * bucket name. The creator comes from the verified JWT subject inside the
 * handler (Rule 7).
 */
const repo = new DynamoReadRepository(documentClient, TABLE_NAME);

export const handler = getUsage({ repo });
