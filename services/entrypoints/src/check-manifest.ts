import { checkManifest } from "../../handlers/manifest/src/check-manifest.js";
import { DynamoManifestRepository } from "../../handlers/manifest/src/dynamo-repository.js";
import { DynamoStashRepository } from "../../handlers/stashes/src/dynamo-repository.js";
import { TABLE_NAME, documentClient } from "./clients.js";

/**
 * Lambda entry point for `POST /stashes/{id}/manifest-check`.
 *
 * The manifest package ships no production repository of its own, so this uses
 * the PROVISIONAL adapter in `manifest-repository.ts` — see the escalation note
 * there before relying on this endpoint.
 *
 * The handler reads its folder name and entries from the body only; the `{id}`
 * path parameter is not consulted.
 */
const repo = new DynamoManifestRepository(documentClient, TABLE_NAME);
const stashes = new DynamoStashRepository(documentClient, TABLE_NAME);

export const handler = checkManifest({ repo, stashes });
