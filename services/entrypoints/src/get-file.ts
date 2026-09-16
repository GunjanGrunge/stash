import { DynamoRepository } from "../../handlers/files/src/dynamo-repository.js";
import { getFile } from "../../handlers/files/src/get-file.js";
import { TABLE_NAME, documentClient } from "./clients.js";

const repo = new DynamoRepository(documentClient, TABLE_NAME);
export const handler = getFile({ repo });
