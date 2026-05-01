export function normalizeUserProfile(profile = {}) {
  const allowedLevels = new Set(["beginner", "intermediate", "advanced"]);
  return {
    goal: profile.goal || "",
    interests: Array.isArray(profile.interests) ? profile.interests : [],
    level: allowedLevels.has(profile.level) ? profile.level : "intermediate",
    constraints: Array.isArray(profile.constraints) ? profile.constraints : [],
    history: Array.isArray(profile.history) ? profile.history : []
  };
}

export function adjustForLevel(text, level = "intermediate") {
  if (!text) return "";

  if (level === "beginner") {
    return text
      .replace(/\bsemantic-like matching\b/gi, "meaning-based matching")
      .replace(/\bin-memory\b/gi, "stored while the app is running")
      .replace(/\bconsensus\b/gi, "agreement across sources");
  }

  if (level === "advanced") {
    return text;
  }

  return text;
}

export function formatAdvice(profile, hasContradictions) {
  const levelAdvice = {
    beginner: "Start with the highest-ranked sources and keep the answer short; add more sources only when the question is broad.",
    intermediate: "Use ranked local sources first, then compare repeated facts before trusting a conclusion.",
    advanced: "Inspect score, source count, and contradiction flags before promoting extracted facts into long-term memory."
  };

  const conflictNote = hasContradictions
    ? " Some sources appear to conflict, so treat the answer as provisional."
    : "";

  return `${levelAdvice[profile.level]}${conflictNote}`;
}
