// Makes the local bucket for the photo checks (docs/photos-server.md, 11.1) on
// the local S3 (versitygw on 127.0.0.1:9400, started by stack.sh), and sets its
// CORS so Sage's web build, served at http://localhost:8095 by a second
// scripts/web-proxy.mjs, can PUT and GET photos straight to it. Safe to run
// again. Refuses any endpoint that isn't on this machine.
//
//   node bucket-setup.mjs        PHOTOS_ENDPOINT, PHOTOS_BUCKET, PHOTOS_ACCESS_KEY_ID, PHOTOS_SECRET_ACCESS_KEY
//                                (defaults: the local stack's, see local-env.sh)
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

const endpoint = process.env.PHOTOS_ENDPOINT || "http://127.0.0.1:9400";
const Bucket = process.env.PHOTOS_BUCKET || "clarity-photos-local";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) {
  console.error("bucket-setup.mjs only sets up a local bucket.");
  process.exit(2);
}
const s3 = new S3Client({
  region: process.env.PHOTOS_REGION || "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.PHOTOS_ACCESS_KEY_ID || "labkey",
    secretAccessKey: process.env.PHOTOS_SECRET_ACCESS_KEY || "labsecret123",
  },
});

const ORIGINS = (process.env.PHOTOS_CORS_ORIGINS || "http://localhost:8095,http://127.0.0.1:8095")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

let exists = true;
try {
  await s3.send(new HeadBucketCommand({ Bucket }));
} catch {
  exists = false;
}
if (!exists) {
  await s3.send(new CreateBucketCommand({ Bucket }));
  console.log(`bucket ${Bucket}: made`);
} else {
  console.log(`bucket ${Bucket}: already there`);
}

try {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ORIGINS,
            AllowedMethods: ["GET", "PUT"],
            AllowedHeaders: ["content-type"],
            ExposeHeaders: ["etag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  const cors = await s3.send(new GetBucketCorsCommand({ Bucket }));
  const rule = cors.CORSRules?.[0];
  console.log(`CORS: origins ${rule?.AllowedOrigins?.join(", ")}; methods ${rule?.AllowedMethods?.join(", ")}; headers ${rule?.AllowedHeaders?.join(", ")}`);
} catch (error) {
  console.log(`CORS: not kept by this S3 (${error?.name ?? "Error"}); Sage's web build can't reach the bucket without it`);
  process.exitCode = 1;
}
