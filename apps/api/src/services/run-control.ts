type ActiveRun = {
  userId: string;
  controller: AbortController;
  startedAt: string;
};

class RunControlRegistry {
  private active = new Map<string, ActiveRun>();

  register(runId: string, userId: string): AbortController {
    const controller = new AbortController();
    this.active.set(runId, {
      userId,
      controller,
      startedAt: new Date().toISOString(),
    });
    return controller;
  }

  get(runId: string): ActiveRun | undefined {
    return this.active.get(runId);
  }

  cancel(runId: string, userId: string): { ok: boolean; reason?: string } {
    const found = this.active.get(runId);
    if (!found) return { ok: false, reason: "run no está activo" };
    if (found.userId !== userId) return { ok: false, reason: "forbidden" };
    found.controller.abort();
    return { ok: true };
  }

  complete(runId: string): void {
    this.active.delete(runId);
  }
}

export const runControlRegistry = new RunControlRegistry();

