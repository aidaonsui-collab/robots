# robots — Claude guidance

## Deployment

**Always deploy to production, never to preview.**

- When merging PRs to `main`, Vercel auto-deploys with `target: "production"`. That is the correct path.
- If using `vercel` CLI: always pass `--prod`. Never run plain `vercel` or `vercel deploy` (those create preview deploys).
- If using `deploy_to_vercel` MCP or any other deploy tool, confirm the result has `target: "production"` in the deployment metadata. If it shows `target: null` or `target: "preview"`, promote or redeploy to production.
- Vercel project: `aidas-projects-01b569fd/robots`.

## Feature branch

Develop on `claude/fix-staking-display-aLY7m`, open PR against `main`, squash-merge once ready.
