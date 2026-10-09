// CORS on the photo bucket, for Sage's web build only (docs/photos-server.md 12 step 4; the phone's
// requests aren't subject to CORS). Reads the bucket from the PHOTOS_* variables, so on production it
// runs through `railway run`, and only with the user's OK:
//   cd /root/projects/clarity && railway run --service clarity-notes --environment production \
//     node /root/projects/clarity-revamp-5/tests/checks/bucket-cors.mjs
//
//   node bucket-cors.mjs            PutBucketCors (origins below; GET, PUT; header content-type), then
//                                   GetBucketCors to show what the bucket kept
//   node bucket-cors.mjs --show     GetBucketCors only
//   node bucket-cors.mjs --delete   DeleteBucketCors (the undo)
//
// Origins: http://localhost:8087 (Metro's web build), http://localhost:8089 (scripts/web-proxy.mjs) and
// the current tunnel address in /tmp/sage-web-url.txt when there is one; CORS_ORIGINS=a,b replaces them.
// Prints origins and methods only: never a variable's value, the endpoint or the keys.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/root/projects/clarity-revamp-5-ux/tests/photos/package.json");
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand, DeleteBucketCorsCommand } = require("@aws-sdk/client-s3");

const { PHOTOS_BUCKET, PHOTOS_ACCESS_KEY_ID, PHOTOS_SECRET_ACCESS_KEY, PHOTOS_ENDPOINT } = process.env;
if (!PHOTOS_BUCKET || !PHOTOS_ACCESS_KEY_ID || !PHOTOS_SECRET_ACCESS_KEY || !PHOTOS_ENDPOINT) {
  console.error("The PHOTOS_* variables aren't set (run through railway run on clarity-notes).");
  process.exit(2);
}
const s3 = new S3Client({
  region: process.env.PHOTOS_REGION || "auto",
  endpoint: PHOTOS_ENDPOINT,
  forcePathStyle: process.env.PHOTOS_PATH_STYLE === "1",
  credentials: { accessKeyId: PHOTOS_ACCESS_KEY_ID, secretAccessKey: PHOTOS_SECRET_ACCESS_KEY },
  maxAttempts: 2,
});
const Bucket = PHOTOS_BUCKET;

const tunnel = existsSync("/tmp/sage-web-url.txt") ? readFileSync("/tmp/sage-web-url.txt", "utf8").trim().replace(/\/+$/, "") : "";
const origins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:8087", "http://localhost:8089", ...(/^https:\/\/[a-z0-9.-]+$/i.test(tunnel) ? [tunnel] : [])];

const fail = (what, error) => {
  // The SDK's message can carry the host and the bucket: say the error's name and status only.
  console.error(`${what} failed: ${error?.name ?? "Error"} ${error?.$metadata?.httpStatusCode ?? "-"}`);
  process.exit(1);
};
const show = async () => {
  try {
    const out = await s3.send(new GetBucketCorsCommand({ Bucket }));
    for (const rule of out.CORSRules ?? []) {
      console.log(`rule: origins ${rule.AllowedOrigins?.join(", ")}; methods ${rule.AllowedMethods?.join(", ")}; headers ${rule.AllowedHeaders?.join(", ") ?? "-"}; max age ${rule.MaxAgeSeconds ?? "-"}`);
    }
    if (!out.CORSRules?.length) console.log("no CORS rules");
  } catch (error) {
    if (error?.name === "NoSuchCORSConfiguration") console.log("no CORS rules");
    else fail("GetBucketCors", error);
  }
};

const args = process.argv.slice(2);
if (args.includes("--delete")) {
  try { await s3.send(new DeleteBucketCorsCommand({ Bucket })); } catch (error) { fail("DeleteBucketCors", error); }
  console.log("CORS deleted");
  await show();
} else if (args.includes("--show")) {
  await show();
} else {
  try {
    await s3.send(new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["GET", "PUT"], AllowedHeaders: ["content-type"], ExposeHeaders: ["etag"], MaxAgeSeconds: 3600 }] },
    }));
  } catch (error) {
    fail("PutBucketCors", error);
  }
  console.log(`asked for: origins ${origins.join(", ")}; methods GET, PUT; header content-type`);
  await show();
}
