import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { trashFile } from "../../handlers/files/src/trash-file.js";
import { TABLE_NAME, documentClient } from "./clients.js";

export const handler = trashFile({ repo: new DynamoRepository(documentClient, TABLE_NAME) });
