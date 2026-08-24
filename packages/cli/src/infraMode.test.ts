// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { describe, it, expect } from "bun:test";
import { applyInfraMode, getInfraMode, isCloud, isEmbedded, needsDocker, INFRA_MODE_OPTIONS } from "./infraMode.ts";
import { Config, DbProviderType, GraphProviderType, QueueProviderType } from "@bb/types";
import { getConfigValue, setConfigValue } from "@bb/config";

describe("infraMode", () => {
  it("includes embedded, cloud, and docker in INFRA_MODE_OPTIONS", () => {
    const modes = INFRA_MODE_OPTIONS.map((o) => o.value);
    expect(modes).toContain("embedded");
    expect(modes).toContain("cloud");
    expect(modes).toContain("docker");
  });

  it("applies embedded preset correctly", () => {
    applyInfraMode("embedded");
    expect(getInfraMode()).toBe("embedded");
    expect(isEmbedded()).toBe(true);
    expect(isCloud()).toBe(false);
    expect(needsDocker()).toBe(false);
    expect(getConfigValue(Config.DbProvider)).toBe(DbProviderType.Sqlite);
    expect(getConfigValue(Config.GraphProvider)).toBe(GraphProviderType.Ladybug);
    expect(getConfigValue(Config.QueueProvider)).toBe(QueueProviderType.Honker);
  });

  it("applies cloud preset correctly without requiring docker", () => {
    applyInfraMode("cloud");
    expect(getInfraMode()).toBe("cloud");
    expect(isEmbedded()).toBe(false);
    expect(isCloud()).toBe(true);
    expect(needsDocker()).toBe(false);
    expect(getConfigValue(Config.DbProvider)).toBe(DbProviderType.Mongo);
    expect(getConfigValue(Config.GraphProvider)).toBe(GraphProviderType.Neo4j);
    expect(getConfigValue(Config.QueueProvider)).toBe(QueueProviderType.Bullmq);
  });

  it("applies docker preset correctly and requires docker", () => {
    setConfigValue(Config.MongoUri, "");
    setConfigValue(Config.Neo4jUri, "");
    setConfigValue(Config.Neo4jUser, "");
    setConfigValue(Config.RedisUrl, "");
    applyInfraMode("docker");
    expect(getInfraMode()).toBe("docker");
    expect(isEmbedded()).toBe(false);
    expect(isCloud()).toBe(false);
    expect(needsDocker()).toBe(true);
    expect(getConfigValue(Config.DbProvider)).toBe(DbProviderType.Mongo);
    expect(getConfigValue(Config.GraphProvider)).toBe(GraphProviderType.Neo4j);
    expect(getConfigValue(Config.QueueProvider)).toBe(QueueProviderType.Bullmq);
    expect(getConfigValue(Config.MongoUri)).toBe("mongodb://127.0.0.1:27017/bytebell");
    expect(getConfigValue(Config.Neo4jUri)).toBe("bolt://127.0.0.1:7687");
    expect(getConfigValue(Config.Neo4jUser)).toBe("neo4j");
    expect(getConfigValue(Config.RedisUrl)).toBe("redis://127.0.0.1:6379");
  });
});
