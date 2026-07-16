/** Diccionario EN — fuente de verdad. Toda key nueva se agrega acá primero. */
export const en = {
  "lang.toggle.toEs": "Switch to Spanish",
  "lang.toggle.toEn": "Switch to English",
  "settings.language.title": "Language",
  "settings.language.desc": "Choose the interface language.",
  // T1 — verdict / statusBar
  "verdict.success.label": "Objective met and verified",
  "verdict.success.short": "Success",
  "verdict.failAppBug.label": "Ghostly found a problem in your app",
  "verdict.failAppBug.short": "Bug found",
  "verdict.failTestBroken.label": "The plan or victory condition is poorly defined",
  "verdict.failTestBroken.short": "Test misconfigured",
  "verdict.failAgentLost.label": "Ghostly couldn't find the path even though it existed",
  "verdict.failAgentLost.short": "Ghostly got lost",
  "verdict.inconclusiveEnvironment.label": "The environment failed (timeout, network, app down)",
  "verdict.inconclusiveEnvironment.short": "Unstable environment",
  "verdict.inconclusive.label": "The evidence isn't enough to conclude anything",
  "verdict.inconclusive.short": "Insufficient evidence",
  "verdict.unclassified.label": "Unclassified (run predates v0.2)",
  "verdict.unclassified.short": "Unclassified",
  "verdict.why.title": "Why",
  "verdict.why.findingNote":
    "This test did its job: it found a real bug in the application. It's not a Ghostly error.",
  "verdict.why.judgeReasoning": "Judge reasoning",
  "verdict.why.confidence": "Confidence: {value}",
  "verdict.why.evidence": "Evidence",
  "statusBar.runnerReady": "runner: ready",
  "statusBar.search": "Ctrl + Shift + K: search",
  "statusBar.newRun": "Ctrl + Shift + N: new run",
} as const;

export type MessageKey = keyof typeof en;
