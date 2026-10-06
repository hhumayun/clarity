import { SymbolView, type SFSymbol } from "expo-symbols";
// One import per icon: the package root pulls all ~1,900 icons into a dev bundle.
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ArrowRightToLine from "lucide-react-native/icons/arrow-right-to-line";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import Bell from "lucide-react-native/icons/bell";
import Calendar from "lucide-react-native/icons/calendar";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CalendarX from "lucide-react-native/icons/calendar-x";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Clock from "lucide-react-native/icons/clock";
import Coffee from "lucide-react-native/icons/coffee";
import Droplet from "lucide-react-native/icons/droplet";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Eye from "lucide-react-native/icons/eye";
import FileText from "lucide-react-native/icons/file-text";
import Flag from "lucide-react-native/icons/flag";
import Glasses from "lucide-react-native/icons/glasses";
import Hash from "lucide-react-native/icons/hash";
import Hourglass from "lucide-react-native/icons/hourglass";
import KeyboardOff from "lucide-react-native/icons/keyboard-off";
import Lightbulb from "lucide-react-native/icons/lightbulb";
import Link from "lucide-react-native/icons/link";
import List from "lucide-react-native/icons/list";
import ListChecks from "lucide-react-native/icons/list-checks";
import ListFilter from "lucide-react-native/icons/list-filter";
import ListIndentIncrease from "lucide-react-native/icons/list-indent-increase";
import Moon from "lucide-react-native/icons/moon";
import NotebookText from "lucide-react-native/icons/notebook-text";
import Palette from "lucide-react-native/icons/palette";
import Pause from "lucide-react-native/icons/pause";
import PencilLine from "lucide-react-native/icons/pencil-line";
import PersonStanding from "lucide-react-native/icons/person-standing";
import Play from "lucide-react-native/icons/play";
import Plus from "lucide-react-native/icons/plus";
import Repeat from "lucide-react-native/icons/repeat";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Search from "lucide-react-native/icons/search";
import Settings from "lucide-react-native/icons/settings";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Sparkles from "lucide-react-native/icons/sparkles";
import SquarePen from "lucide-react-native/icons/square-pen";
import Sun from "lucide-react-native/icons/sun";
import Sunrise from "lucide-react-native/icons/sunrise";
import Sunset from "lucide-react-native/icons/sunset";
import Timer from "lucide-react-native/icons/timer";
import Trash2 from "lucide-react-native/icons/trash";
import Type from "lucide-react-native/icons/type";
import Undo2 from "lucide-react-native/icons/undo-2";
import X from "lucide-react-native/icons/x";
import Leaf from "lucide-react-native/icons/leaf";
import Sprout from "lucide-react-native/icons/sprout";
import Mic from "lucide-react-native/icons/mic";
import ImageIcon from "lucide-react-native/icons/image";
import Copy from "lucide-react-native/icons/copy";
import Share2 from "lucide-react-native/icons/share-2";
import Bookmark from "lucide-react-native/icons/bookmark";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Shuffle from "lucide-react-native/icons/shuffle";
import Tag from "lucide-react-native/icons/tag";
import CirclePlus from "lucide-react-native/icons/circle-plus";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import BookText from "lucide-react-native/icons/book-text";
import CircleUserRound from "lucide-react-native/icons/circle-user-round";
import EyeOff from "lucide-react-native/icons/eye-off";
import Lock from "lucide-react-native/icons/lock";
import LogOut from "lucide-react-native/icons/log-out";
import Mail from "lucide-react-native/icons/mail";
import CloudUpload from "lucide-react-native/icons/cloud-upload";
import CloudOff from "lucide-react-native/icons/cloud-off";
import CloudCheck from "lucide-react-native/icons/cloud-check";
import CircleDot from "lucide-react-native/icons/circle-dot";
import ListOrdered from "lucide-react-native/icons/list-ordered";
import ListIndentDecrease from "lucide-react-native/icons/list-indent-decrease";
import Bold from "lucide-react-native/icons/bold";
import Italic from "lucide-react-native/icons/italic";
import Strikethrough from "lucide-react-native/icons/strikethrough";
import Heading2 from "lucide-react-native/icons/heading-2";
import Quote from "lucide-react-native/icons/quote";
import Archive from "lucide-react-native/icons/archive";
import ArchiveRestore from "lucide-react-native/icons/archive-restore";
import React from "react";

const icons = {
  today: ["sun.max", Sun],
  notes: ["text.book.closed", BookText],
  life: ["leaf", Leaf],
  design: ["paintpalette", Palette],
  compose: ["square.and.pencil", SquarePen],
  search: ["magnifyingglass", Search],
  calendar: ["calendar", Calendar],
  late: ["calendar.badge.exclamationmark", CalendarX],
  back: ["chevron.left", ChevronLeft],
  forward: ["chevron.right", ChevronRight],
  down: ["chevron.down", ChevronDown],
  up: ["chevron.up", ChevronUp],
  more: ["ellipsis", Ellipsis],
  rotate: ["arrow.counterclockwise", RotateCcw],
  pen: ["pencil.line", PencilLine],
  toLine: ["arrow.right.to.line", ArrowRightToLine],
  calendarPlus: ["calendar.badge.plus", CalendarPlus],
  filter: ["line.3.horizontal.decrease", ListFilter],
  sunrise: ["sunrise", Sunrise],
  sunset: ["sunset", Sunset],
  moon: ["moon", Moon],
  check: ["checkmark", Check],
  checkCircle: ["checkmark.circle", CircleCheck],
  format: ["textformat", Type],
  checklist: ["checklist", ListChecks],
  list: ["list.bullet", List],
  indent: ["increase.indent", ListIndentIncrease],
  outdent: ["decrease.indent", ListIndentDecrease],
  numbered: ["list.number", ListOrdered],
  bold: ["bold", Bold],
  italic: ["italic", Italic],
  strike: ["strikethrough", Strikethrough],
  heading: ["textformat.size", Heading2],
  quote: ["text.quote", Quote],
  archive: ["archivebox", Archive],
  unarchive: ["arrow.up.bin", ArchiveRestore],
  link: ["link", Link],
  keyboardDown: ["keyboard.chevron.compact.down", KeyboardOff],
  play: ["play.fill", Play],
  pause: ["pause.fill", Pause],
  close: ["xmark", X],
  plus: ["plus", Plus],
  timer: ["timer", Timer],
  hourglass: ["hourglass", Hourglass],
  idea: ["lightbulb", Lightbulb],
  clock: ["clock", Clock],
  open: ["arrow.up.right", ArrowUpRight],
  send: ["arrow.up", ArrowUp],
  next: ["arrow.right", ArrowRight],
  bell: ["bell", Bell],
  repeat: ["repeat", Repeat],
  flag: ["flag", Flag],
  doc: ["doc.text", FileText],
  trash: ["trash", Trash2],
  undo: ["arrow.uturn.backward", Undo2],
  sparkles: ["sparkles", Sparkles],
  sliders: ["slider.horizontal.3", SlidersHorizontal],
  gear: ["gearshape", Settings],
  hash: ["number", Hash],
  coffee: ["cup.and.saucer", Coffee],
  water: ["drop", Droplet],
  stretch: ["figure.stand", PersonStanding],
  far: ["eyeglasses", Glasses],
  eye: ["eye", Eye],
  leaf: ["leaf", Leaf],
  sprout: ["leaf", Sprout],
  mic: ["mic", Mic],
  image: ["photo", ImageIcon],
  copy: ["doc.on.doc", Copy],
  share: ["square.and.arrow.up", Share2],
  bookmark: ["bookmark", Bookmark],
  another: ["arrow.triangle.2.circlepath", RefreshCw],
  shuffle: ["shuffle", Shuffle],
  tag: ["tag", Tag],
  addCircle: ["plus.circle", CirclePlus],
  updown: ["chevron.up.chevron.down", ChevronsUpDown],
  arrowLeft: ["arrow.left", ArrowLeft],
  dot: ["circle.fill", CircleDot],
  noteText: ["note.text", NotebookText],
  person: ["person.crop.circle", CircleUserRound],
  signOut: ["rectangle.portrait.and.arrow.right", LogOut],
  lock: ["lock", Lock],
  mail: ["envelope", Mail],
  eyeOff: ["eye.slash", EyeOff],
  cloudUp: ["icloud.and.arrow.up", CloudUpload],
  cloudOff: ["icloud.slash", CloudOff],
  cloudCheck: ["checkmark.icloud", CloudCheck],
} as const;

/** SF Symbols with a filled form, for a chosen tab or a set state. Elsewhere the line just thickens. */
const filled: Partial<Record<keyof typeof icons, string>> = {
  today: "sun.max.fill",
  notes: "text.book.closed.fill",
  life: "leaf.fill",
  leaf: "leaf.fill",
  bell: "bell.fill",
  bookmark: "bookmark.fill",
  checkCircle: "checkmark.circle.fill",
  doc: "doc.text.fill",
  timer: "timer",
  search: "magnifyingglass",
  sunrise: "sunrise.fill",
  sunset: "sunset.fill",
  moon: "moon.fill",
  clock: "clock.fill",
};
export type IconName = keyof typeof icons;

const strokes = { regular: 1.75, medium: 2, semibold: 2.25, bold: 2.5 } as const;

/**
 * SF Symbols on the iPhone, the same drawings as line icons elsewhere: one
 * family per platform. `fill` asks for the filled form (a chosen tab).
 */
export function Icon({ name, size = 22, color, weight = "medium", fill }: { name: IconName; size?: number; color: string; weight?: keyof typeof strokes; fill?: boolean }) {
  const [symbol, Line] = icons[name];
  const line = <Line size={size} color={color} strokeWidth={fill ? strokes.bold : strokes[weight]} />;
  if (process.env.EXPO_OS !== "ios") return line;
  const sf = fill ? (filled[name] ?? symbol) : symbol;
  return <SymbolView name={sf as SFSymbol} size={size} tintColor={color} weight={weight} fallback={line} />;
}
