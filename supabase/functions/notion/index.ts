import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function extractDbId(raw: string): string {
  const noHyphen = raw.replace(/-/g, '')
  const match = noHyphen.match(/[0-9a-f]{32}/i)
  return match ? match[0] : raw.trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('notion_token, notion_db_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.notion_token || !profile?.notion_db_id) {
      return new Response(JSON.stringify({ error: 'Notion未設定: プロフィールタブでNotion連携を設定してください' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const dbId = extractDbId(profile.notion_db_id)
    const { date, theme, learning, action, message, notes, completed } = await req.json()

    const children: Record<string, unknown>[] = []

    if (theme) {
      children.push({
        object: 'block', type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: `📌 ${theme}` } }] }
      })
    }

    const addItems = (items: string[], prefix: string, sectionTitle: string) => {
      if (!items?.length) return
      children.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: sectionTitle } }] }
      })
      items.forEach((text: string, i: number) => {
        const key = `${prefix}_${i}`
        children.push({
          object: 'block', type: 'to_do',
          to_do: {
            rich_text: [{ type: 'text', text: { content: text } }],
            checked: (completed || []).includes(key)
          }
        })
        const noteText = (notes || {})[key]
        if (noteText?.trim()) {
          children.push({
            object: 'block', type: 'quote',
            quote: { rich_text: [{ type: 'text', text: { content: noteText.trim() } }] }
          })
        }
      })
    }

    addItems(learning, 'learning', '📚 インプット')
    addItems(action,   'action',   '⚡ アクション')

    if (message) {
      children.push({
        object: 'block', type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: message } }],
          icon: { type: 'emoji', emoji: '💬' }
        }
      })
    }

    const title = `${date}${theme ? ' ' + theme : ''}`
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${profile.notion_token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: {
          title: { title: [{ type: 'text', text: { content: title } }] }
        },
        children,
      })
    })

    if (!notionRes.ok) {
      const err = await notionRes.json()
      console.error('Notion error:', err)
      return new Response(JSON.stringify({ error: err.message || 'Notion API error' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const page = await notionRes.json()
    return new Response(JSON.stringify({ ok: true, pageId: page.id, url: page.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
