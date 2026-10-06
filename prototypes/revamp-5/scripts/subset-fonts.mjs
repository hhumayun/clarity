import subsetFont from "subset-font";
import { readFile, writeFile } from "node:fs/promises";

// Google Fonts' "latin" range, plus the curly quotes, dashes and ellipsis
// writers use: what a note's words need, at a fraction of the size.
const ranges = [
  [0x0020, 0x00ff], [0x0131, 0x0131], [0x0152, 0x0153], [0x02bb, 0x02bc], [0x02c6, 0x02c6],
  [0x02da, 0x02da], [0x02dc, 0x02dc], [0x2000, 0x206f], [0x2074, 0x2074], [0x20ac, 0x20ac],
  [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215],
  [0xfeff, 0xfeff], [0xfffd, 0xfffd],
];
let text = "";
for (const [from, to] of ranges) for (let c = from; c <= to; c++) text += String.fromCodePoint(c);

const src = "/root/projects/clarity-revamp-5/node_modules/@expo-google-fonts/nunito-sans";
const out = "/root/projects/clarity-revamp-5/editor/fonts";
const faces = [
  ["400Regular/NunitoSans_400Regular.ttf", "NunitoSans-Regular.woff2"],
  ["400Regular_Italic/NunitoSans_400Regular_Italic.ttf", "NunitoSans-Italic.woff2"],
  ["600SemiBold/NunitoSans_600SemiBold.ttf", "NunitoSans-SemiBold.woff2"],
  ["700Bold/NunitoSans_700Bold.ttf", "NunitoSans-Bold.woff2"],
];
for (const [from, to] of faces) {
  const font = await readFile(`${src}/${from}`);
  const small = await subsetFont(font, text, { targetFormat: "woff2" });
  await writeFile(`${out}/${to}`, small);
  console.log(to, font.length, "->", small.length);
}
