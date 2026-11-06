import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { ServiceOpsPage } from "./ServiceOpsPage";

const { authorize, execute, decide } = vi.hoisted(() => ({
  authorize: vi.fn(),
  execute: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("./api", () => ({
  serviceOpsServicesKey: ["service-ops", "services"],
  serviceOpsServiceKey: (id: string) => ["service-ops", "service", id],
  serviceOpsDeploymentsKey: (id: string) => ["service-ops", "deployments", id],
  serviceOpsLogsKey: (id: string) => ["service-ops", "logs", id],
  listFormalServices: vi.fn(async () => [
    {
      targetId: "tgt_00000000-0000-4000-8000-000000000001",
      projectId: "prj_1",
      name: "web",
      version: "v2",
      artifactHash: "a".repeat(64),
      desiredState: "running",
      observedState: "running",
      pid: 1234,
      lastHealthAt: Date.now(),
      reasonCode: null,
      updatedAt: Date.now(),
    },
  ]),
  listFormalDeployments: vi.fn(async () => [
    {
      id: "dep_00000000-0000-4000-8000-000000000001",
      targetId: "tgt_00000000-0000-4000-8000-000000000001",
      planId: "plan_00000000-0000-4000-8000-000000000001",
      authorizationId: "dauth_00000000-0000-4000-8000-000000000001",
      artifactId: "art_00000000-0000-4000-8000-000000000001",
      previousArtifactId: null,
      previousVersion: "v1",
      version: "v2",
      status: "SUCCEEDED",
      planHash: "b".repeat(64),
      artifactHash: "a".repeat(64),
      reasonCode: null,
      startedAt: 1,
      endedAt: 2,
      createdAt: 1,
    },
  ]),
  readFormalLogs: vi.fn(async () => ({ text: "ready v2", cursor: 8, truncated: false })),
  authorizeServiceAction: authorize,
  decideServiceAction: decide,
  executeServiceAction: execute,
  createFormalAgentTurn: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    id: "sauth_00000000-0000-4000-8000-000000000001",
    targetId: "tgt_00000000-0000-4000-8000-000000000001",
    projectId: "prj_1",
    action: "restart",
    actorType: "human",
    actorId: "client",
    clientSessionId: "client",
    sessionId: null,
    turnId: null,
    policy: "autonomous",
    policySnapshotId: "psnap",
    status: "AUTHORIZED",
    artifactHash: "a".repeat(64),
    version: "v2",
    scopeHash: "c".repeat(64),
    expiresAt: Date.now() + 1000,
    decidedAt: Date.now(),
    decidedBy: "client",
    consumedAt: null,
    reasonCode: null,
    createdAt: Date.now(),
  });
  execute.mockImplementation(async () => ({
    targetId: "tgt_00000000-0000-4000-8000-000000000001",
    projectId: "prj_1",
    name: "web",
    version: "v2",
    artifactHash: "a".repeat(64),
    desiredState: "running",
    observedState: "running",
    pid: 1234,
    lastHealthAt: Date.now(),
    reasonCode: null,
    updatedAt: Date.now(),
  }));
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ServiceOpsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it("lists formal services and executes an authorized restart", async () => {
  renderPage();
  expect((await screen.findAllByText("web"))[0]).toBeVisible();
  expect(screen.getAllByText(/v2/)[0]).toBeVisible();
  expect(await screen.findByText("ready v2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /重启/ }));
  await waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
});
