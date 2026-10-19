/**
 * tiles.ts - rendert Assistant-Antworten als gut lesbare Kacheln (Render-Zeit, Kontext bleibt unveraendert).
 *
 * Jede Ueberschrift (#, ##, ###) wird eine Kachel mit abwechselnder Hintergrundfarbe, Nummer-Badge, Titel und Trennlinie.
 * Innen:  - Listen mit farbigen Markern (•, ◦, 1.), Checkboxen (☐ ☑)
 *         - "Label: Text" -> Label fett
 *         - **fett**, `code` (gelb), [links], > Zitate (▎), #### Unterueberschriften (▸), --- Trennlinien
 *         - ```Code-Bloecke``` mit Seitenleiste, Tabellen als ausgerichtete Spalten
 * Befehl: /tiles on|off|toggle
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const ICONS = ["◆", "●", "▲", "■", "★", "◈"];
const BG = ["userMessageBg", "customMessageBg"];

interface Paint {
	bg: (s: string, i: number) => string;
	accent: (s: string) => string;
	title: (s: string) => string;
	bold: (s: string) => string;
	code: (s: string) => string;
	dim: (s: string) => string;
	ok: (s: string) => string;
	link: (s: string) => string;
	italic: (s: string) => string;
}

type Word = { t: string; k: "p" | "b" | "c" | "l" | "i"; g?: boolean };

const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visibleWidth(s)));

function plain(s: string): string {
	return s
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function words(raw: string): Word[] {
	const out: Word[] = [];
	const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g;
	let last = 0;
	let endsSpace = true;
	const push = (txt: string, k: Word["k"]) => {
		const parts = txt.split(/\s+/).filter(Boolean);
		parts.forEach((w, n) => {
			out.push({ t: w, k, g: n === 0 && out.length > 0 && !endsSpace && !/^\s/.test(txt) });
		});
		if (parts.length) endsSpace = /\s$/.test(txt);
	};
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw))) {
		if (m.index > last) push(raw.slice(last, m.index), "p");
		const tok = m[0];
		if (tok.startsWith("**")) push(tok.slice(2, -2), "b");
		else if (tok.startsWith("`")) push(tok.slice(1, -1), "c");
		else if (tok.startsWith("[")) push(tok.slice(1, tok.indexOf("]")), "l");
		else push(tok.slice(1, -1), "i");
		last = m.index + tok.length;
	}
	if (last < raw.length) push(raw.slice(last), "p");
	return out;
}

function style(w: Word, p: Paint): string {
	switch (w.k) {
		case "b": return p.bold(w.t);
		case "c": return p.code(w.t);
		case "l": return p.link(w.t);
		case "i": return p.italic(w.t);
		default: return w.t;
	}
}

/** Bricht Woerter um; first = fertig gestylter Prefix (Marker), hang = Einrueckung der Folgezeilen. */
function wrapWords(ws: Word[], first: string, hang: number, width: number, p: Paint): string[] {
	const indent = " ".repeat(hang);
	const lines: string[] = [];
	let cur = first;
	let has = false;
	for (const w of ws) {
		const s = style(w, p);
		const glue = has && w.g;
		const add = has && !glue ? " " + s : s;
		if (has && !glue && visibleWidth(cur) + visibleWidth(add) > width) {
			lines.push(cur);
			cur = indent + s;
		} else cur += add;
		has = true;
	}
	lines.push(cur);
	return lines;
}

function labelize(raw: string): string {
	if (/^\*\*/.test(raw) || /^`/.test(raw)) return raw;
	const m = raw.match(/^([A-Za-zÄÖÜäöüß0-9 /_.+-]{2,30}):\s+(\S.*)$/);
	if (m && m[1].split(/\s+/).length <= 4 && !/^https?$/i.test(m[1])) return `**${m[1]}:** ${m[2]}`;
	return raw;
}

function renderTable(rows: string[][], inner: number, p: Paint): string[] {
	const n = Math.max(...rows.map((r) => r.length));
	const cells = rows.map((r) => Array.from({ length: n }, (_, i) => plain((r[i] ?? "").trim())));
	const w = Array.from({ length: n }, (_, i) => Math.max(...cells.map((r) => visibleWidth(r[i]))));
	const sep = 3;
	const total = () => w.reduce((a, b) => a + b, 0) + sep * (n - 1);
	while (total() > inner) {
		const mi = w.indexOf(Math.max(...w));
		if (w[mi] <= 6) break;
		w[mi]--;
	}
	const fmt = (r: string[], head: boolean) =>
		r.map((c, i) => {
			const t = pad(truncateToWidth(c, w[i], "…"), w[i]);
			return head ? p.title(t) : t;
		}).join(p.dim(" │ "));
	const out = [fmt(cells[0], true), p.dim(w.map((x) => "─".repeat(x)).join("─┼─"))];
	for (const r of cells.slice(1)) out.push(fmt(r, false));
	return out;
}

function renderBody(body: string[], inner: number, p: Paint): string[] {
	const out: string[] = [];
	const blank = () => {
		if (out.length && out[out.length - 1] !== "") out.push("");
	};
	let i = 0;
	while (i < body.length) {
		const l = body[i];
		if (/^\s*```/.test(l)) {
			const code: string[] = [];
			i++;
			while (i < body.length && !/^\s*```/.test(body[i])) code.push(body[i++]);
			i++;
			blank();
			for (const c of code) out.push(p.dim("▏ ") + p.ok(truncateToWidth(c.replace(/\t/g, "  "), inner - 2, "…")));
			blank();
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(l)) {
			const rows: string[][] = [];
			while (i < body.length && /^\s*\|.*\|\s*$/.test(body[i])) {
				if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(body[i])) rows.push(body[i].trim().replace(/^\||\|$/g, "").split("|"));
				i++;
			}
			blank();
			if (rows.length) out.push(...renderTable(rows, inner, p));
			blank();
			continue;
		}
		i++;
		if (!l.trim()) { blank(); continue; }
		let m: RegExpMatchArray | null;
		if ((m = l.match(/^\s*([-*_])\1{2,}\s*$/))) { out.push(p.dim("╌".repeat(inner))); continue; }
		if ((m = l.match(/^#{4,6}\s+(.*)$/))) { blank(); out.push(p.accent("▸ ") + p.bold(plain(m[1]))); continue; }
		if ((m = l.match(/^\s*>\s?(.*)$/))) {
			out.push(...wrapWords(words(m[1]), p.dim("▎ "), 2, inner, p).map((x) => x));
			continue;
		}
		if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
			const depth = Math.floor(m[1].length / 2);
			const ind = "  ".repeat(Math.min(depth, 3));
			let rest = m[3];
			let marker: string;
			const cb = rest.match(/^\[( |x|X)\]\s+(.*)$/);
			if (cb) { marker = cb[1] === " " ? p.dim("☐") : p.ok("☑"); rest = cb[2]; }
			else if (/^\d/.test(m[2])) marker = p.accent(p.bold(m[2]));
			else marker = p.accent(depth ? "◦" : "•");
			const first = ind + marker + " ";
			out.push(...wrapWords(words(labelize(rest)), first, visibleWidth(ind) + visibleWidth(m[2]) + (cb ? 1 : 0) + 1, inner, p));
			continue;
		}
		out.push(...wrapWords(words(labelize(l.trim())), "", 0, inner, p));
	}
	while (out.length && out[out.length - 1] === "") out.pop();
	return out;
}

function tile(title: string | undefined, body: string[], idx: number, count: number, total: number, p: Paint): string {
	const inner = total - 6; // "│" + 2 Spaces + Text + 2 Spaces + "│"
	const lines = renderBody(body, inner, p);
	const edge = (s: string) => p.accent(s);
	const row = (content: string) => p.bg(edge("│") + "  " + pad(content, inner) + "  " + edge("│"), idx);
	const out: string[] = [];
	out.push(p.bg(edge("╭" + "─".repeat(total - 2) + "╮"), idx));
	out.push(row(""));
	if (title !== undefined) {
		const badge = count > 1 ? p.dim(`${String(idx + 1).padStart(2, "0")}/${String(count).padStart(2, "0")}`) : "";
		const head = p.accent(ICONS[idx % ICONS.length]) + "  " + p.title(truncateToWidth(plain(title), inner - 12, "…"));
		const gap = " ".repeat(Math.max(1, inner - visibleWidth(head) - visibleWidth(badge)));
		out.push(row(head + gap + badge));
		out.push(row(p.dim("╌".repeat(inner))));
		out.push(row(""));
	}
	for (const l of lines) out.push(row(l));
	out.push(row(""));
	out.push(p.bg(edge("╰" + "─".repeat(total - 2) + "╯"), idx));
	return out.join("\n");
}

export function toTiles(text: string, width: number, p: Paint): string {
	const total = Math.max(36, Math.min(width, 150));
	const nonEmpty = text.split("\n").filter((l) => l.trim());
	if (nonEmpty.length <= 1 && text.trim().length < 80) return text; // kurze Antworten bleiben normal
	type Sec = { title?: string; body: string[] };
	const secs: Sec[] = [{ body: [] }];
	let fence = false;
	for (const l of text.split("\n")) {
		if (/^\s*```/.test(l)) fence = !fence;
		const h = !fence && l.match(/^#{1,3}\s+(.*)$/);
		if (h) secs.push({ title: h[1].trim(), body: [] });
		else secs[secs.length - 1].body.push(l);
	}
	const real = secs.filter((s) => s.title !== undefined || s.body.some((l) => l.trim()));
	const out: string[] = [];
	real.forEach((s, i) => out.push(tile(s.title, s.body, i, real.length, total, p)));
	return out.join("\n\n");
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let getTheme: (() => any) | undefined;

	pi.on("session_start", async (_e, ctx) => {
		getTheme = () => ctx.ui.theme;
	});

	pi.registerCommand("tiles", {
		description: "Kachel-Darstellung der Antworten: /tiles on|off|toggle",
		handler: async (args, ctx) => {
			const a = args.trim();
			enabled = a === "on" ? true : a === "off" ? false : !enabled;
			ctx.ui.notify(`Kacheln: ${enabled ? "an" : "aus"} (neu rendern mit Scroll/Resize)`, "info");
		},
	});

	pi.registerMarkdownTransformer((markdown, ctx) => {
		if (!enabled || ctx.messageType !== "assistant" || !getTheme) return markdown;
		const th = getTheme();
		const paint: Paint = {
			bg: (s, i) => th.bg(BG[i % 2], s),
			accent: (s) => th.fg("accent", s),
			title: (s) => th.bold(th.fg("accent", s)),
			bold: (s) => th.bold(s),
			code: (s) => th.fg("warning", s),
			dim: (s) => th.fg("dim", s),
			ok: (s) => th.fg("success", s),
			link: (s) => th.underline(th.fg("accent", s)),
			italic: (s) => th.italic(s),
		};
		return toTiles(markdown, ctx.availableWidth, paint);
	});
}
