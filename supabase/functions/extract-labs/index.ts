// ══════════════════════════════════════════════════
//  EDGE FUNCTION: extract-labs
//  Proxies lab-result extraction requests to the Anthropic API.
//  The Anthropic key lives ONLY in this function's secret store —
//  it is never sent to, or visible from, the browser.
//
//  Reused as a generic Anthropic proxy by multiple modules — not just
//  labs.html. Also called by medications.html (med list extraction)
//  and clinical_assistant.html (uploaded document summarization).
//  The prompt and contentBlocks are built entirely client-side per
//  module; this function is intentionally generic and does not know
//  or care which module called it.
//
//  Deploy:
//    supabase functions deploy extract-labs
//
//  Set the secret once (CLI, not SQL editor, not a table):
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-... --project-ref osasglxowihoygidhgwc
// ══════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // tighten to your GitHub Pages origin if you want it stricter
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── Verify the caller is a logged-in LTS Care user ──
    // This requires the same Authorization: Bearer <access_token> header
    // your app already sends with every Supabase call.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY secret' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Expect the same shape labs.html already builds client-side ──
    // { contentBlocks: [...], prompt: "..." }
    const { contentBlocks, prompt } = await req.json();
    if (!Array.isArray(contentBlocks) || !prompt) {
      return new Response(JSON.stringify({ error: 'Missing contentBlocks or prompt' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fullContent = [...contentBlocks, { type: 'text', text: prompt }];

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: fullContent }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 300)}` }), {
        status: anthropicRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await anthropicRes.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
