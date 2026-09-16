import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { listTrash } from "../../handlers/files/src/list-trash.js";
import { TABLE_NAME, documentClient } from "./clients.js";

export const handler = listTrash({ repo: new DynamoRepository(documentClient, TABLE_NAME) });
