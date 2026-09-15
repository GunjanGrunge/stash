import { checkManifest } from "../../handlers/manifest/src/check-manifest.js";
import { TABLE_NAME, documentClient } from "./clients.js";
import { DynamoManifestRepository } from "./manifest-repository.js";

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

export const handler = checkManifest({ repo });
