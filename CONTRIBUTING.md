# Contributing

Thanks for improving ECHO. Keep changes small and easy to review.

1. Create a branch and use descriptive commit messages.
2. Update tests for new target behaviors or changes to learning invariants.
3. Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run smoke` (with an API and PostgreSQL running) before a pull request.
4. If changing the target contract, document whether a discrepancy is intentional.
5. Do not commit `.env`, credentials, `node_modules`, or generated `dist` output.

Please report vulnerabilities privately to the repository maintainer rather than posting working exploits in public issues.
