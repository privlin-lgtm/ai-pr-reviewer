import type { PrismaClient } from "@prisma/client";

export interface DashboardIdentity {
  userId: string;
}

export interface DashboardScope {
  repositoryIds: string[];
  userId: string;
}

export interface DashboardIdentityProvider {
  getIdentity(): Promise<DashboardIdentity | null>;
}

export class UnconfiguredDashboardIdentityProvider implements DashboardIdentityProvider {
  async getIdentity(): Promise<null> {
    return null;
  }
}

export async function resolveDashboardScope(
  prisma: PrismaClient,
  identity: DashboardIdentity | null,
): Promise<DashboardScope | null> {
  if (identity === null) {
    return null;
  }

  const memberships = await prisma.repositoryMembership.findMany({
    select: { repositoryId: true },
    where: { userId: identity.userId },
  });

  return {
    repositoryIds: memberships.map((membership) => membership.repositoryId),
    userId: identity.userId,
  };
}
