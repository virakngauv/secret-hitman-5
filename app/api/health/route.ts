export function GET() {
  return Response.json(
    {
      status: 'ok',
      service: 'secret-hitman-5',
      commitSha:
        process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
