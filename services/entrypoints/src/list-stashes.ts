import { DynamoReadRepository } from "../../handlers/read/src/dynamo-repository.js";
import { listStashes } from "../../handlers/read/src/list-stashes.js";
import { TABLE_NAME, documentClient } from "./clients.js";

/**
 * Lambda entry point for `GET /stashes`.
 *
 * Wiring only — a read handler, so it never touches S3 and never resolves the
 * bucket name. The creator comes from the verified JWT subject inside the
 * handler (Rule 7).
 */
const repo = new DynamoReadRepository(documentClient, TABLE_NAME);

export const handler = listStashes({ repo });
