import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface StashDataStackProps extends cdk.StackProps {}

/**
 * STASH data stack: the single DynamoDB table that holds the logical
 * filesystem, and the S3 bucket that holds object payloads.
 *
 * Both resources use RemovalPolicy.RETAIN on purpose: `cdk destroy` must never
 * delete a creator's library.
 */
export class StashDataStack extends cdk.Stack {
  readonly table: dynamodb.Table;
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StashDataStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "StashTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // gsi4 is each creator's recoverable Trash view. gsi5 is the sparse,
    // global queue the retention worker uses to find files due for purge.
    // File records omit both keys until they are moved to Trash.
    for (const n of [1, 2, 3, 4, 5] as const) {
      this.table.addGlobalSecondaryIndex({
        indexName: `gsi${n}`,
        partitionKey: {
          name: `gsi${n}pk`,
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: { name: `gsi${n}sk`, type: dynamodb.AttributeType.STRING },
      });
    }

    // Rule 8: versioning is deliberately OFF — writers must never overwrite an
    // existing key, because an accidental overwrite is unrecoverable.
    this.bucket = new s3.Bucket(this, "StashBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
