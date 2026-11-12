import type { Project } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { applyProjectOrder, moveProjectId } from "./projectOrder";

const defaultProject: Project = {
  id: "prj_default",
  kind: "default",
  name: "默认工作区",
  rootPath: "/tmp/default",
  branch: null,
  git: false,
  accent: "#0A84FF",
};

function project(id: string): Project {
  return {
    id,
    name: id,
    rootPath: `/tmp/${id}`,
    branch: null,
    git: false,
    accent: "#FF9F0A",
  };
}

describe("moveProjectId", () => {
  it("moves a project to an insertion slot and treats the slot after itself as a no-op", () => {
    expect(moveProjectId(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
    expect(moveProjectId(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveProjectId(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(moveProjectId(["a", "b", "c"], "b", 2)).toEqual(["a", "b", "c"]);
    expect(moveProjectId(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
  });

  it("clamps out-of-range slots and ignores unknown ids", () => {
    expect(moveProjectId(["a", "b"], "b", -4)).toEqual(["b", "a"]);
    expect(moveProjectId(["a", "b"], "a", 99)).toEqual(["b", "a"]);
    expect(moveProjectId(["a", "b"], "missing", 1)).toEqual(["a", "b"]);
  });
});

describe("applyProjectOrder", () => {
  it("keeps the default workspace first and applies the registered order", () => {
    const projects = [defaultProject, project("a"), project("b"), project("c")];

    expect(applyProjectOrder(projects, ["c", "a", "b"]).map((item) => item.id)).toEqual([
      "prj_default",
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps projects omitted from the order instead of dropping them", () => {
    const projects = [defaultProject, project("a"), project("b")];

    expect(applyProjectOrder(projects, ["b"]).map((item) => item.id)).toEqual([
      "prj_default",
      "b",
      "a",
    ]);
  });
});
