const fs = require("fs");
const QRCode = require("/root/projects/healers/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode");
const url = fs.readFileSync("/tmp/clarity-revamp-5-url.txt", "utf8").trim().replace(/^https:\/\//, "exp://");
const out = "/root/projects/clarity-revamp-5/docs/expo-go-qr.png";
QRCode.toFile(out, url, { errorCorrectionLevel: "M", margin: 4, scale: 16, color: { dark: "#000000", light: "#FFFFFF" } }, (err) => {
  if (err) throw err;
  console.log("wrote", out, "for", url);
});
QRCode.toString(url, { type: "terminal", small: true }, (err, s) => { if (!err) fs.writeFileSync("/tmp/clarity-revamp-5/qr.txt", s); });
