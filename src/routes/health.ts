export const handleHealthRoute = (): Response => {
  return Response.json(
    {
      ok: true,
      status: 'healthy',
      service: 'lumi-backend',
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
};
