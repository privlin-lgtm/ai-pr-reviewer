import { prisma } from "../lib/prisma.js";
import { RepositoryIndexQueue } from "./repository-index-queue.js";

const argumentsByName = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (name !== undefined && value !== undefined && name.startsWith("--")) {
    argumentsByName.set(name, value);
  }
}

const repositoryId = argumentsByName.get("--repository-id");
if (repositoryId === undefined || repositoryId.trim().length === 0) {
  throw new Error("Usage: npm run index:repository -- --repository-id <database repository id> [--force true]");
}
const force = argumentsByName.get("--force") === "true";

try {
  const result = await new RepositoryIndexQueue(prisma).enqueue({ force, repositoryId });
  console.log(JSON.stringify({ event: "repository_index_queued", repositoryId, ...result }));
} finally {
  await prisma.$disconnect();
}
