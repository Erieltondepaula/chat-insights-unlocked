// WhatsApp .txt export parser (Android/iOS, BR/EN)
export type Message = {
  date: Date;
  author: string | null; // null = system message
  content: string;
  isSystem: boolean;
  hasMedia: boolean;
  mediaType?: "image" | "video" | "audio" | "document" | "sticker" | "gif";
};

export type Demand = {
  date: Date;
  requester: string;
  message: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  status: "pendente" | "resolvido";
};

export type Analysis = {
  totalMessages: number;
  firstDate: Date | null;
  lastDate: Date | null;
  groupCreatedAt?: Date | null;
  participants: ParticipantStats[];
  mediaCount: { image: number; video: number; audio: number; document: number; sticker: number; gif: number };
  demands: Demand[];
  dailySummary: { date: string; count: number; topics: string[] }[];
  topWords: { word: string; count: number }[];
  messages: Message[];
  systemEvents: { date: Date; content: string }[];
};

export type ParticipantStats = {
  name: string;
  messageCount: number;
  mediaSent: number;
  demandsRequested: number;
  demandsResolved: number;
  firstSeen: Date;
  lastSeen: Date;
  percentage: number;
};

// Matches start of a WA line; supports multiple date formats
// Android pt-BR: 12/03/2024 14:32 - Author: message
// iOS pt-BR: [12/03/2024, 14:32:10] Author: message
// Also handles 12/03/24 and 12.03.2024
const LINE_REGEX =
  /^\u200E?\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(?:[-–]\s*)?(.*)$/;

function parseDateParts(d: string, m: string, y: string, h: string, mi: string, s?: string): Date {
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  return new Date(year, parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), s ? parseInt(s, 10) : 0);
}

const MEDIA_PATTERNS: { re: RegExp; type: Message["mediaType"] }[] = [
  { re: /<Mídia oculta>|<arquivo de mídia oculto>|<Media omitted>|image omitted|imagem ocultada/i, type: "image" },
  { re: /vídeo ocultado|video omitted/i, type: "video" },
  { re: /áudio ocultado|audio omitted|ptt-/i, type: "audio" },
  { re: /sticker omitted|figurinha omitida/i, type: "sticker" },
  { re: /GIF omitted|GIF omitida/i, type: "gif" },
  { re: /documento omitido|document omitted/i, type: "document" },
];

function detectMedia(content: string): { hasMedia: boolean; type?: Message["mediaType"] } {
  for (const { re, type } of MEDIA_PATTERNS) {
    if (re.test(content)) return { hasMedia: true, type };
  }
  return { hasMedia: false };
}

const SYSTEM_HINTS = [
  /criou o grupo/i,
  /created group/i,
  /adicionou/i,
  /added/i,
  /saiu/i,
  /left/i,
  /removeu/i,
  /removed/i,
  /mudou.*assunto|mudou.*nome/i,
  /changed.*subject|changed.*name/i,
  /As mensagens.*criptografad/i,
  /Messages.*end-to-end encrypted/i,
  /alterou.*ícone|changed.*icon/i,
];

function isSystemLine(rest: string): boolean {
  if (!rest.includes(":")) return SYSTEM_HINTS.some((r) => r.test(rest));
  // ambiguous; let author parsing decide
  return false;
}

export function parseWhatsApp(text: string): Message[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const messages: Message[] = [];
  let current: Message | null = null;

  for (const line of lines) {
    const m = line.match(LINE_REGEX);
    if (m) {
      if (current) messages.push(current);
      const [, dd, MM, yy, hh, mi, ss, rest] = m;
      const date = parseDateParts(dd, MM, yy, hh, mi, ss);
      const sys = isSystemLine(rest);
      if (sys) {
        current = { date, author: null, content: rest, isSystem: true, hasMedia: false };
      } else {
        const idx = rest.indexOf(":");
        if (idx > 0 && idx < 80) {
          const author = rest.slice(0, idx).trim();
          const content = rest.slice(idx + 1).trim();
          const media = detectMedia(content);
          current = {
            date,
            author,
            content,
            isSystem: false,
            hasMedia: media.hasMedia,
            mediaType: media.type,
          };
        } else {
          current = { date, author: null, content: rest, isSystem: true, hasMedia: false };
        }
      }
    } else if (current) {
      current.content += "\n" + line;
    }
  }
  if (current) messages.push(current);
  return messages;
}

const DEMAND_KEYWORDS = [
  /\b(pode|poderia|consegue|conseguiria)\b.*\?/i,
  /\bpreciso\b/i,
  /\bfavor\b/i,
  /\bpor favor\b/i,
  /\bme envia\b|\bme manda\b|\bme passa\b/i,
  /\bfazer\b.*\?/i,
  /\bsolicito\b|\bsolicitação\b/i,
  /\burgente\b/i,
  /\bpendente\b/i,
  /\bpendência\b/i,
  /\bdemanda\b/i,
  /\?$/,
];

const RESOLUTION_KEYWORDS = [
  /\bfeito\b/i,
  /\bpronto\b/i,
  /\bresolvido\b/i,
  /\bconcluí\w*/i,
  /\bok\b/i,
  /\benviado\b|\benviei\b/i,
  /\bsegue\b/i,
];

function isDemand(content: string): boolean {
  return DEMAND_KEYWORDS.some((r) => r.test(content));
}

function isResolution(content: string): boolean {
  return RESOLUTION_KEYWORDS.some((r) => r.test(content));
}

const STOP_WORDS = new Set(
  "a o e é de da do das dos para por com sem em na no nas nos um uma uns umas que se ao aos não sim mas muito mais menos eu tu ele ela nós vós eles elas meu minha teu tua seu sua nosso vosso já só também ainda quando onde como porque pra pro tá ta tô to né tipo então essa esse isso aquele aquela aqui ali lá vai vou foi ser estar tem ter".split(
    /\s+/,
  ),
);

function topWords(messages: Message[], n = 15) {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.isSystem || m.hasMedia) continue;
    const words = m.content.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/);
    for (const w of words) {
      if (w.length < 4 || STOP_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

export function analyze(messages: Message[]): Analysis {
  const nonSys = messages.filter((m) => !m.isSystem);
  const sys = messages.filter((m) => m.isSystem);

  // Participants
  const pmap = new Map<string, ParticipantStats>();
  for (const m of nonSys) {
    if (!m.author) continue;
    let p = pmap.get(m.author);
    if (!p) {
      p = {
        name: m.author,
        messageCount: 0,
        mediaSent: 0,
        demandsRequested: 0,
        demandsResolved: 0,
        firstSeen: m.date,
        lastSeen: m.date,
        percentage: 0,
      };
      pmap.set(m.author, p);
    }
    p.messageCount++;
    if (m.hasMedia) p.mediaSent++;
    if (m.date < p.firstSeen) p.firstSeen = m.date;
    if (m.date > p.lastSeen) p.lastSeen = m.date;
  }

  // Demands: scan and try to pair with resolution within next 48h by any participant
  const demands: Demand[] = [];
  for (let i = 0; i < nonSys.length; i++) {
    const m = nonSys[i];
    if (!m.author || m.hasMedia) continue;
    if (!isDemand(m.content)) continue;
    const demand: Demand = {
      date: m.date,
      requester: m.author,
      message: m.content.slice(0, 280),
      status: "pendente",
    };
    const cutoff = m.date.getTime() + 1000 * 60 * 60 * 48;
    for (let j = i + 1; j < nonSys.length; j++) {
      const r = nonSys[j];
      if (r.date.getTime() > cutoff) break;
      if (!r.author || r.author === m.author) continue;
      if (isResolution(r.content) || r.hasMedia) {
        demand.resolvedBy = r.author;
        demand.resolvedAt = r.date;
        demand.status = "resolvido";
        break;
      }
    }
    demands.push(demand);
    const req = pmap.get(m.author);
    if (req) req.demandsRequested++;
    if (demand.resolvedBy) {
      const res = pmap.get(demand.resolvedBy);
      if (res) res.demandsResolved++;
    }
  }

  // Media counts
  const mediaCount = { image: 0, video: 0, audio: 0, document: 0, sticker: 0, gif: 0 };
  for (const m of nonSys) {
    if (m.hasMedia && m.mediaType) (mediaCount as Record<string, number>)[m.mediaType]++;
  }

  // Daily summary
  const dailyMap = new Map<string, { count: number; words: Map<string, number> }>();
  for (const m of nonSys) {
    const key = m.date.toISOString().slice(0, 10);
    let d = dailyMap.get(key);
    if (!d) {
      d = { count: 0, words: new Map() };
      dailyMap.set(key, d);
    }
    d.count++;
    if (!m.hasMedia) {
      const words = m.content.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/);
      for (const w of words) {
        if (w.length < 5 || STOP_WORDS.has(w)) continue;
        d.words.set(w, (d.words.get(w) ?? 0) + 1);
      }
    }
  }
  const dailySummary = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      count: v.count,
      topics: [...v.words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w),
    }));

  // Percentages
  const total = nonSys.length || 1;
  for (const p of pmap.values()) p.percentage = (p.messageCount / total) * 100;

  // Group creation
  const created = sys.find((s) => /criou o grupo|created group/i.test(s.content));

  return {
    totalMessages: messages.length,
    firstDate: messages[0]?.date ?? null,
    lastDate: messages[messages.length - 1]?.date ?? null,
    groupCreatedAt: created?.date ?? null,
    participants: [...pmap.values()].sort((a, b) => b.messageCount - a.messageCount),
    mediaCount,
    demands,
    dailySummary,
    topWords: topWords(nonSys),
    messages,
    systemEvents: sys.map((s) => ({ date: s.date, content: s.content })),
  };
}
