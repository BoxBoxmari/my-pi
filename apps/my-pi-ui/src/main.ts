#!/usr/bin/env node
import { CoordinationClient, discoverProjectIdentity, resolveRuntimeDir } from "@my-pi/coordination-client";
import { createPortalServer } from "./server.js";

const workspace = process.argv[2] ?? process.cwd();
const project = await discoverProjectIdentity(workspace);
const client = await CoordinationClient.fromRuntimeDir(resolveRuntimeDir(project.projectKey));
const health = await client.health() as { projectId: string };
const handle = await createPortalServer({ reader: client, projectId: health.projectId });
console.log(handle.url);
await new Promise<void>(() => undefined);
