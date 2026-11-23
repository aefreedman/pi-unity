import { relative } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import type { UnityProjectDiscoveryResult } from "./unity-projects";

type UnityOpenSelection = { projectRoot: string; automated: boolean };

export async function pickUnityOpenTarget(
  ctx: ExtensionCommandContext, result: UnityProjectDiscoveryResult,
): Promise<UnityOpenSelection | undefined> {
  const title = result.incomplete || result.truncated
    ? "Open a found Unity project (search was incomplete)"
    : "Open Unity project";
  const items = result.candidates.map(({ projectRoot }) => ({
    value: projectRoot,
    label: result.strategy === "ancestor" ? projectRoot : relative(result.startDirectory, projectRoot),
  }));

  // RPC supports standard dialogs but not custom TUI key handling.
  if (ctx.mode !== "tui") {
    const label = await ctx.ui.select(title, items.map((item) => item.label));
    const project = items.find((item) => item.label === label);
    if (!project) return undefined;
    const mode = await ctx.ui.select(`Open ${project.label} in which mode?`, ["Normal", "Automated"]);
    if (mode !== "Normal" && mode !== "Automated") return undefined;
    return { projectRoot: project.value, automated: mode === "Automated" };
  }

  return ctx.ui.custom<UnityOpenSelection | undefined>((tui, theme, _keybindings, done) => {
    let automated = false;
    const projects = new SelectList(items, 8, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    projects.onSelect = (item) => done({ projectRoot: item.value, automated });
    projects.onCancel = () => done(undefined);
    return {
      capturesViewportInput: projects.capturesViewportInput,
      render(width) {
        return [
          theme.fg("accent", title),
          `Mode: ${automated ? "Automated" : "Normal"} (Tab to switch)`,
          ...projects.render(width),
          theme.fg("dim", "↑↓ choose copy · Enter open · Esc cancel"),
        ].map((line) => truncateToWidth(line, width));
      },
      handleInput(data) {
        if (matchesKey(data, Key.tab)) automated = !automated;
        else projects.handleInput(data);
        tui.requestRender();
      },
      invalidate() { projects.invalidate(); },
    };
  }, { blocked: { kind: "question", message: title } });
}
