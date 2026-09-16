import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { DynamoStashRepository } from "../../handlers/stashes/src/dynamo-repository.js";
import { registerFiles } from "../../handlers/files/src/register-files.js";
import { TABLE_NAME, documentClient } from "./clients.js";

/**
 * Lambda entry point for `POST /stashes/{id}/files`.
 *
 * Wiring only. The handler resolves existing folders before minting new ones
 * and writes in transaction-sized chunks (Addendum A3); none of that logic
 * belongs here.
 *
 * Note for the reader: this handler takes its `stashId` from the request BODY,
 * not from the `{id}` path parameter — the path segment exists for URL shape
 * and is never consulted.
 */
const repo = new DynamoRepository(documentClient, TABLE_NAME);
const stashes = new DynamoStashRepository(documentClient, TABLE_NAME);

export const handler = registerFiles({ repo, stashes });
