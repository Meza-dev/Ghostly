import { Hono } from "hono";
import { createProject, deleteProject, getAllProjects } from "../store/projects.js";

export const projectsRouter = new Hono();

projectsRouter.get("/projects", async (c) => {
  const projects = await getAllProjects();
  return c.json(projects);
});

projectsRouter.post("/projects", async (c) => {
  let body: { label?: unknown; color?: unknown };
  try {
    body = (await c.req.json()) as { label?: unknown; color?: unknown };
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }

  if (typeof body.label !== "string" || !body.label.trim()) {
    return c.json({ ok: false, error: "label requerido" }, 400);
  }

  const color = typeof body.color === "string" ? body.color : undefined;
  const project = await createProject(body.label.trim(), color);
  return c.json(project, 201);
});

projectsRouter.delete("/projects/:id", async (c) => {
  try {
    await deleteProject(c.req.param("id"));
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: "not found" }, 404);
  }
});
