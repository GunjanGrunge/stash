import { DynamoDeviceRepository } from "../../handlers/devices/src/dynamo-repository.js";
import { revokeDevice } from "../../handlers/devices/src/revoke-device.js";
import { TABLE_NAME, documentClient } from "./clients.js";

const repo = new DynamoDeviceRepository(documentClient, TABLE_NAME);
export const handler = revokeDevice({ repo });
