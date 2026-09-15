import { DynamoStashRepository } from "../../handlers/stashes/src/dynamo-repository.js";
import { completeStash } from "../../handlers/stashes/src/complete-stash.js";
import { TABLE_NAME, documentClient } from "./clients.js";

/**
 * Lambda entry point for `POST /stashes/{id}/complete`.
 *
 * Wiring only: it binds the real DynamoDB-backed repository to the injected
 * handler factory. Every rule this endpoint enforces lives in
 * `handlers/stashes/src/complete-stash.ts`, where it is tested without AWS.
 *
 * The repository is built ONCE at module scope so a warm invocation reuses it.
 */
const repo = new DynamoStashRepository(documentClient, TABLE_NAME);

export const handler = completeStash({ repo });
