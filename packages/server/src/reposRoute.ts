import type { Request, Response, Router } from "express";
import express from "express";
import { getKnowledge, listKnowledge } from "@bb/mongo";

export function buildReposRoute(): Router {
  const router = express.Router();
  router.get("/api/v1/repos", async (_req: Request, res: Response) => {
    const entries = await listKnowledge();
    const repos = entries.map((e) => ({
      knowledgeId: e.knowledgeId,
      source: e.source,
      state: e.status.state,
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : new Date(e.createdAt).toISOString(),
      updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : new Date(e.updatedAt).toISOString(),
      fileCount: e.fileCount,
    }));
    res.status(200).json({ repos });
  });

  router.get("/api/v1/repos/:id", async (req: Request, res: Response) => {
    const id = req.params["id"];
    if (typeof id !== "string") {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const entry = await getKnowledge(id);
    if (entry === null) {
      res.status(404).json({ error: "knowledge not found" });
      return;
    }
    res.status(200).json({
      knowledgeId: entry.knowledgeId,
      source: entry.source,
      state: entry.status.state,
      createdAt:
        entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date(entry.createdAt).toISOString(),
      updatedAt:
        entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : new Date(entry.updatedAt).toISOString(),
      fileCount: entry.fileCount,
      totalFiles: entry.status.totalFiles,
      processedFiles: entry.status.processedFiles,
      ...(entry.failure !== undefined ? { failure: entry.failure } : {}),
    });
  });

  return router;
}
