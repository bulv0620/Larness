import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, SessionData } from "@/lib/api";
import { HomeRoute } from "./HomeRoute";
import { LoginPage } from "./LoginPage";
import { PairPage } from "./PairPage";
import { RequireAuth } from "./RequireAuth";

vi.mock("@/features/workspace/WorkspaceHome", () => ({
  WorkspaceHome: () => <div>workspace-home</div>,
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => false,
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const origin = window.location.origin;

function bootstrap(overrides: Partial<BootstrapData["auth"]> = {}): BootstrapData {
  return {
    app: { name: "Larness", version: "0.0.0" },
    initialized: true,
    auth: {
      authenticated: false,
      pairingEnabled: true,
      passkeyEnabled: true,
      passkeyOrigin: origin,
      passkeyRegistered: true,
      ...overrides,
    },
    features: { preview: false },
    serverTime: 1,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthorised(): Response {
  return jsonResponse(
    { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
    401,
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/login" element={<div>login-route</div>} />
          <Route path="/pair" element={<div>pair-route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockFetch(handler: (url: string) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  mockFetch((url) => {
    if (url.endsWith("/api/bootstrap")) {
      return jsonResponse(bootstrap());
    }
    return unauthorised();
  });
});

describe("auth routing", () => {
  it("routes an unauthenticated browser with a registered passkey to /login", async () => {
    renderAt("/");
    expect(await screen.findByText("login-route")).toBeInTheDocument();
  });

  it("routes to /pair when no passkey is registered", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/bootstrap")) {
        return jsonResponse(bootstrap({ passkeyRegistered: false }));
      }
      return unauthorised();
    });

    renderAt("/");
    expect(await screen.findByText("pair-route")).toBeInTheDocument();
  });

  it("routes to /pair when the current origin is not canonical", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/bootstrap")) {
        return jsonResponse(bootstrap({ passkeyOrigin: "https://larness.example.com" }));
      }
      return unauthorised();
    });

    renderAt("/");
    expect(await screen.findByText("pair-route")).toBeInTheDocument();
  });

  it("renders the workspace when the session is authenticated", async () => {
    const session: SessionData = {
      clientSessionId: "bs_1",
      deviceId: null,
      kind: "once",
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      csrfToken: "csrf",
      capabilities: ["workspace.read"],
    };

    mockFetch((url) => {
      if (url.endsWith("/api/bootstrap")) {
        return jsonResponse(bootstrap({ authenticated: true }));
      }
      if (url.endsWith("/api/auth/session")) {
        return jsonResponse(session);
      }
      return unauthorised();
    });

    renderAt("/");
    expect(await screen.findByText("workspace-home")).toBeInTheDocument();
  });

  it("RequireAuth redirects unauthenticated visitors to /login", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <div>protected</div>
                </RequireAuth>
              }
            />
            <Route path="/login" element={<div>login-route</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("login-route")).toBeInTheDocument();
  });
});

describe("login and pair pages", () => {
  it("explains unsupported WebAuthn on /login", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/bootstrap")) {
        return jsonResponse(bootstrap());
      }
      return unauthorised();
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/当前浏览器不支持 WebAuthn/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "使用配对码" })).toHaveAttribute("href", "/pair");
  });

  it("shows the initialization guidance when pairing is unavailable", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/auth/session")) {
        return unauthorised();
      }
      if (url.endsWith("/api/pairing/requests")) {
        return jsonResponse(
          { error: { code: "NOT_INITIALIZED", message: "workspace is not initialized" } },
          409,
        );
      }
      return unauthorised();
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/pair"]}>
          <Routes>
            <Route path="/pair" element={<PairPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/工作空间尚未初始化/)).toBeInTheDocument();
  });
});
