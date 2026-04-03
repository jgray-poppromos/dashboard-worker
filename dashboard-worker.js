import htmlPage from './index.html';

/**
 * Validates Basic Auth credentials.
 * Expects Authorization: Basic <base64(user:pass)>
 */
function isAuthorized(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const [scheme, encoded] = authHeader.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;

  try {
    const decoded = atob(encoded);
    const [user, pass] = decoded.split(':');
    const expectedUser = env.DASHBOARD_USERNAME || 'admin';
    const expectedPass = env.DASHBOARD_PASSWORD;

    return user === expectedUser && pass === expectedPass;
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- CORS Headers ---
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // --- PROTECTED ENDPOINTS (Dashboard & APIs) ---
    // Webhooks are checked within their specific route and use X-Webhook-Secret.
    // All other routes (/, /events, /proxy-repo, /clear) require Basic Auth.
    if (url.pathname !== '/webhook' && !isAuthorized(request, env)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          ...corsHeaders,
          'WWW-Authenticate': 'Basic realm="Worker Automation Dashboard"',
        }
      });
    }

    // --- GET / (Serve HTML shell) ---
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(htmlPage, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          // Cache control for the static shell
          'Cache-Control': 'no-cache, must-revalidate'
        }
      });
    }

    // --- POST /webhook ---
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const auth = request.headers.get('X-Webhook-Secret');
      if (auth !== env.WEBHOOK_SECRET) {
        return new Response('Unauthorized - invalid X-Webhook-Secret', { status: 401, headers: corsHeaders });
      }

      try {
        const body = await request.json();
        
        // AUTO-CLEAR on Success Webhook
        // If the other workers send { status: "success", order_number: "..." }, clear errors.
        if (body.status === 'success' || body.success === true) {
          const orderNum = body.order_number;
          if (orderNum) {
            await clearOrder(env.DASHBOARD_KV, orderNum);
            return new Response(JSON.stringify({ success: true, cleared: true, order_number: orderNum }), { headers: corsHeaders });
          }
        }

        // STORE ERROR EVENT
        // We use a reverse timestamp so newer events sort first in KV list naturally.
        const ts = Date.now();
        // Zero-padded reverse timestamp for lexicographical sorting
        const revTs = (9999999999999 - ts).toString().padStart(13, '0');
        const rand = Math.random().toString(36).substring(2, 8);
        const orderNum = body.order_number || 'unknown';
        const eventId = `event:${revTs}:${rand}:${orderNum}`;
        
        const payload = {
          id: eventId,
          worker: body.worker || 'unknown',
          timestamp: new Date(ts).toISOString(),
          order_number: orderNum,
          error_message: body.error_message || body.message || 'Unknown error occurred',
          sugar_record_id: body.sugar_record_id || '',
        };

        // TTL is 48 hours (172800 seconds)
        await env.DASHBOARD_KV.put(eventId, JSON.stringify(payload), { expirationTtl: 172800 });
        
        return new Response(JSON.stringify({ success: true, stored: true, id: eventId }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid payload or server error' }), { status: 400, headers: corsHeaders });
      }
    }

    // --- GET /events ---
    if (url.pathname === '/events' && request.method === 'GET') {
      try {
        // Since we use reversed timestamps, standard list brings newest first
        const list = await env.DASHBOARD_KV.list({ prefix: 'event:', limit: 200 });
        
        const keysToFetch = list.keys;
        const fetchPromises = keysToFetch.map(k => env.DASHBOARD_KV.get(k.name, 'json'));
        const values = await Promise.all(fetchPromises);
        
        // Filter out nulls in case of race condition expiry
        const events = values.filter(v => !!v);
        
        return new Response(JSON.stringify(events), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // --- GET /clear/order/:orderNumber ---
    if (url.pathname.startsWith('/clear/order/') && request.method === 'POST') {
      const orderNum = decodeURIComponent(url.pathname.replace('/clear/order/', ''));
      try {
        await clearOrder(env.DASHBOARD_KV, orderNum);
        return new Response(JSON.stringify({ success: true, cleared: true }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // --- GET /proxy-report/:id ---
    if (url.pathname.startsWith('/proxy-report/') && request.method === 'GET') {
      const reportId = url.pathname.split('/')[2];
      try {
        const proxyUrl = `http://sugar-proxy/sugar/Reports/${reportId}/records?max_num=500`;
        const proxyRes = await env.SUGAR_PROXY.fetch(proxyUrl, {
          headers: {
            // Spoof Apps-Script to bypass proxy auth since dashboard internal
            "User-Agent": "Google-Apps-Script"
          }
        });
        
        if (!proxyRes.ok) {
          throw new Error(`Upstream Sugar Proxy error: ${proxyRes.status} ${await proxyRes.text()}`);
        }
        
        const data = await proxyRes.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};

// Helper function to clear all keys matching an order number
async function clearOrder(kv, orderNum) {
  const list = await kv.list({ prefix: 'event:' });
  // The key format is event:revTs:random:orderNum
  const keysToDelete = list.keys
    .filter(k => k.name.endsWith(`:${orderNum}`))
    .map(k => k.name);
    
  // Delete all matches concurrently
  if (keysToDelete.length > 0) {
    await Promise.all(keysToDelete.map(k => kv.delete(k)));
  }
}
