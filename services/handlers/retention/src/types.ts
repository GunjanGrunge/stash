/** A due retention candidate read from the sparse gsi5 queue. */
export interface DueFile {
  readonly pk: string;
  readonly sk: string;
  readonly fileId: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly state: "trashed" | "purging";
}
