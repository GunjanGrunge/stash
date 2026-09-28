import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { trashFolder } from "../../handlers/files/src/trash-folder.js";
import { TABLE_NAME, documentClient } from "./clients.js";

export const handler = trashFolder({ repo: new DynamoRepository(documentClient, TABLE_NAME) });
