import { useState, useMemo } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { CommitHashRecord } from "@bb/types";
import { ACCENT } from "./theme.ts";

export interface RepoEntry {
  knowledgeId: string;
  source:
    | {
        kind: "github";
        repoUrl: string;
        branch?: string;
        commitId?: string;
        commitHashes?: (string | CommitHashRecord)[];
      }
    | { kind: "local"; sourcePath: string };
  state: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

export interface LsInteractiveProps {
  repos: RepoEntry[];
  onDone: () => void;
}

type ViewMode = "repos" | "branches" | "details";

export function LsInteractive({ repos, onDone }: LsInteractiveProps): ReactElement {
  const { exit } = useApp();
  const [mode, setMode] = useState<ViewMode>("repos");
  const [repoIndex, setRepoIndex] = useState(0);
  const [branchIndex, setBranchIndex] = useState(0);
  const [selectedRepoUrl, setSelectedRepoUrl] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<RepoEntry | null>(null);

  // Group repos by their source URL or Path
  const groupedRepos = useMemo(() => {
    const groups: Record<string, RepoEntry[]> = {};
    for (const r of repos) {
      const key = (r.source.kind === "github" ? r.source.repoUrl : r.source.sourcePath) || r.knowledgeId;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(r);
    }
    return Object.entries(groups).map(([url, entries]) => {
      const firstEntry = entries[0];
      if (!firstEntry) {
        throw new Error("empty group");
      }
      return {
        url,
        kind: firstEntry.source.kind,
        entries,
      };
    });
  }, [repos]);

  const currentBranches = useMemo(() => {
    if (!selectedRepoUrl) {
      return [];
    }
    const group = groupedRepos.find((g) => g.url === selectedRepoUrl);
    return group ? group.entries : [];
  }, [selectedRepoUrl, groupedRepos]);

  const handleBack = () => {
    if (mode === "details") {
      setMode("branches");
    } else if (mode === "branches") {
      setMode("repos");
      setSelectedRepoUrl(null);
    } else {
      exit();
      onDone();
    }
  };

  useInput((input, key) => {
    if (key.escape || (input === "q" && mode === "repos")) {
      exit();
      onDone();
      return;
    }

    if (key.backspace || input === "b" || key.leftArrow) {
      handleBack();
      return;
    }

    if (mode === "repos") {
      if (key.upArrow || input === "k") {
        setRepoIndex((i) => (i > 0 ? i - 1 : groupedRepos.length - 1));
      } else if (key.downArrow || input === "j") {
        setRepoIndex((i) => (i < groupedRepos.length - 1 ? i + 1 : 0));
      } else if (key.return || key.rightArrow || input === "l") {
        const selected = groupedRepos[repoIndex];
        if (selected) {
          setSelectedRepoUrl(selected.url);
          setBranchIndex(0);
          setMode("branches");
        }
      }
    } else if (mode === "branches") {
      if (key.upArrow || input === "k") {
        setBranchIndex((i) => (i > 0 ? i - 1 : currentBranches.length - 1));
      } else if (key.downArrow || input === "j") {
        setBranchIndex((i) => (i < currentBranches.length - 1 ? i + 1 : 0));
      } else if (key.return || key.rightArrow || input === "l") {
        const selected = currentBranches[branchIndex];
        if (selected) {
          setSelectedEntry(selected);
          setMode("details");
        }
      }
    }
  });

  const renderRepos = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={ACCENT}>
          Indexed Repositories ({groupedRepos.length})
        </Text>
      </Box>
      {groupedRepos.map((group, i) => (
        <Box key={group.url}>
          <Text color={i === repoIndex ? ACCENT : "gray"}>{i === repoIndex ? "▶ " : "  "}</Text>
          <Text color={i === repoIndex ? "white" : "gray"} bold={i === repoIndex}>
            {group.kind === "github" ? parseGithubSlug(group.url) : group.url}
          </Text>
          <Text dimColor> ({group.entries.length} entries)</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>[↑/↓] move [Enter/→] branches [q/Esc] exit</Text>
      </Box>
    </Box>
  );

  const renderBranches = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Repos /{" "}
        </Text>
        <Text bold color={ACCENT}>
          {selectedRepoUrl
            ? currentBranches[0]?.source.kind === "github"
              ? parseGithubSlug(selectedRepoUrl)
              : selectedRepoUrl
            : ""}
        </Text>
      </Box>
      {currentBranches.map((entry, i) => (
        <Box key={entry.knowledgeId}>
          <Text color={i === branchIndex ? ACCENT : "gray"}>{i === branchIndex ? "▶ " : "  "}</Text>
          <Text color={i === branchIndex ? "white" : "gray"} bold={i === branchIndex}>
            {entry.source.kind === "github" ? (entry.source.branch ?? "default") : "local"}
          </Text>
          <Box marginLeft={2}>
            <Text color={getStateColor(entry.state)}>{entry.state.padEnd(10)}</Text>
            <Text dimColor> {entry.knowledgeId.slice(0, 8)}…</Text>
          </Box>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>[↑/↓] move [Enter/→] details [Esc/←] back</Text>
      </Box>
    </Box>
  );

  const renderDetails = () => {
    if (!selectedEntry) {
      return null;
    }
    const s = selectedEntry.source;
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            Repos / {s.kind === "github" ? parseGithubSlug(s.repoUrl) : s.sourcePath} /{" "}
          </Text>
          <Text bold color={ACCENT}>
            {s.kind === "github" ? (s.branch ?? "default") : "local"}
          </Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          <DetailRow label="Knowledge ID" value={selectedEntry.knowledgeId} />
          <DetailRow label="State" value={selectedEntry.state} color={getStateColor(selectedEntry.state)} />
          <DetailRow label="Files" value={String(selectedEntry.fileCount)} />
          <DetailRow label="Created" value={formatDate(selectedEntry.createdAt)} />
          <DetailRow label="Updated" value={formatDate(selectedEntry.updatedAt)} />

          {s.kind === "github" && (
            <>
              <Box marginTop={1} marginBottom={0}>
                <Text bold underline>
                  GitHub Details
                </Text>
              </Box>
              <DetailRow label="Repo URL" value={s.repoUrl} />
              <DetailRow label="Branch" value={s.branch ?? "default"} />
              <DetailRow label="Head" value={s.commitId?.slice(0, 8) ?? "-"} />

              <Box marginTop={1}>
                <Text bold underline>
                  Indexed Commits ({s.commitHashes?.length ?? 0})
                </Text>
              </Box>
              {(s.commitHashes ?? []).map((h, i) => {
                const hash = typeof h === "string" ? h : (h as { hash: string }).hash;
                return (
                  <Box key={hash} marginLeft={2}>
                    <Text dimColor>{i + 1}. </Text>
                    <Text color="yellow">{hash.slice(0, 8)}</Text>
                    {hash === s.commitId && <Text color="green"> (current head)</Text>}
                  </Box>
                );
              })}
              {(!s.commitHashes || s.commitHashes.length === 0) && (
                <Box marginLeft={2}>
                  <Text dimColor>No commit history recorded.</Text>
                </Box>
              )}
            </>
          )}

          {s.kind === "local" && (
            <>
              <Box marginTop={1}>
                <Text bold underline>
                  Local Details
                </Text>
              </Box>
              <DetailRow label="Path" value={s.sourcePath} />
            </>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>[Esc/←/Backspace] back</Text>
        </Box>
      </Box>
    );
  };

  return (
    <Box borderStyle="round" paddingX={2} paddingY={1} flexDirection="column" minHeight={10}>
      {mode === "repos" && renderRepos()}
      {mode === "branches" && renderBranches()}
      {mode === "details" && renderDetails()}
    </Box>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Box width={15}>
        <Text color="gray">{label}:</Text>
      </Box>
      <Text color={color ?? "white"}>{value}</Text>
    </Box>
  );
}

function getStateColor(state: string): string {
  switch (state) {
    case "PROCESSED":
      return "green";
    case "PROCESSING":
      return "yellow";
    case "FAILED":
      return "red";
    default:
      return "white";
  }
}

function parseGithubSlug(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    return u.pathname.replace(/^\/+/u, "").replace(/\.git$/u, "");
  } catch {
    return repoUrl;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}
