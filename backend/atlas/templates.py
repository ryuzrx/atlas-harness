"""Default team templates. Configurable starting points, not limits."""
from __future__ import annotations

from typing import Any, Dict, List

READ = ["read", "messages", "memory"]
CODE = ["read", "write", "shell", "git", "messages", "memory"]
REVIEW = ["read", "shell", "git", "messages", "memory"]

LEAD_INSTR = ("You lead this team. Inspect the project before planning, break objectives into small verifiable tasks, "
              "assign each to the teammate whose role fits, and keep the plan honest about uncertainty.")


def A(name: str, role: str, tier: str, perms: List[str], instructions: str, lead: bool = False) -> Dict[str, Any]:
    return {"name": name, "role": role, "tier": tier, "tools": perms, "instructions": instructions, "lead": lead}


TEMPLATES: Dict[str, Dict[str, Any]] = {
    "engineering": {
        "name": "Engineering Team", "description": "Plans, implements, tests and reviews code changes.",
        "agents": [
            A("Engineering Lead", "lead", "reasoning", READ + ["git"], LEAD_INSTR, lead=True),
            A("Software Architect", "architect", "reasoning", READ + ["git"],
              "Study the existing architecture and propose minimal, consistent designs. Record decisions in project memory."),
            A("Frontend Engineer", "frontend", "coding", CODE,
              "Implement UI changes that follow the project's existing components, styling and accessibility patterns."),
            A("Backend Engineer", "backend", "coding", CODE,
              "Implement server, data and API changes with tests. Match existing conventions."),
            A("Testing Engineer", "tester", "coding", CODE,
              "Write and run tests that prove the acceptance criteria. Report exact commands and results."),
            A("Code Reviewer", "reviewer", "reasoning", REVIEW,
              "Review diffs for correctness, security and maintainability. Cite file:line. Do not rewrite the work yourself."),
        ]},
    "research": {
        "name": "Research Team", "description": "Investigates repositories, documentation and technical options.",
        "agents": [
            A("Research Lead", "lead", "reasoning", READ, LEAD_INSTR, lead=True),
            A("Repository Analyst", "repo_analyst", "light", READ + ["git"], "Map code structure, entry points and dependencies."),
            A("Documentation Researcher", "doc_researcher", "light", READ, "Find and summarize relevant documentation in the project. Quote sources."),
            A("Technical Evaluator", "evaluator", "reasoning", READ + ["shell"], "Evaluate options against explicit criteria; run small experiments when allowed."),
        ]},
    "design": {
        "name": "Design Team", "description": "UI, UX and design-system work.",
        "agents": [
            A("Design Lead", "lead", "reasoning", READ, LEAD_INSTR, lead=True),
            A("UI Designer", "ui", "coding", CODE, "Produce precise, restrained UI implementations consistent with the design system."),
            A("UX Designer", "ux", "light", READ, "Analyse flows, states, empty/error cases and accessibility."),
            A("Design System Engineer", "design_system", "coding", CODE, "Maintain tokens, primitives and component consistency."),
        ]},
    "qa": {
        "name": "Quality Assurance Team", "description": "Testing, security and performance verification.",
        "agents": [
            A("QA Lead", "lead", "reasoning", READ, LEAD_INSTR, lead=True),
            A("Test Engineer", "tester", "coding", CODE, "Write and run automated tests; report failures with reproduction steps."),
            A("Security Reviewer", "security", "reasoning", REVIEW, "Look for injection, auth, secrets and unsafe file/command handling."),
            A("Performance Analyst", "performance", "reasoning", REVIEW, "Measure before claiming; report numbers and methodology."),
        ]},
    "devops": {
        "name": "DevOps Team", "description": "Builds, releases and infrastructure.",
        "agents": [
            A("DevOps Lead", "lead", "reasoning", READ, LEAD_INSTR, lead=True),
            A("Build Engineer", "build", "coding", CODE, "Keep builds reproducible and fast."),
            A("Release Engineer", "release", "coding", CODE, "Prepare release notes, versioning and packaging. Never publish without approval."),
            A("Infrastructure Analyst", "infra", "reasoning", REVIEW, "Review infrastructure configuration for correctness and risk."),
        ]},
}
