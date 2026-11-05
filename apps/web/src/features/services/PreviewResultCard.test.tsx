import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useWindowStore } from "@/stores/windowStore";
import { PreviewResultCard } from "./PreviewResultCard";

beforeEach(() => {
  useWindowStore.setState({ windows: [], focusedId: null, zCounter: 10 });
});

it("opens a deduplicated browser tab from an agent preview target", () => {
  const target = {
    kind: "preview" as const,
    projectId: "prj_1",
    serviceId: "svc_00000000-0000-0000-0000-000000000001",
    path: "/dashboard",
  };
  render(<PreviewResultCard target={target} />);
  fireEvent.click(screen.getByRole("button", { name: "打开预览 · /dashboard" }));
  const tab = useWindowStore.getState().windows[0]?.tabs[0];
  expect(tab).toMatchObject({
    kind: "browser",
    resourceId: `browser:${target.serviceId}:/dashboard`,
    browser: { serviceId: target.serviceId, path: "/dashboard" },
    projectId: "prj_1",
  });
});
