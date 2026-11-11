// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatEndpointDetail } from "./ChatEndpointDetail";
import { queryKeys } from "@/lib/queryKeys";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), listResources: vi.fn(), refreshDiscordChannels: vi.fn(), setup: vi.fn(), pushToast: vi.fn(),
}));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: {
  get: mocks.get, listResources: mocks.listResources, refreshDiscordChannels: mocks.refreshDiscordChannels, setup: mocks.setup, update: vi.fn(),
} }));
vi.mock("./ChatExecutionDefaults", () => ({ ChatExecutionDefaults: () => null }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: mocks.pushToast }) }));
vi.mock("@/lib/router", () => ({
  useLocation: () => ({ state: null }),
  useParams: () => ({ endpointId: "discord-bot", tab: "settings" }), useNavigate: () => vi.fn(),
  Link: ({ children, to, ...props }: React.ComponentProps<"a"> & { to: string }) => <a href={to} {...props}>{children}</a>,
  Navigate: () => null,
}));

const channel = (id: string, label: string, enabled: boolean) => ({
  id, endpointId: "discord-bot", type: "channel", providerResourceId: id, label, availability: "available", enabled,
});

describe("Discord channel refresh", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  const endpoint = { id: "discord-bot", companyId: "company", connectionId: "runtime", provider: "discord",
    assignedAgentId: "maya", assignedAgentName: "Maya", allowUnlinkedPeople: false, status: "active", setup: { step: "complete" } };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(endpoint);
    mocks.listResources.mockResolvedValue([channel("lab", "#agent-lab", true)]);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><ChatEndpointDetail /></TooltipProvider></QueryClientProvider>));
    await vi.waitFor(() => expect(container.textContent).toContain("#agent-lab"), { timeout: 3000 });
  }
  const refreshButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Refresh channels"]');

  it("replaces the destination list with the refreshed Discord channels", async () => {
    mocks.refreshDiscordChannels.mockResolvedValue([channel("lab", "#agent-lab", true), channel("fresh", "#fresh-channel", false)]);
    await render();
    await act(async () => refreshButton()!.click());
    await vi.waitFor(() => expect(container.textContent).toContain("#fresh-channel"), { timeout: 3000 });
    expect(mocks.refreshDiscordChannels).toHaveBeenCalledWith("discord-bot");
    expect(client.getQueryData(queryKeys.chatEndpoints.resources("discord-bot"))).toHaveLength(2);
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Channels refreshed", tone: "success" }));
  });

  it("reports a failed refresh and keeps the stored list", async () => {
    mocks.refreshDiscordChannels.mockRejectedValue(new Error("Discord is unavailable"));
    await render();
    await act(async () => refreshButton()!.click());
    await vi.waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't refresh channels", tone: "error" })), { timeout: 3000 });
    expect(container.textContent).toContain("#agent-lab");
    expect(refreshButton()!.disabled).toBe(false);
  });

  it("hides the refresh control while the connection is paused", async () => {
    mocks.get.mockResolvedValue({ ...endpoint, status: "paused" });
    await render();
    expect(refreshButton()).toBeNull();
  });
});
