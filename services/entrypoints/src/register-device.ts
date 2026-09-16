import { DynamoDeviceRepository } from "../../handlers/devices/src/dynamo-repository.js";
import { registerDevice } from "../../handlers/devices/src/register-device.js";
import { TABLE_NAME, documentClient } from "./clients.js";

const repo = new DynamoDeviceRepository(documentClient, TABLE_NAME);
export const handler = registerDevice({ repo });
