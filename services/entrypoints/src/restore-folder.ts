import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { restoreFolder } from "../../handlers/files/src/restore-folder.js";
import { TABLE_NAME, documentClient } from "./clients.js";

export const handler = restoreFolder({ repo: new DynamoRepository(documentClient, TABLE_NAME) });
