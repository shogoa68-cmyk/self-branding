import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function buildStatementPrompt(p: Record<string, string>, t: Record<string, string>): string {
  return `あなたはセルフブランディングのプロコーチです。
以下のプロフィールを持つ人物のブランドステートメントとエレベーターピッチを日本語で作成してください。

【現在の自分】
職業・役職: ${p.profession || '未入力'}
経歴: ${p.career || '未入力'}
スキル: ${p.skills || '未入力'}
趣味・興味: ${p.hobbies || '未入力'}

【目指す人物像】
目指す姿: ${t.targetRole || '未入力'}
達成したいゴール: ${t.targetGoals || '未入力'}
達成期間: ${t.timeline || '未入力'}
モチベーション: ${t.motivation || '未入力'}

必ず以下のJSON形式のみで返してください（余分な説明文は不要）:
{"statement":"ブランドステートメント（50〜100文字、その人らしい力強い一文）","pitch":"エレベーターピッチ（150〜200文字、3文程度、自然な語り口で）"}`
}

function buildSnsPrompt(p: Record<string, string>, t: Record<string, string>): string {
  return `あなたはSNSプロフィール最適化の専門家です。
以下のプロフィールを持つ人物の各SNSプロフィール文を日本語で作成してください。

【プロフィール】
職業・役職: ${p.profession || '未入力'}
スキル: ${p.skills || '未入力'}
経歴: ${p.career || '未入力'}
趣味: ${p.hobbies || '未入力'}
目指す姿: ${t.targetRole || '未入力'}
モチベーション: ${t.motivation || '未入力'}

必ず以下のJSON形式のみで返してください（各文字数制限を厳守）:
{"x":"X(Twitter)プロフィール（160文字以内）","linkedin":"LinkedInヘッドライン（220文字以内、プロフェッショナルなトーン）","github":"GitHubプロフィール（160文字以内）","wantedly":"Wantedlyプロフィール（500文字以内、人柄が伝わる温かみのある文章）"}`
}

function buildDailyPrompt(p: Record<string, string>, t: Record<string, string>): string {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: 'Asia/Tokyo',
  })
  return `あなたは${t.targetRole || '理想の人物像'}を目指す${p.profession || 'ユーザー'}のパーソナルコーチです。
今日（${today}）のインプット・行動提案を作成してください。

【ユーザープロフィール】
現在: ${p.profession || ''}（スキル: ${p.skills || ''}）
目標: ${t.targetRole || ''}
達成期間: ${t.timeline || ''}
モチベーション: ${t.motivation || ''}
今感じている不足・課題: ${p.lacks || '未入力'}

必ず以下のJSON形式のみで返してください:
{"theme":"今日のフォーカステーマ（20文字以内）","learning":["インプット項目1（40文字以内）","インプット項目2（40文字以内）","インプット項目3（40文字以内）"],"action":["実践アクション1（30文字以内）","実践アクション2（30文字以内）"],"message":"なりたい人物像に向けた今日の一言（60文字以内）"}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    // 認証チェック
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

    // リクエスト内容を取得
    const { type, profile, target } = await req.json()

    let prompt = ''
    if      (type === 'statement') prompt = buildStatementPrompt(profile, target)
    else if (type === 'sns')       prompt = buildSnsPrompt(profile, target)
    else if (type === 'daily')     prompt = buildDailyPrompt(profile, target)
    else return new Response(JSON.stringify({ error: 'Invalid type' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })

    // Claude API 呼び出し
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      console.error('Claude API error:', err)
      return new Response(JSON.stringify({ error: 'Claude API error' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const claudeData = await claudeRes.json()
    const text = claudeData.content?.[0]?.text ?? ''

    // JSON をパース
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      const match = text.match(/\{[\s\S]*\}/)
      parsed = match ? JSON.parse(match[0]) : { raw: text }
    }

    return new Response(JSON.stringify({ result: parsed }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
