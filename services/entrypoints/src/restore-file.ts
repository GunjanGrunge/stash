import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { restoreFile } from "../../handlers/files/src/restore-file.js";
import { TABLE_NAME, documentClient } from "./clients.js";

export const handler = restoreFile({ repo: new DynamoRepository(documentClient, TABLE_NAME) });
