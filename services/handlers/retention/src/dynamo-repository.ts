import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RetentionRepository } from "./repository.js";
import type { DueFile, DueFolder, DueItem, FolderDescendant } from "./types.js";

const hex = (value: string): string => Buffer.from(value, "utf8").toString("hex");
const folderIdentitySk = (parentFolderId: string | null, name: string): string =>
  `FOLDERID#${hex(parentFolderId ?? "ROOT")}#${hex(name)}`;

function isConditionalFailure(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

/** DynamoDB implementation. It never scans: the sparse gsi5 is the queue. */
export class DynamoRetentionRepository implements RetentionRepository {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly tableName: string) {}

  async listDue(now: string): Promise<DueItem[]> {
    const due: DueItem[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: "gsi5",
        KeyConditionExpression: "gsi5pk = :queue AND gsi5sk <= :due",
        ExpressionAttributeValues: { ":queue": "PURGE", ":due": `AT#${now}#~` },
        ExclusiveStartKey: cursor as never,
      }));
      for (const item of page.Items ?? []) {
        if (item.entity === "FILE" && (item.state === "trashed" || item.state === "purging") && typeof item.pk === "string" && typeof item.sk === "string" && typeof item.fileId === "string" && typeof item.objectKey === "string" && typeof item.sizeBytes === "number") {
          due.push({ ...(item as DueFile), entity: "FILE" });
        }
        if (item.entity === "FOLDER" && (item.state === "trashed" || item.state === "purging") && typeof item.pk === "string" && typeof item.sk === "string" && typeof item.folderId === "string" && typeof item.name === "string" && (typeof item.parentFolderId === "string" || item.parentFolderId === null)) {
          due.push({ ...(item as DueFolder), entity: "FOLDER" });
        }
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);
    return due;
  }

  async claim(item: DueItem): Promise<boolean> {
    if (item.state === "purging") return true; // resume a worker interrupted after its safe S3 delete.
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: item.pk, sk: item.sk },
        ConditionExpression: "entity = :entity AND #state = :trashed AND gsi5pk = :queue",
        UpdateExpression: "SET #state = :purging",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":entity": item.entity, ":trashed": "trashed", ":purging": "purging", ":queue": "PURGE" },
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  async finalize(file: DueFile): Promise<void> {
    const userPk = file.pk;
    await this.doc.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: this.tableName,
            Key: { pk: file.pk, sk: file.sk },
            ConditionExpression: "entity = :file AND #state = :purging",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":file": "FILE", ":purging": "purging" },
          },
        },
        {
          Update: {
            TableName: this.tableName,
            Key: { pk: userPk, sk: "PROFILE" },
            ConditionExpression: "entity = :profile AND usedBytes >= :size",
            UpdateExpression: "SET usedBytes = usedBytes - :size",
            ExpressionAttributeValues: { ":profile": "PROFILE", ":size": file.sizeBytes },
          },
        },
      ],
    }));
  }

  async listFolderChildren(folder: DueFolder): Promise<FolderDescendant[]> {
    const items: FolderDescendant[] = [];
    let cursor: Record<string, unknown> | undefined;
    const gsi1pk = `${folder.pk}#PARENT#${folder.folderId}`;
    do {
      const page = await this.doc.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :gsi1pk",
        FilterExpression: "pk = :pk",
        ExpressionAttributeValues: { ":gsi1pk": gsi1pk, ":pk": folder.pk },
        ExclusiveStartKey: cursor as never,
      }));
      for (const item of page.Items ?? []) {
        if (item.entity === "FILE" && item.state === "committed" && typeof item.fileId === "string" && typeof item.objectKey === "string" && typeof item.sizeBytes === "number") items.push({ ...(item as DueFile), entity: "FILE", state: "purging" });
        if (item.entity === "FOLDER" && (item.state === undefined || item.state === "active") && typeof item.folderId === "string" && typeof item.name === "string" && (typeof item.parentFolderId === "string" || item.parentFolderId === null)) items.push({ ...(item as DueFolder), entity: "FOLDER", state: "purging" });
      }
      cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor !== undefined);
    return items;
  }

  async finalizeFolderBatch(root: DueFolder, files: DueFile[], folders: DueFolder[]): Promise<void> {
    if (files.length === 0 && folders.length === 0) return;
    const actions: Record<string, unknown>[] = [{
      ConditionCheck: {
        TableName: this.tableName,
        Key: { pk: root.pk, sk: root.sk },
        ConditionExpression: "entity = :folder AND #state = :purging",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":folder": "FOLDER", ":purging": "purging" },
      },
    }];
    for (const file of files) actions.push({
      Delete: {
        TableName: this.tableName, Key: { pk: file.pk, sk: file.sk },
        ConditionExpression: "entity = :file AND #state = :committed",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":file": "FILE", ":committed": "committed" },
      },
    });
    for (const folder of folders) {
      actions.push({ Delete: { TableName: this.tableName, Key: { pk: folder.pk, sk: folderIdentitySk(folder.parentFolderId, folder.name) }, ConditionExpression: "entity = :identity", ExpressionAttributeValues: { ":identity": "FOLDERID" } } });
      actions.push({ Delete: { TableName: this.tableName, Key: { pk: folder.pk, sk: folder.sk }, ConditionExpression: "entity = :folder AND (attribute_not_exists(#state) OR #state = :active)", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":folder": "FOLDER", ":active": "active" } } });
    }
    const bytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (files.length > 0) actions.push({ Update: { TableName: this.tableName, Key: { pk: root.pk, sk: "PROFILE" }, ConditionExpression: "entity = :profile AND usedBytes >= :size", UpdateExpression: "SET usedBytes = usedBytes - :size", ExpressionAttributeValues: { ":profile": "PROFILE", ":size": bytes } } });
    await this.doc.send(new TransactWriteCommand({ TransactItems: actions as never }));
  }

  async finalizeFolderRoot(root: DueFolder): Promise<void> {
    await this.doc.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: this.tableName, Key: { pk: root.pk, sk: folderIdentitySk(root.parentFolderId, root.name) }, ConditionExpression: "entity = :identity", ExpressionAttributeValues: { ":identity": "FOLDERID" } } },
        { Delete: { TableName: this.tableName, Key: { pk: root.pk, sk: root.sk }, ConditionExpression: "entity = :folder AND #state = :purging", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":folder": "FOLDER", ":purging": "purging" } } },
      ],
    }));
  }
}
