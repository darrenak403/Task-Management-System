import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/components/query-provider";
import { api } from "@/lib/api-client";

import { AuthProvider, useAuth } from "./auth-provider";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const unauthenticated = () =>
  json(
    {
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in required",
        requestId: "r",
      },
    },
    401,
  );

const user = { id: "u1", email: "ada@example.com", displayName: "Ada" };

function Probe() {
  const { state, retry } = useAuth();
  return (
    <button type="button" onClick={retry}>
      {state.status === "authenticated"
        ? `authenticated:${state.user.email}`
        : state.status}
    </button>
  );
}

function renderProvider() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("AuthProvider", () => {
  it("becomes authenticated when the session is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(json({ data: user })),
    );

    renderProvider();

    await screen.findByText("authenticated:ada@example.com");
  });

  it("treats 401 as signed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(unauthenticated()),
    );

    renderProvider();

    await screen.findByText("unauthenticated");
  });

  it("treats an unreachable API as an error, not a logout, and recovers on retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();
    const probe = await screen.findByText("error");

    fetchMock.mockResolvedValue(json({ data: user }));
    act(() => probe.click());

    await screen.findByText("authenticated:ada@example.com");
  });

  it("ends the session when a later request finds it expired", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: user }));
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();
    await screen.findByText("authenticated:ada@example.com");

    fetchMock.mockResolvedValue(unauthenticated());
    await api("/workspaces").catch(() => undefined);

    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("unauthenticated"),
    );
  });
});
