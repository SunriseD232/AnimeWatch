import { NextResponse, type NextRequest } from 'next/server';

/** ВРЕМЕННЫЙ debug-роут — удалить после диагностики зеркала. */
export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get('src') ?? '';
  return new NextResponse(
    `<!DOCTYPE html><html><body style="margin:0"><iframe src="${src}" style="width:1280px;height:720px;border:0"></iframe></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  );
}
