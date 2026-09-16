import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { listChildren } from "../../handlers/files/src/list-children.js";
import { TABLE_NAME, documentClient } from "./clients.js";

/**
 * Lambda entry point for `GET /folders/{folderId}/children`.
 *
 * The path parameter is spelled `folderId` because that is the name the
 * handler reads (`pathParameters.folderId`, falling back to
 * `parentFolderId`). Routing it as `{id}` would silently hand every request a
 * `null` parent and list the creator's ROOT folder instead of the folder they
 * opened, while every unit test still passed.
 */
const repo = new DynamoRepository(documentClient, TABLE_NAME);

export const handler = listChildren({ repo });
