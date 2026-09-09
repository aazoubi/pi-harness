/**
 * Subagent Monitor
 *
 * - Footer status: live count of currently running `subagent` tool calls.
 * - Shortcut (ctrl+shift+m): popup overlay showing the full subagent tree,
 *   including nested subagent calls launched from inside other subagents.
 *   (ctrl-based, not alt/option-based - works out of the box on macOS
 *   terminals where Option is not mapped to Meta/Alt.)
 *
 * Works together with the `subagent` extension (examples/extensions/subagent).
 * No changes to that extension are required: this hooks into the generic
 * tool_execution_* events pi already emits for every tool call.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

const TOOL_NAME = "subagent";
const STATUS_KEY = "subagent-monitor";
const CLEANUP_MS = 5 * 60 * 1000; // keep finished calls visible for 5 min

interface CallState {
	toolCallId: string;
	label: string;
	mode: "single" | "parallel" | "chain";
	startedAt: number;
	status: "running" | "done" | "error";
	details?: any;
}

const calls = new Map<string, CallState>();

function computeMode(args: any): "single" | "parallel" | "chain" {
	if (args?.chain?.length) return "chain";
	if (args?.tasks?.length) return "parallel";
	return "single";
}

function computeLabel(args: any, mode: string): string {
	if (mode === "chain") return `chain (${args.chain.length} steps)`;
	if (mode === "parallel") return `parallel (${args.tasks.length} tasks)`;
	return args?.agent ?? "subagent";
}

function activeCount(): number {
	let n = 0;
	for (const c of calls.values()) if (c.status === "running") n++;
	return n;
}

function updateFooter(ctx: any) {
	const n = activeCount();
	ctx.ui.setStatus(STATUS_KEY, n > 0 ? `\u{1F916} subagents: ${n}` : undefined);
}

interface Node {
	agent: string;
	task: string;
	status: "running" | "done" | "failed";
	model?: string;
	children: Node[];
}

function nodeStatus(r: any): "running" | "done" | "failed" {
	if (r.exitCode === -1) return "running";
	if (r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted") return "failed";
	return "done";
}

// Recursively walk a subagent result's message stream. Every time that child
// process itself called the `subagent` tool, the resulting toolResult message
// carries the same SubagentDetails shape in `details` - so this recurses to
// arbitrary depth automatically.
function collectNodes(results: any[] | undefined): Node[] {
	if (!results) return [];
	return results.map((r) => {
		const children: Node[] = [];
		for (const msg of r.messages ?? []) {
			if (msg.role === "toolResult" && msg.toolName === TOOL_NAME && msg.details?.results) {
				children.push(...collectNodes(msg.details.results));
			}
		}
		return { agent: r.agent, task: r.task ?? "", status: nodeStatus(r), model: r.model, children };
	});
}

function truncate(s: string, max: number): string {
	const clean = s.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}

function iconFor(status: string, theme: any): string {
	if (status === "running") return theme.fg("warning", "\u23F3");
	if (status === "failed" || status === "error") return theme.fg("error", "\u2717");
	return theme.fg("success", "\u2713");
}

function renderNode(node: Node, indent: number, width: number, theme: any, out: string[]) {
	const icon = iconFor(node.status, theme);
	const prefix = "  ".repeat(indent) + (indent > 0 ? "\u2514\u2500 " : "");
	const budget = Math.max(10, width - prefix.length - 2);
	const line = `${prefix}${icon} ${theme.bold(node.agent)} ${theme.fg("dim", truncate(node.task, budget))}`;
	out.push(line);
	for (const child of node.children) renderNode(child, indent + 1, width, theme, out);
}

class SubagentPopup implements Component {
	constructor(
		private theme: any,
		private done: (v: null) => void,
	) {}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(
			this.theme.fg("accent", this.theme.bold("Subagent Monitor")) +
				this.theme.fg("muted", "  (press any key to close)"),
		);
		lines.push("");

		if (calls.size === 0) {
			lines.push(this.theme.fg("muted", "No subagent calls in this session yet."));
		} else {
			const sorted = [...calls.values()].sort((a, b) => b.startedAt - a.startedAt);
			for (const c of sorted) {
				const icon = iconFor(c.status, this.theme);
				const elapsed = ((Date.now() - c.startedAt) / 1000).toFixed(0);
				lines.push(
					`${icon} ${this.theme.bold(c.label)} ${this.theme.fg("muted", `[${c.mode}, ${c.status}, ${elapsed}s]`)}`,
				);
				const nodes = collectNodes(c.details?.results);
				for (const n of nodes) renderNode(n, 1, width, this.theme, lines);
				lines.push("");
			}
		}

		return lines.map((l) => (l.length > width ? `${l.slice(0, Math.max(0, width - 1))}\u2026` : l));
	}

	handleInput(_data: string) {
		this.done(null);
	}

	invalidate() {}
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_execution_start", (event: any, ctx: any) => {
		if (event.toolName !== TOOL_NAME) return;
		const mode = computeMode(event.args);
		calls.set(event.toolCallId, {
			toolCallId: event.toolCallId,
			label: computeLabel(event.args, mode),
			mode,
			startedAt: Date.now(),
			status: "running",
		});
		updateFooter(ctx);
	});

	pi.on("tool_execution_update", (event: any, ctx: any) => {
		if (event.toolName !== TOOL_NAME) return;
		const c = calls.get(event.toolCallId);
		if (!c) return;
		c.details = event.partialResult?.details ?? c.details;
		updateFooter(ctx);
	});

	pi.on("tool_execution_end", (event: any, ctx: any) => {
		if (event.toolName !== TOOL_NAME) return;
		const c = calls.get(event.toolCallId);
		if (c) {
			c.status = event.isError ? "error" : "done";
			c.details = event.result?.details ?? c.details;
		}
		updateFooter(ctx);
		setTimeout(() => calls.delete(event.toolCallId), CLEANUP_MS);
	});

	pi.registerShortcut("ctrl+shift+m", {
		description: "Show subagent monitor popup (running + nested subagents)",
		handler: async (ctx: any) => {
			let timer: ReturnType<typeof setInterval> | undefined;
			await ctx.ui.custom<null>(
				(tui: any, theme: any, _keybindings: any, done: (v: null) => void) => {
					const stop = (v: null) => {
						if (timer) clearInterval(timer);
						done(v);
					};
					timer = setInterval(() => tui.requestRender(), 500);
					return new SubagentPopup(theme, stop);
				},
				{ overlay: true },
			);
		},
	});

	// Clear status on shutdown so it doesn't linger in a stale session view.
	pi.on("session_shutdown", (_event: any, ctx: any) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.on("session_start", (_event: any, ctx: any) => {
		ctx.ui.notify("subagent-monitor extension loaded (ctrl+shift+m for popup)", "info");
	});
}
