import * as L from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Accent } from "@bits/protocol";

// Curated set (keeps the bundle small vs. importing every lucide icon). Keys are normalized names.
const ICONS: Record<string, LucideIcon> = {
  activity: L.Activity, alarm: L.AlarmClock, alarmclock: L.AlarmClock, alert: L.TriangleAlert, warning: L.TriangleAlert,
  archive: L.Archive, arrowright: L.ArrowRight, arrowup: L.ArrowUp, arrowdown: L.ArrowDown, award: L.Award,
  bag: L.ShoppingBag, shoppingbag: L.ShoppingBag, cart: L.ShoppingCart, shoppingcart: L.ShoppingCart,
  bell: L.Bell, book: L.BookOpen, bookopen: L.BookOpen, bookmark: L.Bookmark, brain: L.Brain, briefcase: L.Briefcase,
  bug: L.Bug, building: L.Building2, cake: L.Cake, calendar: L.Calendar, calendarclock: L.CalendarClock, calendarcheck: L.CalendarCheck,
  camera: L.Camera, car: L.Car, chart: L.ChartColumn, barchart: L.ChartColumn, linechart: L.ChartLine, piechart: L.ChartPie,
  trending: L.TrendingUp, trendingup: L.TrendingUp, trendingdown: L.TrendingDown,
  check: L.Check, checkcircle: L.CircleCheck, circlecheck: L.CircleCheck, clipboard: L.Clipboard, clock: L.Clock,
  cloud: L.Cloud, cloudrain: L.CloudRain, rain: L.CloudRain, cloudsun: L.CloudSun, snow: L.Snowflake, snowflake: L.Snowflake,
  code: L.Code, coffee: L.Coffee, compass: L.Compass, cpu: L.Cpu, creditcard: L.CreditCard, card: L.CreditCard,
  database: L.Database, dollar: L.DollarSign, dollarsign: L.DollarSign, money: L.Banknote, wallet: L.Wallet, piggybank: L.PiggyBank,
  download: L.Download, dumbbell: L.Dumbbell, fitness: L.Dumbbell, edit: L.Pencil, pencil: L.Pencil, pen: L.PenLine,
  file: L.File, filetext: L.FileText, document: L.FileText, film: L.Film, movie: L.Film, flag: L.Flag, flame: L.Flame, fire: L.Flame,
  folder: L.Folder, gift: L.Gift, globe: L.Globe, web: L.Globe, graduation: L.GraduationCap, graduationcap: L.GraduationCap,
  heart: L.Heart, health: L.HeartPulse, heartpulse: L.HeartPulse, home: L.House, house: L.House, image: L.Image, photo: L.Image,
  inbox: L.Inbox, info: L.Info, key: L.KeyRound, laptop: L.Laptop, layers: L.Layers, layout: L.LayoutDashboard, dashboard: L.LayoutDashboard,
  leaf: L.Leaf, lightbulb: L.Lightbulb, idea: L.Lightbulb, link: L.Link, list: L.List, listtodo: L.ListTodo, todo: L.ListTodo, tasks: L.ListChecks,
  lock: L.Lock, mail: L.Mail, email: L.Mail, map: L.Map, mappin: L.MapPin, pin: L.MapPin, location: L.MapPin,
  message: L.MessageCircle, chat: L.MessageCircle, mic: L.Mic, moon: L.Moon, music: L.Music, newspaper: L.Newspaper, news: L.Newspaper,
  note: L.StickyNote, notes: L.NotebookPen, package: L.Package, box: L.Package, palette: L.Palette, paperclip: L.Paperclip,
  phone: L.Phone, pizza: L.Pizza, food: L.Utensils, utensils: L.Utensils, restaurant: L.Utensils, plane: L.Plane, flight: L.Plane, travel: L.Plane,
  play: L.Play, plug: L.Plug, plus: L.Plus, rocket: L.Rocket, ruler: L.Ruler, search: L.Search, send: L.Send, server: L.Server,
  settings: L.Settings, gear: L.Settings, share: L.Share2, shield: L.Shield, shieldcheck: L.ShieldCheck, sparkles: L.Sparkles, sparkle: L.Sparkles,
  star: L.Star, sun: L.Sun, weather: L.CloudSun, sunrise: L.Sunrise, sunset: L.Sunset, tag: L.Tag, target: L.Target, goal: L.Target,
  terminal: L.SquareTerminal, thermometer: L.Thermometer, temperature: L.Thermometer, thumbsup: L.ThumbsUp, timer: L.Timer,
  train: L.TrainFront, trash: L.Trash2, trophy: L.Trophy, truck: L.Truck, tv: L.Tv, umbrella: L.Umbrella, user: L.User, users: L.Users,
  person: L.User, people: L.Users, video: L.Video, wand: L.WandSparkles, magic: L.WandSparkles, wifi: L.Wifi, wind: L.Wind, wrench: L.Wrench,
  tool: L.Wrench, zap: L.Zap, bolt: L.Zap, lightning: L.Zap, x: L.X, bitcoin: L.Bitcoin, stock: L.ChartCandlestick, stocks: L.ChartCandlestick,
  hotel: L.BedDouble, bed: L.BedDouble, ticket: L.Ticket, store: L.Store, shop: L.Store, receipt: L.Receipt, percent: L.Percent,
  hash: L.Hash, smile: L.Smile, gamepad: L.Gamepad2, game: L.Gamepad2, headphones: L.Headphones, battery: L.BatteryMedium,
};

export function iconFor(name?: string | null, fallback = true): LucideIcon | null {
  if (!name) return null;
  const key = name.toLowerCase().replace(/icon$/, "").replace(/[^a-z0-9]/g, "");
  return ICONS[key] ?? ICONS[key.replace(/s$/, "")] ?? (fallback ? L.Sparkles : null);
}

const ACCENTS: Accent[] = ["violet", "blue", "green", "amber", "rose", "slate"];
export function accentVars(a?: Accent | string) {
  const accent = ACCENTS.includes(a as Accent) ? (a as Accent) : "violet";
  return { fg: `var(--a-${accent})`, soft: `var(--a-${accent}-soft)` };
}
