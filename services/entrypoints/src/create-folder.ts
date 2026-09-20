import { createFolder } from "../../handlers/files/src/create-folder.js";
import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { TABLE_NAME, documentClient } from "./clients.js";

export const handler = createFolder({ repo: new DynamoRepository(documentClient, TABLE_NAME) });
