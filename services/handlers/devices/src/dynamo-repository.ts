import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DeviceRepository } from "./repository.js";
import type { DeviceRecord, RegisterDeviceInput } from "./types.js";

const hex = (value: string) => Buffer.from(value, "utf8").toString("hex");
const installationSk = (installationId: string) => `DEVICEINSTALL#${hex(installationId)}`;

export class DynamoDeviceRepository implements DeviceRepository {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly tableName: string) {}

  async register(userId: string, input: RegisterDeviceInput, now: string): Promise<DeviceRecord> {
    const pk = `USER#${userId}`;
    const lookup = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk: installationSk(input.installationId) }, ConsistentRead: true }));
    const knownId = lookup.Item?.["deviceId"];
    if (typeof knownId === "string") return this.updateExisting(pk, knownId, input);
    const deviceId = randomUUID();
    const record: DeviceRecord = { pk, sk: `DEVICE#${deviceId}`, entity: "DEVICE", deviceId, installationId: input.installationId, name: input.name, platform: input.platform, registeredAt: now };
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.tableName, Item: record, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.tableName, Item: { pk, sk: installationSk(input.installationId), entity: "DEVICEINSTALL", deviceId }, ConditionExpression: "attribute_not_exists(pk)" } },
      ] }));
      return record;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException || (error as { name?: string })?.name === "TransactionCanceledException") {
        const raced = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk: installationSk(input.installationId) }, ConsistentRead: true }));
        const racedId = raced.Item?.["deviceId"];
        if (typeof racedId === "string") return this.updateExisting(pk, racedId, input);
      }
      throw error;
    }
  }

  private async updateExisting(pk: string, deviceId: string, input: RegisterDeviceInput): Promise<DeviceRecord> {
    const result = await this.doc.send(new UpdateCommand({
      TableName: this.tableName, Key: { pk, sk: `DEVICE#${deviceId}` },
      UpdateExpression: "SET #name = :name, platform = :platform REMOVE revokedAt",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: { ":name": input.name, ":platform": input.platform },
      ConditionExpression: "attribute_exists(pk)", ReturnValues: "ALL_NEW",
    }));
    return result.Attributes as DeviceRecord;
  }

  async find(userId: string, deviceId: string): Promise<DeviceRecord | undefined> {
    const result = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk: `USER#${userId}`, sk: `DEVICE#${deviceId}` }, ConsistentRead: true }));
    const item = result.Item as DeviceRecord | undefined;
    return item?.entity === "DEVICE" ? item : undefined;
  }

  async revoke(userId: string, deviceId: string, now: string): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand({ TableName: this.tableName, Key: { pk: `USER#${userId}`, sk: `DEVICE#${deviceId}` }, UpdateExpression: "SET revokedAt = if_not_exists(revokedAt, :now)", ExpressionAttributeValues: { ":now": now }, ConditionExpression: "attribute_exists(pk)" }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException || (error as { name?: string })?.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }
}
