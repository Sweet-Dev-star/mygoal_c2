export const config = {
  // Protect everything except Vercel's own static assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export default function middleware(req) {
  const header = req.headers.get('authorization');

  if (header && header.startsWith('Basic ')) {
    let decoded;
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = '';
    }
    const idx = decoded.indexOf(':');
    if (idx > -1) {
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      const expectedUser = process.env.BASIC_AUTH_USER;
      const expectedPass = process.env.BASIC_AUTH_PASSWORD;

      if (expectedUser && expectedPass &&
          user === expectedUser && pass === expectedPass) {
        return; // let the request through
      }
    }
  }

  return new Response('Auth required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Lab C2"' },
  });
}