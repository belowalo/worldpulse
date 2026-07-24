# Web application location

The WorldPulse Next.js web application is maintained at the repository root (`app`, `components`, and `lib`) because the Cloudflare-compatible Sites build requires its worker and application entry points there. This directory documents that intentional monorepo adaptation; the FastAPI service lives in `apps/api`.
