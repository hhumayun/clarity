/**
 * Clarity's design tokens: "Sage" (revamp 5).
 *
 * Guided by Rosebud's design language, adapted to Clarity:
 *
 * - A warm page (a choice of four papers), and warm white cards for what
 *   you wrote. Chrome (headings, controls, the week) sits on the page;
 *   content sits on cards.
 * - Section names are small, grey and centred. They label; they never count.
 * - One accent, chosen by the person: sage unless they pick another. Colour
 *   is for actions and for "done", never a surface. Life areas have no colour.
 * - One warm, rounded sans for everything (Nunito Sans). Emphasis is weight.
 * - Every text colour reads at 4.5:1 or better on page, card and well, in
 *   both themes.
 */

export type Palette = {
  page: string; // the canvas
  card: string; // what you wrote sits on this
  quiet: string; // a card that steps back (Today's two ways in), so the tasks lead
  sunken: string; // wells inside a card: a pressed row, a field, a track
  raised: string; // menus and capsules that float over cards
  ink: string; // text that matters
  soft: string; // titles in a list of many (tasks): ink in light, a gentler ink in dark, so a list doesn't glare
  ink2: string; // secondary text
  ink3: string; // meta, placeholders, section names
  hairline: string; // the rule between rows inside a card
  line: string; // outlines: secondary buttons, chips
  warm: string; // terracotta: late, slipped
  warmSoft: string;
  danger: string;
  scrim: string; // dimming behind menus, the + dial and quick add
  glass: string; // the veil under bars when content scrolls beneath
  shadow: string; // the one elevation: things that float
  cardShadow: string; // the faint lift under a card
  // Illustration strokes and fills follow the theme.
  art: { line: string; sun: string; sunDeep: string; sky: string; cloud: string; leaf: string; leafDeep: string; soil: string; paper: string; moon: string; sand: string };
};

const lightBase: Palette = {
  page: "#F2F0EB",
  card: "#FFFFFF",
  quiet: "#F8F6F2",
  sunken: "#F4F2EE",
  raised: "#FFFFFF",
  ink: "#1F1D1A",
  soft: "#1F1D1A",
  ink2: "#57524B",
  ink3: "#6F6A62",
  hairline: "#EEEBE5",
  line: "#E1DDD5",
  warm: "#B4532A",
  warmSoft: "#F8E7DE",
  danger: "#B5372E",
  scrim: "rgba(31, 29, 26, 0.28)",
  glass: "rgba(242, 240, 235, 0.9)",
  shadow: "0px 12px 32px rgba(48, 40, 28, 0.16), 0px 2px 8px rgba(48, 40, 28, 0.08)",
  cardShadow: "0px 1px 2px rgba(64, 44, 24, 0.06), 0px 4px 14px rgba(64, 44, 24, 0.05)",
  art: {
    line: "#2B2722",
    sun: "#F6C453",
    sunDeep: "#EE9A4D",
    sky: "#B9D6EE",
    cloud: "#FFFFFF",
    leaf: "#8FC29E",
    leafDeep: "#5E9B72",
    soil: "#C99A72",
    paper: "#FFFDF8",
    moon: "#CFE0F2",
    sand: "#F2C875",
  },
};

/**
 * The light page, which the person can warm up in Settings ("Paper"). Each
 * is a page, a warm white for cards, and inks tinted to match; every text
 * colour still reads at 4.5:1 or better on page, card and well. Dark mode
 * has one page.
 */
export type PaperName = "stone" | "linen" | "oat" | "clay";
const paper = (page: string, card: string, quiet: string, sunken: string, ink: string, ink2: string, ink3: string, hairline: string, line: string, shadowTint: string): Palette => ({
  ...lightBase,
  page,
  card,
  quiet,
  sunken,
  raised: card,
  ink,
  soft: ink,
  ink2,
  ink3,
  hairline,
  line,
  scrim: `rgba(${shadowTint}, 0.28)`,
  glass: `${page}E6`,
  shadow: `0px 12px 32px rgba(${shadowTint}, 0.16), 0px 2px 8px rgba(${shadowTint}, 0.08)`,
  cardShadow: `0px 1px 2px rgba(${shadowTint}, 0.07), 0px 4px 14px rgba(${shadowTint}, 0.06)`,
  art: { ...lightBase.art, paper: card },
});
export const papers: Record<PaperName, { label: string; palette: Palette }> = {
  stone: { label: "Stone", palette: lightBase },
  linen: { label: "Linen", palette: paper("#F3ECE2", "#FFFCF7", "#FAF5EE", "#F7F1E8", "#2A231C", "#5C5146", "#74685B", "#EFE7DC", "#E4D9CA", "72, 50, 28") },
  oat: { label: "Oat", palette: paper("#EEE4D5", "#FFFAF2", "#F7F0E5", "#F6EEE2", "#2B2219", "#5D5043", "#716352", "#ECE2D2", "#DED0BC", "78, 54, 26") },
  clay: { label: "Clay", palette: paper("#F1E5DC", "#FFFAF6", "#F9F1EB", "#F8EEE7", "#2C211C", "#62524A", "#706258", "#EFE3D9", "#E3D1C5", "84, 48, 32") },
};
export const paperOrder: PaperName[] = ["stone", "linen", "oat", "clay"];
/** The default light page. */
export const light: Palette = papers.linen.palette;

export const dark: Palette = {
  page: "#121110",
  card: "#1E1C1A",
  quiet: "#191816",
  sunken: "#292724",
  raised: "#2A2825",
  ink: "#F2EFE9",
  soft: "#E2DDD4",
  ink2: "#BCB6AC",
  ink3: "#959087",
  hairline: "#2B2926",
  line: "#3A3733",
  warm: "#F0956C",
  warmSoft: "#3A2419",
  danger: "#FF8A80",
  scrim: "rgba(0, 0, 0, 0.5)",
  glass: "rgba(18, 17, 16, 0.9)",
  shadow: "0px 12px 32px rgba(0, 0, 0, 0.55), 0px 2px 8px rgba(0, 0, 0, 0.35)",
  cardShadow: "0px 0px 0px rgba(0, 0, 0, 0)",
  art: {
    line: "#ECE6DC",
    sun: "#F2C14E",
    sunDeep: "#E8924A",
    sky: "#3F5A73",
    cloud: "#3A3733",
    leaf: "#7DB48E",
    leafDeep: "#5E9B72",
    soil: "#8C6A4F",
    paper: "#2E2B27",
    moon: "#C6D7EA",
    sand: "#E3B866",
  },
};

/**
 * The accent, which the person picks in Settings (Rosebud's "pick a colour,
 * any colour"). `solid` fills the + button, primary buttons and a ticked
 * check; `soft` is a quiet selected or waiting state; `text` is the accent
 * as words (a question, a link); `deep` is the colour of focus time.
 */
export type AccentName = "sage" | "ink" | "sky" | "rose" | "amber" | "plum";
export type Accent = { solid: string; on: string; soft: string; onSoft: string; text: string; deep: string; onDeep: string };

export const accents: Record<AccentName, { label: string; light: Accent; dark: Accent }> = {
  sage: {
    label: "Sage",
    light: { solid: "#47775B", on: "#FFFFFF", soft: "#E3EDE6", onSoft: "#2F5A41", text: "#47775B", deep: "#1F3B2C", onDeep: "#F2EFE9" },
    dark: { solid: "#8DC6A5", on: "#10160F", soft: "#1F3328", onSoft: "#B9E0C8", text: "#8DC6A5", deep: "#264A37", onDeep: "#F2EFE9" },
  },
  ink: {
    label: "Ink",
    light: { solid: "#1F1D1A", on: "#FFFFFF", soft: "#ECE9E3", onSoft: "#1F1D1A", text: "#1F1D1A", deep: "#1F1D1A", onDeep: "#F2EFE9" },
    dark: { solid: "#F2EFE9", on: "#121110", soft: "#33302C", onSoft: "#F2EFE9", text: "#F2EFE9", deep: "#3A3631", onDeep: "#F2EFE9" },
  },
  sky: {
    label: "Sky",
    light: { solid: "#2E62A3", on: "#FFFFFF", soft: "#E2EAF5", onSoft: "#234C80", text: "#2E62A3", deep: "#1B3150", onDeep: "#F2EFE9" },
    dark: { solid: "#90B8EF", on: "#0E1520", soft: "#1D2B3D", onSoft: "#C3D8F6", text: "#90B8EF", deep: "#223A5C", onDeep: "#F2EFE9" },
  },
  rose: {
    label: "Rose",
    light: { solid: "#B0385A", on: "#FFFFFF", soft: "#F6E2E7", onSoft: "#8C2A47", text: "#B0385A", deep: "#47192A", onDeep: "#F2EFE9" },
    dark: { solid: "#F29CB4", on: "#200D13", soft: "#3A1F28", onSoft: "#F8C9D6", text: "#F29CB4", deep: "#572234", onDeep: "#F2EFE9" },
  },
  amber: {
    label: "Amber",
    light: { solid: "#965811", on: "#FFFFFF", soft: "#F5E9D8", onSoft: "#76450D", text: "#965811", deep: "#45290B", onDeep: "#F2EFE9" },
    dark: { solid: "#EAB56C", on: "#1E1405", soft: "#3A2C17", onSoft: "#F4D3A2", text: "#EAB56C", deep: "#553612", onDeep: "#F2EFE9" },
  },
  plum: {
    label: "Plum",
    light: { solid: "#77479F", on: "#FFFFFF", soft: "#EDE4F5", onSoft: "#5C3580", text: "#77479F", deep: "#301C47", onDeep: "#F2EFE9" },
    dark: { solid: "#CAA8EB", on: "#170F20", soft: "#2D2238", onSoft: "#E1CCF5", text: "#CAA8EB", deep: "#3E2A58", onDeep: "#F2EFE9" },
  },
};
export const accentOrder: AccentName[] = ["sage", "ink", "sky", "rose", "amber", "plum"];

/**
 * Life areas carry no colour here: an area is a grey word (and, on a note,
 * a small tag), so the page keeps one accent. The user found area colours
 * overwhelming, even as dots.
 */

/** The hour sets the greeting, the day's question and its picture. */
export type Phase = "dawn" | "day" | "dusk" | "night";
export function phaseOf(date: Date): Phase {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "dawn";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 21) return "dusk";
  return "night";
}

/** 4-point rhythm. Cards sit 16 in from the edges; words sit 16 in from a card's edge. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48 } as const;
export const edge = 16;
export const pad = 16;

/**
 * Shape: cards 18, buttons 14, sheets 28, wells 12, small marks 8; chips,
 * capsules and the + are round. Corners are continuous.
 */
export const radius = { xs: 8, sm: 12, button: 14, card: 18, lg: 28, pill: 999 } as const;

/** One family. The weight is in the face's name: custom fonts don't synthesise weights. */
export const face = {
  regular: "NunitoSans_400Regular",
  italic: "NunitoSans_400Regular_Italic",
  medium: "NunitoSans_500Medium",
  semibold: "NunitoSans_600SemiBold",
  bold: "NunitoSans_700Bold",
  heavy: "NunitoSans_800ExtraBold",
} as const;
export type Weight = keyof typeof face;

type Style = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: "uppercase";
  fontVariant?: "tabular-nums"[];
};

/**
 * One ramp. Rosebud keeps its type small and calm, and so does this: the
 * largest everyday text is a page title (26). Focus minutes are the one
 * display size.
 */
export const type = {
  display: { fontFamily: face.heavy, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title1: { fontFamily: face.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.4 },
  title2: { fontFamily: face.bold, fontSize: 21, lineHeight: 27, letterSpacing: -0.2 },
  title3: { fontFamily: face.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.1 },
  numerals: { fontFamily: face.heavy, fontSize: 104, lineHeight: 108, letterSpacing: -3, fontVariant: ["tabular-nums"] },
  headline: { fontFamily: face.bold, fontSize: 17, lineHeight: 22 },
  cardTitle: { fontFamily: face.bold, fontSize: 17, lineHeight: 23 },
  prompt: { fontFamily: face.semibold, fontSize: 18, lineHeight: 25 },
  row: { fontFamily: face.regular, fontSize: 17, lineHeight: 23 },
  body: { fontFamily: face.regular, fontSize: 17, lineHeight: 27 },
  callout: { fontFamily: face.regular, fontSize: 16, lineHeight: 22 },
  subhead: { fontFamily: face.regular, fontSize: 15, lineHeight: 20 },
  section: { fontFamily: face.semibold, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: face.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: face.semibold, fontSize: 12, lineHeight: 16 },
  eyebrow: { fontFamily: face.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: "uppercase" },
} satisfies Record<string, Style>;
export type TypeName = keyof typeof type;
